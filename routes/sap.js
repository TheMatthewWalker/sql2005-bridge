import axios from "axios";
import express from 'express';
import sql     from 'mssql';
import { sapConfig } from '../server.js';

const router = express.Router();

// Location ASP.NET SAP server is hosted
const SAP_SERVER = sapConfig.asp;

// Read SAP table through ASP.NET queue
app.post("/sap/read-table", requireLogin, async (req, res) => {
    const { tableName, fields, options, rowCount, delimiter } = req.body;

    if (!tableName) return res.status(400).json({ error: "Missing tableName" });
    if (!fields || !Array.isArray(fields)) return res.status(400).json({ error: "fields must be an array" });

    try {
        const res = await axios.post(`${SAP_SERVER}/read-table`, {
            sapConfig,
            tableName,
            fields,
            options,
            rowCount,
            delimiter
        });

        res.json({ success: true, result: res.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
