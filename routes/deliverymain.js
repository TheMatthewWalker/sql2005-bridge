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
            .query('SELECT * FROM dbo.DeliveryMain');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by DeliveryID ──
router.get('/id/:deliveryId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('deliveryId', sql.BigInt, req.params.deliveryId)
            .query('SELECT * FROM dbo.DeliveryMain WHERE deliveryID = @deliveryId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by CustomerID ──
router.get('/customer/:customerId', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('customerId', sql.BigInt, req.params.customerId)
            .query('SELECT * FROM dbo.DeliveryMain WHERE customerID = @customerId');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by Operator ──
router.get('/operator/:operatorName', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('operatorName', sql.NVarChar, req.params.operatorName)
            .query('SELECT * FROM dbo.DeliveryMain WHERE operatorName = @operatorName');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Get by due date range ──
router.get('/daterange', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const pool = await getPool();
        const result = await pool.request()
            .input('dateFrom', sql.DateTime, new Date(dateFrom))
            .input('dateTo', sql.DateTime, new Date(dateTo))
            .query('SELECT * FROM dbo.DeliveryMain WHERE dueDate BETWEEN @dateFrom AND @dateTo');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create new record ──
router.post('/', async (req, res) => {
    try {
        const {
            deliveryID, customerID, dueDate, completionDate, completionStatus,
            operatorName, supervisorName, netWeight, grossWeight, palletCount,
            deliveryVolume, picksheetComment, deliveryCancelled, deliveryPriority
        } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('deliveryID', sql.BigInt, deliveryID)
            .input('customerID', sql.BigInt, customerID)
            .input('dueDate', sql.DateTime, dueDate ? new Date(dueDate) : null)
            .input('completionDate', sql.DateTime, completionDate ? new Date(completionDate) : null)
            .input('completionStatus', sql.Bit, completionStatus)
            .input('operatorName', sql.NVarChar, operatorName)
            .input('supervisorName', sql.NVarChar, supervisorName)
            .input('netWeight', sql.Decimal, netWeight)
            .input('grossWeight', sql.Decimal, grossWeight)
            .input('palletCount', sql.Decimal, palletCount)
            .input('deliveryVolume', sql.Decimal, deliveryVolume)
            .input('picksheetComment', sql.NVarChar, picksheetComment)
            .input('deliveryCancelled', sql.Bit, deliveryCancelled)
            .input('deliveryPriority', sql.Int, deliveryPriority)
            .query(`INSERT INTO dbo.DeliveryMain
                (deliveryID, customerID, dueDate, completionDate, completionStatus,
                 operatorName, supervisorName, netWeight, grossWeight, palletCount,
                 deliveryVolume, picksheetComment, deliveryCancelled, deliveryPriority)
                VALUES
                (@deliveryID, @customerID, @dueDate, @completionDate, @completionStatus,
                 @operatorName, @supervisorName, @netWeight, @grossWeight, @palletCount,
                 @deliveryVolume, @picksheetComment, @deliveryCancelled, @deliveryPriority)`);

        res.status(201).json({ message: 'Record created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
