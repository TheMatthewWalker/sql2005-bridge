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
            .query('SELECT * FROM Logistics.dbo.PalletMain');
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
            .input('palletId', sql.BigInt, req.params.palletId)
            .query('SELECT * FROM Logistics.dbo.PalletMain WHERE palletID = @palletId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by Category ──
router.get('/category/:category', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('category', sql.NVarChar, req.params.category)
            .query('SELECT * FROM Logistics.dbo.PalletMain WHERE palletCategory = @category');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by Location ──
router.get('/location/:location', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('location', sql.NVarChar, req.params.location)
            .query('SELECT * FROM Logistics.dbo.PalletMain WHERE palletLocation = @location');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
// palletID is an IDENTITY column — SQL Server assigns it automatically.
// Do not include it in the INSERT; use SCOPE_IDENTITY() to read it back.
router.post('/', async (req, res) => {
    try {
        const {
            palletType, palletFinish, packagingWeight, grossWeight,
            palletVolume, palletLength, palletWidth, palletHeight,
            palletRemoved, palletCategory, palletLocation, palletCreationDate, palletFinishDate
        } = req.body;

        const pool = await getPool();
        const result = await pool.request()
            .input('palletType', sql.NVarChar, palletType)
            .input('palletFinish', sql.Bit, palletFinish)
            .input('packagingWeight', sql.Decimal, packagingWeight)
            .input('grossWeight', sql.Decimal, grossWeight)
            .input('palletVolume', sql.Decimal, palletVolume)
            .input('palletLength', sql.Int, palletLength)
            .input('palletWidth', sql.Int, palletWidth)
            .input('palletHeight', sql.Int, palletHeight)
            .input('palletRemoved', sql.Bit, palletRemoved)
            .input('palletCategory', sql.NVarChar, palletCategory)
            .input('palletLocation', sql.NVarChar, palletLocation)
            .input('palletCreationDate', sql.DateTime, palletCreationDate ? new Date(palletCreationDate) : null)
            .input('palletFinishDate', sql.DateTime, palletFinishDate ? new Date(palletFinishDate) : null)
            .query(`INSERT INTO Logistics.dbo.PalletMain
                (palletType, palletFinish, packagingWeight, grossWeight,
                 palletVolume, palletLength, palletWidth, palletHeight,
                 palletRemoved, palletCategory, palletLocation, palletCreationDate, palletFinishDate)
                VALUES
                (@palletType, @palletFinish, @packagingWeight, @grossWeight,
                 @palletVolume, @palletLength, @palletWidth, @palletHeight,
                 @palletRemoved, @palletCategory, @palletLocation, @palletCreationDate, @palletFinishDate);
                SELECT SCOPE_IDENTITY() AS palletID;`);

        const newId = result.recordset[0].palletID;
        res.status(201).json({ message: 'Record created successfully', palletID: newId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
