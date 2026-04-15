import axios   from 'axios';
import https   from 'https';
import jwt     from 'jsonwebtoken';
import express from 'express';
import fs      from 'fs';
import sql     from 'mssql';
import { sapConfig, sapServerSecret, sqlConfig } from '../server.js';

// Use a pinned certificate when connecting over HTTPS; fall back to no custom agent for HTTP (dev).
const certPath = new URL('../certs/sap-server-cert.pem', import.meta.url);
const sapAgent = fs.existsSync(certPath)
    ? new https.Agent({ ca: fs.readFileSync(certPath), rejectUnauthorized: true })
    : null;

// Sign a short-lived service token for each SapServer request.
// Payload matches what SapServer expects: userId (int), issuer, audience.
function makeSapToken() {
    return jwt.sign(
        { userId: 0 },
        sapServerSecret,
        { issuer: 'sql2005-bridge', audience: 'sap-server', expiresIn: '60s' }
    );
}

// ── Audit helper ──────────────────────────────────────────────────────────────
async function audit(eventType, actorUsername, detail, req) {
  try {
    const pool = await sql.connect(sqlConfig);
    const ip   = req.ip || req.socket?.remoteAddress || null;
    await pool.request()
      .input('username',  sql.NVarChar(80),  actorUsername || null)
      .input('eventType', sql.NVarChar(50),  eventType)
      .input('detail',    sql.NVarChar(500), detail || null)
      .input('ip',        sql.NVarChar(45),  ip)
      .query(`
        INSERT INTO kongsberg.dbo.PortalAuditLog (Username, EventType, Detail, IPAddress)
        VALUES (@username, @eventType, @detail, @ip)
      `);
  } catch (err) {
    console.error('[admin audit]', err.message);
  }
}

function getActorUsername(req) {
  return req.session?.user?.username || null;
}

function buildAuditDetail(req, summary, extra = null) {
  const detail = [`${req.method} ${req.originalUrl}`, summary, extra].filter(Boolean).join(' | ');
  return detail.slice(0, 500);
}

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/sap/token  (mounted at /api/sap in server.js)
//
// Generic helper to verify the user's session and return a JWT for authenticating to SapServer.
// ---------------------------------------------------------------------------
router.post('/token', async (req, res) => {
  try {
    const payload = {
      userId:      req.session.user.userID,
      username:    req.session.user.username,
      role:        req.session.user.role,
      departments: req.session.user.departments,
    };
    const token = jwt.sign(payload, sapServerSecret, {
      expiresIn: '8h',
      issuer:    'sql2005-bridge',
      audience:  'sap-server',
    });
    await audit('SAP_OK', getActorUsername(req), buildAuditDetail(req, 'Issued SAP token'), req);
    res.json({ token });
  } catch (err) {
    await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, 'Failed to issue SAP token', err.message), req);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------------------------------------------------------------------------
// POST /api/sap/execute-rfc  (mounted at /api/sap in server.js)
//
// Generic wrapper around SapServer's /api/rfc/execute endpoint.
// Accepts the same JSON body that SapServer expects so callers don't need
// to know the internal SapServer URL or deal with COM/SAP directly.
//
// Body:
//   functionName      {string}   SAP RFC function name
//   importParameters  {object}   Scalar inputs  (SAP EXPORTING params)
//   inputTables       {object}   Table inputs using func.Tables(name)
//   inputTablesItems  {object}   Table inputs using func.Tables.Item(name)
//   exportParameters  {string[]} Scalar output param names to read back
//   outputTables      {object}   { tableName: [fieldName, ...] }
// ---------------------------------------------------------------------------
router.post("/execute-rfc", async (req, res) => {
    const {
        functionName,
        importParameters  = {},
        inputTables       = {},
        inputTablesItems  = {},
        exportParameters  = [],
        outputTables      = {}
    } = req.body;

    if (!functionName) {
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, 'RFC request rejected', 'Missing functionName'), req);
        return res.status(400).json({ success: false, error: "Missing functionName" });
    }

    //console.group(`[SAP] execute-rfc → ${functionName}`);
    //console.log('Import parameters:', importParameters);
    //if (Object.keys(inputTables).length)      console.log('Input tables:',       inputTables);
    //if (Object.keys(inputTablesItems).length) console.log('Input tables items:', inputTablesItems);
    //if (exportParameters.length)              console.log('Export parameters:',  exportParameters);
    //if (Object.keys(outputTables).length)     console.log('Output tables:',      outputTables);

    try {
        const response = await axios.post(
            `${sapConfig.url}/api/rfc/execute`,
            { functionName, importParameters, inputTables, inputTablesItems, exportParameters, outputTables },
            { timeout: 30000, httpsAgent: sapAgent, headers: { Authorization: `Bearer ${makeSapToken()}` } }
        );

        //console.log('HTTP status:', response.status);
        //console.log('Response:', JSON.stringify(response.data, null, 2));
        //console.groupEnd();
        await audit('SAP_OK', getActorUsername(req), buildAuditDetail(req, `RFC ${functionName} succeeded`), req);
        res.json({ success: true, data: response.data });
    } catch (err) {
        const status  = err.response?.status  ?? 500;
        const message = err.response?.data?.error?.message ?? err.message;
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, `RFC ${functionName || 'unknown'} failed`, message), req);
        console.error('Error:', status, message);
        if (err.response?.data) console.error('Response body:', JSON.stringify(err.response.data, null, 2));
        res.status(status).json({ success: false, error: message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/sap/cost-sheet  (mounted at /api/sap in server.js)
//
// Proxies to SapServer's /api/costing/cost-sheet endpoint.
// Body:
//   date      {string}   Costing date (YYYY-MM-DD or SAP format)
//   materials {string[]} Optional list of material numbers to filter
// ---------------------------------------------------------------------------
router.post("/cost-sheet", async (req, res) => {
    const { items, date } = req.body;

    if (!Array.isArray(items)) {
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, 'Cost sheet request rejected', 'Missing items'), req);
        return res.status(400).json({ success: false, error: "Missing items" });
    }

    try {
        const response = await axios.post(
            `${sapConfig.url}/api/costing/cost-sheet`,
            { items, date },
            { timeout: 60000, httpsAgent: sapAgent, headers: { Authorization: `Bearer ${makeSapToken()}` } }
        );

        const body = response.data;
        if (!body.success)
            throw new Error(body.error ?? 'SapServer returned success=false');

        const rows = body.data;
        await audit('SAP_OK', getActorUsername(req), buildAuditDetail(req, `Cost sheet succeeded (${items.length} items)`), req);
        res.json({ success: true, data: rows });

    } catch (err) {
        const status  = err.response?.status  ?? 500;
        const message = err.response?.data?.error ?? err.message;
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, 'Cost sheet failed', message), req);
        console.error('Error:', status, message);
        if (err.response?.data) console.error('Response body:', JSON.stringify(err.response.data, null, 2));
        res.status(status).json({ success: false, error: message });
    }
});


// ---------------------------------------------------------------------------
// POST /api/sap/warehouse/consignment-mb1b  (mounted at /api/sap in server.js)
//
// Proxies to SapServer's /api/warehouse/consignment-mb1b endpoint.
// ---------------------------------------------------------------------------
router.post("/warehouse/consignment-mb1b", async (req, res) => {
    const params = req.body;

    try {
        const response = await axios.post(
            `${sapConfig.url}/api/warehouse/consignment-mb1b`,
            params,
            { timeout: 60000, httpsAgent: sapAgent, headers: { Authorization: `Bearer ${makeSapToken()}` } }
        );

        const body = response.data;
        if (!body.success)
            throw new Error(body.error ?? 'SapServer returned success=false');

        const rows = body.data;
        await audit('SAP_OK', getActorUsername(req), buildAuditDetail(req, `Consignment MB1B succeeded for material ${params.Material || ''}`), req);
        res.json({ success: true, data: rows });

    } catch (err) {
        const status  = err.response?.status  ?? 500;
        const message = err.response?.data?.error ?? err.message;
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, `Consignment MB1B failed for material ${params.Material || ''}`, message), req);
        console.error('Error:', status, message);
        if (err.response?.data) console.error('Response body:', JSON.stringify(err.response.data, null, 2));
        res.status(status).json({ success: false, error: message });
    }
});


// ---------------------------------------------------------------------------
// POST /api/sap/warehouse/transfer-order  (mounted at /api/sap in server.js)
//
// Proxies to SapServer's /api/warehouse/transfer-order endpoint.
// ---------------------------------------------------------------------------
router.post("/warehouse/transfer-order", async (req, res) => {
    const params = req.body;

    try {
        const response = await axios.post(
            `${sapConfig.url}/api/warehouse/transfer-order`,
            params,
            { timeout: 60000, httpsAgent: sapAgent, headers: { Authorization: `Bearer ${makeSapToken()}` } }
        );

        const body = response.data;
        if (!body.success)
            throw new Error(body.error ?? 'SapServer returned success=false');

        const rows = body.data;
        await audit('SAP_OK', getActorUsername(req), buildAuditDetail(req, `Transfer order succeeded for material ${params.Material || ''}`), req);
        res.json({ success: true, data: rows });

    } catch (err) {
        const status  = err.response?.status  ?? 500;
        const message = err.response?.data?.error ?? err.message;
        await audit('SAP_ERROR', getActorUsername(req), buildAuditDetail(req, `Transfer order failed for material ${params.Material || ''}`, message), req);
        console.error('Error:', status, message);
        if (err.response?.data) console.error('Response body:', JSON.stringify(err.response.data, null, 2));
        res.status(status).json({ success: false, error: message });
    }
});

export default router;
