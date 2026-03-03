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
            .query('SELECT * FROM dbo.RatesKN');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by CountryCode ──
router.get('/country/:countryCode', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('countryCode', sql.NVarChar, req.params.countryCode)
            .query('SELECT * FROM dbo.RatesKN WHERE countryCode = @countryCode');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by PostalCode ──
router.get('/postalcode/:postalCode', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('postalCode', sql.NVarChar, req.params.postalCode)
            .query('SELECT * FROM dbo.RatesKN WHERE postalCode = @postalCode');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
router.post('/', async (req, res) => {
    try {
        const { countryCode, postalCode, minWeight, maxWeight, agreedRate, transitTime } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('countryCode', sql.NVarChar, countryCode)
            .input('postalCode', sql.NVarChar, postalCode)
            .input('minWeight', sql.Int, minWeight)
            .input('maxWeight', sql.Int, maxWeight)
            .input('agreedRate', sql.Decimal, agreedRate)
            .input('transitTime', sql.Int, transitTime)
            .query(`INSERT INTO dbo.RatesKN (countryCode, postalCode, minWeight, maxWeight, agreedRate, transitTime)
                    VALUES (@countryCode, @postalCode, @minWeight, @maxWeight, @agreedRate, @transitTime)`);

        res.status(201).json({ message: 'Record created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
