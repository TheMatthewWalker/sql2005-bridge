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
            .query('SELECT * FROM dbo.PalletData');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by PalletID ──
router.get('/id/:palletId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('palletId', sql.NVarChar, req.params.palletId)
            .query('SELECT * FROM dbo.PalletData WHERE palletID = @palletId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
router.post('/', async (req, res) => {
    try {
        const { palletID, palletDescription, palletWeight, palletLength, palletWidth, palletHeight } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('palletID', sql.NVarChar, palletID)
            .input('palletDescription', sql.NVarChar, palletDescription)
            .input('palletWeight', sql.Decimal, palletWeight)
            .input('palletLength', sql.Int, palletLength)
            .input('palletWidth', sql.Int, palletWidth)
            .input('palletHeight', sql.Int, palletHeight)
            .query(`INSERT INTO dbo.PalletData (palletID, palletDescription, palletWeight, palletLength, palletWidth, palletHeight)
                    VALUES (@palletID, @palletDescription, @palletWeight, @palletLength, @palletWidth, @palletHeight)`);

        res.status(201).json({ message: 'Record created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
