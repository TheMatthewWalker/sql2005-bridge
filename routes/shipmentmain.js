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
            .query('SELECT * FROM dbo.ShipmentMain');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by ShipmentID ──
router.get('/id/:shipmentId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('shipmentId', sql.BigInt, req.params.shipmentId)
            .query('SELECT * FROM dbo.ShipmentMain WHERE shipmentID = @shipmentId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by ForwarderID ──
router.get('/forwarder/:forwarderId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('forwarderId', sql.BigInt, req.params.forwarderId)
            .query('SELECT * FROM dbo.ShipmentMain WHERE forwarderID = @forwarderId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by DestinationID ──
router.get('/destination/:destinationId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('destinationId', sql.BigInt, req.params.destinationId)
            .query('SELECT * FROM dbo.ShipmentMain WHERE destinationID = @destinationId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by planned collection date range ──
router.get('/daterange', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const pool = await getPool();
        const result = await pool.request()
            .input('dateFrom', sql.DateTime, new Date(dateFrom))
            .input('dateTo', sql.DateTime, new Date(dateTo))
            .query('SELECT * FROM dbo.ShipmentMain WHERE plannedCollection BETWEEN @dateFrom AND @dateTo');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
// shipmentID is an IDENTITY column — SQL Server assigns it automatically.
// Do not include it in the INSERT; use SCOPE_IDENTITY() to read it back.
router.post('/', async (req, res) => {
    try {
        const {
            originID, originName, originStreet, originCity, originPostCode, originCountry,
            destinationID, destinationName, destinationStreet, destinationCity, destinationPostCode, destinationCountry,
            netWeight, grossWeight, palletCount, shipmentVolume, plannedCollection, actualCollection,
            collectionStatus, forwarderID, trackingNumber, incoTerms, customsRequired, customsComplete, shipmentCancelled
        } = req.body;

        const pool = await getPool();
        const result = await pool.request()
            .input('originID', sql.BigInt, originID)
            .input('originName', sql.NVarChar, originName)
            .input('originStreet', sql.NVarChar, originStreet)
            .input('originCity', sql.NVarChar, originCity)
            .input('originPostCode', sql.NVarChar, originPostCode)
            .input('originCountry', sql.NVarChar, originCountry)
            .input('destinationID', sql.BigInt, destinationID)
            .input('destinationName', sql.NVarChar, destinationName)
            .input('destinationStreet', sql.NVarChar, destinationStreet)
            .input('destinationCity', sql.NVarChar, destinationCity)
            .input('destinationPostCode', sql.NVarChar, destinationPostCode)
            .input('destinationCountry', sql.NVarChar, destinationCountry)
            .input('netWeight', sql.Decimal, netWeight)
            .input('grossWeight', sql.Decimal, grossWeight)
            .input('palletCount', sql.BigInt, palletCount)
            .input('shipmentVolume', sql.Decimal, shipmentVolume)
            .input('plannedCollection', sql.DateTime, plannedCollection ? new Date(plannedCollection) : null)
            .input('actualCollection', sql.DateTime, actualCollection ? new Date(actualCollection) : null)
            .input('collectionStatus', sql.Bit, collectionStatus)
            .input('forwarderID', sql.BigInt, forwarderID)
            .input('trackingNumber', sql.NVarChar, trackingNumber)
            .input('incoTerms', sql.NVarChar, incoTerms)
            .input('customsRequired', sql.Bit, customsRequired)
            .input('customsComplete', sql.Bit, customsComplete)
            .input('shipmentCancelled', sql.Bit, shipmentCancelled)
            .query(`INSERT INTO dbo.ShipmentMain
                (originID, originName, originStreet, originCity, originPostCode, originCountry,
                 destinationID, destinationName, destinationStreet, destinationCity, destinationPostCode, destinationCountry,
                 netWeight, grossWeight, palletCount, shipmentVolume, plannedCollection, actualCollection,
                 collectionStatus, forwarderID, trackingNumber, incoTerms, customsRequired, customsComplete, shipmentCancelled)
                VALUES
                (@originID, @originName, @originStreet, @originCity, @originPostCode, @originCountry,
                 @destinationID, @destinationName, @destinationStreet, @destinationCity, @destinationPostCode, @destinationCountry,
                 @netWeight, @grossWeight, @palletCount, @shipmentVolume, @plannedCollection, @actualCollection,
                 @collectionStatus, @forwarderID, @trackingNumber, @incoTerms, @customsRequired, @customsComplete, @shipmentCancelled);
                SELECT SCOPE_IDENTITY() AS shipmentID;`);

        const newId = result.recordset[0].shipmentID;
        res.status(201).json({ message: 'Record created successfully', shipmentID: newId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
