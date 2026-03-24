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
            .query('SELECT * FROM Logistics.dbo.PalletValidation');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by PalletID ──
router.get('/pallet/:palletId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('palletId', sql.NVarChar, req.params.palletId)
            .query('SELECT * FROM Logistics.dbo.PalletValidation WHERE palletID = @palletId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by PackagingID ──
router.get('/packaging/:packagingId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('packagingId', sql.NVarChar, req.params.packagingId)
            .query('SELECT * FROM Logistics.dbo.PalletValidation WHERE packagingID = @packagingId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
router.post('/', async (req, res) => {
    try {
        const { palletID, packagingID } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('palletID', sql.NVarChar, palletID)
            .input('packagingID', sql.NVarChar, packagingID)
            .query(`INSERT INTO Logistics.dbo.PalletValidation (palletID, packagingID)
                    VALUES (@palletID, @packagingID)`);

        res.status(201).json({ message: 'Record created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
