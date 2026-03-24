import express from 'express';
import sql from 'mssql';
import { sqlConfig } from '../server.js';

const router = express.Router();
const getPool = async () => await sql.connect(sqlConfig);

// ── Get all records ──
router.get('/', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query('SELECT * FROM Logistics.dbo.ShipmentCost');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by CostID ──
router.get('/id/:costId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('costId', sql.BigInt, req.params.costId)
            .query('SELECT * FROM Logistics.dbo.ShipmentCost WHERE costID = @costId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by ShipmentID ──
router.get('/shipment/:shipmentId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('shipmentId', sql.BigInt, req.params.shipmentId)
            .query('SELECT * FROM Logistics.dbo.ShipmentCost WHERE shipmentID = @shipmentId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by CostType ──
router.get('/costtype/:costType', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('costType', sql.NVarChar, req.params.costType)
            .query('SELECT * FROM Logistics.dbo.ShipmentCost WHERE costType = @costType');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
// costID is an IDENTITY column — SQL Server assigns it automatically.
// Do not include it in the INSERT; use SCOPE_IDENTITY() to read it back.
router.post('/', async (req, res) => {
    try {
        const {
            shipmentID, costType, costElement, costCenter,
            expectedCost, actualCost, migoStatus, materialDocument
        } = req.body;

        const pool = await getPool();
        const result = await pool.request()
            .input('shipmentID', sql.BigInt, shipmentID)
            .input('costType', sql.NVarChar, costType)
            .input('costElement', sql.NVarChar, costElement)
            .input('costCenter', sql.NVarChar, costCenter)
            .input('expectedCost', sql.Decimal, expectedCost)
            .input('actualCost', sql.Decimal, actualCost)
            .input('migoStatus', sql.Bit, migoStatus)
            .input('materialDocument', sql.NVarChar, materialDocument)
            .query(`INSERT INTO Logistics.dbo.ShipmentCost
                (shipmentID, costType, costElement, costCenter,
                 expectedCost, actualCost, migoStatus, materialDocument)
                VALUES
                (@shipmentID, @costType, @costElement, @costCenter,
                 @expectedCost, @actualCost, @migoStatus, @materialDocument);
                SELECT SCOPE_IDENTITY() AS costID;`);

        const newId = result.recordset[0].costID;
        res.status(201).json({ message: 'Record created successfully', costID: newId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
