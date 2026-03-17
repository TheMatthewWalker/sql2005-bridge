import axios   from 'axios';
import https   from 'https';
import jwt     from 'jsonwebtoken';
import express from 'express';
import { sapConfig, sapServerSecret } from '../server.js';

// SAP server uses a self-signed certificate — bypass verification for internal calls only
const sapAgent = new https.Agent({ rejectUnauthorized: false });

// Sign a short-lived service token for each SapServer request.
// Payload matches what SapServer expects: userId (int), issuer, audience.
function makeSapToken() {
    return jwt.sign(
        { userId: 0 },
        sapServerSecret,
        { issuer: 'sql2005-bridge', audience: 'sap-server', expiresIn: '60s' }
    );
}

const router = express.Router();

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

    if (!functionName)
        return res.status(400).json({ success: false, error: "Missing functionName" });

    try {
        const response = await axios.post(
            `${sapConfig.url}/api/rfc/execute`,
            { functionName, importParameters, inputTables, inputTablesItems, exportParameters, outputTables },
            { timeout: 30000, httpsAgent: sapAgent, headers: { Authorization: `Bearer ${makeSapToken()}` } }
        );

        res.json({ success: true, data: response.data });
    } catch (err) {
        const status  = err.response?.status  ?? 500;
        const message = err.response?.data?.error?.message ?? err.message;
        res.status(status).json({ success: false, error: message });
    }
});

export default router;
