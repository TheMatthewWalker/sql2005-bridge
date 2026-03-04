import axios from "axios";
import express from 'express';
import { sapConfig } from '../server.js';

const router = express.Router();

// Read SAP table through ASP.NET queue
router.post("/sap/read-table", async (req, res) => {
    const { tableName, fields, options, rowCount, delimiter } = req.body;

    if (!tableName) return res.status(400).json({ error: "Missing tableName" });
    if (!fields || !Array.isArray(fields)) return res.status(400).json({ error: "fields must be an array" });

    try {
        const res = await axios.post(`${sapConfig.asp}/read-table`, {
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


export default router;