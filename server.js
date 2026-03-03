import express from "express";
import session from "express-session";
import sql from "mssql";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { sapLogon, sapReadTable } from "./sapApi.js";
import mixingRoutes            from './routes/mixing.js';
import shipmentMainRoutes      from './routes/shipmentmain.js';
import destinationsRoutes      from './routes/destinations.js';
import shipmentLinkRoutes      from './routes/shipmentlink.js';
import shipmentCostRoutes      from './routes/shipmentcost.js';
import costTypesRoutes         from './routes/costtypes.js';
import costElementsRoutes      from './routes/costelements.js';
import costCentersRoutes       from './routes/costcenters.js';
import forwardersRoutes        from './routes/forwarders.js';
import incotermsRoutes         from './routes/incoterms.js';
import deliveryMainRoutes      from './routes/deliverymain.js';
import deliveryLinkRoutes      from './routes/deliverylink.js';
import palletMainRoutes        from './routes/palletmain.js';
import palletPackagesRoutes    from './routes/palletpackages.js';
import ratesKNRoutes           from './routes/rateskn.js';
import ratesTPNRoutes          from './routes/ratestpn.js';
import forwarderApprovalRoutes from './routes/forwarderapproval.js';
import assignmentTPNRoutes     from './routes/assignmenttpn.js';
import palletDataRoutes        from './routes/palletdata.js';
import packagingDataRoutes     from './routes/packagingdata.js';
import palletValidationRoutes  from './routes/palletvalidation.js';
import productionRoutes        from './routes/production.js';
import relatedRecordsRoutes    from './routes/relatedrecords.js';
import filterRecordsRoutes     from './routes/filterrecords.js';
import exportXlsxRoutes        from './routes/exportxlsx.js';



const config = JSON.parse(fs.readFileSync("./config.json"));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "kongsberg-gbno-bridge",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

app.use('/api/mixing', requireLogin,            mixingRoutes);
app.use('/api/shipmentmain', requireLogin,      shipmentMainRoutes);
app.use('/api/destinations', requireLogin,      destinationsRoutes);
app.use('/api/shipmentlink', requireLogin,      shipmentLinkRoutes);
app.use('/api/shipmentcost', requireLogin,      shipmentCostRoutes);
app.use('/api/costtypes', requireLogin,         costTypesRoutes);
app.use('/api/costelements', requireLogin,      costElementsRoutes);
app.use('/api/costcenters', requireLogin,       costCentersRoutes);
app.use('/api/forwarders', requireLogin,        forwardersRoutes);
app.use('/api/incoterms', requireLogin,         incotermsRoutes);
app.use('/api/deliverymain', requireLogin,      deliveryMainRoutes);
app.use('/api/deliverylink', requireLogin,      deliveryLinkRoutes);
app.use('/api/palletmain', requireLogin,        palletMainRoutes);
app.use('/api/palletpackages', requireLogin,    palletPackagesRoutes);
app.use('/api/rateskn', requireLogin,           ratesKNRoutes);
app.use('/api/ratestpn', requireLogin,          ratesTPNRoutes);
app.use('/api/forwarderapproval', requireLogin, forwarderApprovalRoutes);
app.use('/api/assignmenttpn', requireLogin,     assignmentTPNRoutes);
app.use('/api/palletdata', requireLogin,        palletDataRoutes);
app.use('/api/packagingdata', requireLogin,     packagingDataRoutes);
app.use('/api/palletvalidation', requireLogin,  palletValidationRoutes);
app.use('/api/production', requireLogin,        productionRoutes);
app.use('/api/related-records', requireLogin,   relatedRecordsRoutes);
app.use('/api/filter-records', requireLogin,    filterRecordsRoutes);
app.use('/api/export-xlsx', requireLogin,       exportXlsxRoutes);

// Serve static front-end files
app.use(express.static(path.join(process.cwd(), "public")));

// Serve protected pages
app.get('/private/:page', requireLogin, (req, res) => {
  const filePath = path.join(__dirname, 'private', `${req.params.page}`);
  res.sendFile(filePath);
});

app.get('/private/js/:file', requireLogin, (req, res) => {
  const filePath = path.join(__dirname, 'private', 'js', req.params.file);
  res.sendFile(filePath);
});

app.get('/private/css/:file', requireLogin, (req, res) => {
  const filePath = path.join(__dirname, 'private', 'css', req.params.file);
  res.sendFile(filePath);
});

export const sqlConfig = {
  user: config.sqlConfig.user,
  password: config.sqlConfig.password,
  server: config.sqlConfig.server,
  database: config.sqlConfig.database,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Login middleware
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect("/");
}

// Helper to get SAP credentials from config
function getSapCredentials(username) {
  const user = config.users.find(u => u.username === username);
  if (!user) return null;
  return { User: user.sapUser, Passwd: user.sapPassword };
}

// Helper to check for admins
function isAdmin(username) {
  const user = config.users.find(u => u.username === username);
  if (!user) return null;
  return user.isAdmin;
}

// Session check endpoint
app.get('/session-check', (req, res) => {
  const user = req.session.user;
  res.json({ loggedIn: !!user });
});

// Login endpoint
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = config.users.find(u => u.username === username && u.password === password);

  if (user) {
    req.session.user = { username: user.username };
    res.redirect("/private/portal.html");
  } else {
    res.redirect("/");
    res.status(500).send("Invalid username or password");
  }
});

// Logout endpoint
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ✅ Query API (still requires API key)
app.post("/query", requireLogin, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Missing query" });

  // Normalize query for case-insensitive checking
  const normalized = query.trim().toUpperCase();

  // Allow Admin to by-pass the block.
  var serverAdmin = isAdmin(req.session.user.username);

  if (serverAdmin !== true) {
    // 🚫 Block any dangerous keywords even if embedded later
    const forbidden = ["DELETE", "DROP", "UPDATE", "INSERT", "ALTER", "TRUNCATE", "EXEC", "MERGE"];
    if (forbidden.some(word => normalized.includes(word))) {
      return res.status(403).json({ error: `Forbidden keyword detected: one of ${forbidden.join(", ")}` });
    }
  }

  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(query);
    // Always return JSON, even if recordset is empty (e.g., for INSERT/DELETE)
    res.json({
      success: true,
      rowsAffected: result.rowsAffected,   // array of rows affected per statement
      recordset: result.recordset || []    // will be empty if no SELECT returned
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ✅ POST version for Excel or tools sending long queries
app.post("/query-csv", async (req, res) => {
  const { query, key } = req.body;
  if (key !== config.apiKey) return res.status(403).send(key + " " + query);
  if (!query) return res.status(400).send("Missing query");

  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(query);

    
    // INSERT / UPDATE / DELETE
    if (!result.recordset) {
      const rows = result.rowsAffected?.[0] ?? 0;

      return res.status(200).json({
        success: true,
        rowsAffected: rows,
        message: rows === 0
          ? "Query executed successfully (no rows affected)"
          : `${rows} row(s) affected`
      });
    }

    // SELECT
    const rows = result.recordset;
    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Query executed successfully (no data returned)"
      });
    }

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(";"),
      ...rows.map(row =>
        headers.map(h => JSON.stringify(row[h] ?? "")).join(";")
      )
    ].join("\r\n");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Disposition", "attachment; filename=results.csv");
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);

  } catch (err) {
    console.error("SQL error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


// ✅ Prep data to post to ASP.NET function (just a test endpoint)
app.post("/rfc", requireLogin, async (req, res) => {
  try {
    const sessionUser = req.session.user?.username;
    if (!sessionUser) return res.status(401).json({ success: false, error: "Not logged in" });

    const sapCreds = getSapCredentials(sessionUser);
    if (!sapCreds || !sapCreds.User || !sapCreds.Passwd) {
      return res.json({ success: false, error: "SAP credentials not set for this user" });
    }

    const rfcParams = {
      System: "KAP",
      SystemNumber: "01",
      Client: "100",
      User: sapCreds.User,
      Passwd: sapCreds.Passwd,
      Lang: "EN",
    };

    // Call your existing SAP COM logic here
    const result = await callSapRfcRetries(rfcParams, "rfc");

    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// -----------------------------
// SAP API ENDPOINTS
// -----------------------------

// Logon to SAP using the ASP.NET queue
app.post("/sap/logon", requireLogin, async (req, res) => {
    try {
        const user = req.session.user.username;
        const creds = getSapCredentials(user);

        if (!creds) {
            return res.status(401).json({ error: "SAP credentials not configured for this user" });
        }

        const result = await sapLogon(
            creds.User,
            creds.Passwd
        );

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Read SAP table through ASP.NET queue
app.post("/sap/read-table", requireLogin, async (req, res) => {
    const { tableName, fields, options, rowCount, delimiter } = req.body;

    if (!tableName) return res.status(400).json({ error: "Missing tableName" });
    if (!fields || !Array.isArray(fields)) return res.status(400).json({ error: "fields must be an array" });

    try {
        const result = await sapReadTable(
            tableName,
            fields,
            options || [],
            rowCount || 1000,
            delimiter || ";"
        );

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
 // -----------------------------



app.listen(4000, "0.0.0.0", () => console.log("✅ SQL2005 Bridge accessible on network port 4000"));

