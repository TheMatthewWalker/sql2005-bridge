import express from 'express';
import sql     from 'mssql';
import { getProductionPool } from '../server.js';

const router = express.Router();

// ── Process configuration ─────────────────────────────────────────────────────
// Maps each ProcessCode to its table metadata. Used by generic endpoints.
const PROCESS = {
  MX:  { table: 'prod.Mixing',       pk: 'MixingID',       ref: 'MixRef',    uom: 'KG', qtyCol: 'TotalWeightKG' },
  EXT: { table: 'prod.Extrusion',    pk: 'ExtrusionID',    ref: 'ExtRef',    uom: 'M',  qtyCol: 'LengthMetres'  },
  CO:  { table: 'prod.Convoluting',  pk: 'ConvolutingID',  ref: 'ConvRef',   uom: 'M',  qtyCol: 'LengthMetres'  },
  BR:  { table: 'prod.Braiding',     pk: 'BraidingID',     ref: 'BraidRef',  uom: 'M',  qtyCol: 'LengthMetres'  },
  CL:  { table: 'prod.Coverline',    pk: 'CoverlineID',    ref: 'CovRef',    uom: 'M',  qtyCol: 'LengthMetres'  },
  TW:  { table: 'prod.TapeWrap',     pk: 'TapeWrapID',     ref: 'TWRef',     uom: 'M',  qtyCol: 'LengthMetres'  },
  DR:  { table: 'prod.Drumming',     pk: 'DrummingID',     ref: 'DrumRef',   uom: 'M',  qtyCol: 'LengthMetres'  },
  EW:  { table: 'prod.Ewald',        pk: 'EwaldID',        ref: 'EwaldRef',  uom: 'EA', qtyCol: 'TotalPiecesEA' },
  FW:  { table: 'prod.Firewall',     pk: 'FirewallID',     ref: 'FWRef',     uom: 'EA', qtyCol: 'TotalInspectedEA' },
  HA:  { table: 'prod.HoseAssembly', pk: 'HoseAssemblyID', ref: 'HARef',     uom: 'EA', qtyCol: 'QuantityEA'    },
};

function processConfig(code) {
  const cfg = PROCESS[code];
  if (!cfg) throw Object.assign(new Error(`Unknown process code: ${code}`), { statusCode: 400 });
  return cfg;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeEvent(pool, processCode, recordId, eventType, message, severity, userId) {
  await pool.request()
    .input('pc',  sql.NVarChar(5),   processCode)
    .input('rid', sql.Int,           recordId)
    .input('et',  sql.NVarChar(20),  eventType)
    .input('msg', sql.NVarChar(sql.MAX), message)
    .input('sev', sql.TinyInt,       severity ?? 0)
    .input('uid', sql.Int,           userId)
    .query(`INSERT INTO prod.EventLog
              (ProcessCode, ProcessRecordID, EventType, EventMessage, Severity, CreatedByUserID)
            VALUES (@pc, @rid, @et, @msg, @sev, @uid)`);
}

function userId(req) { return req.session?.user?.userID ?? 0; }

// ── Reference data ────────────────────────────────────────────────────────────

router.get('/shifts', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request().query(`SELECT ShiftID, ShiftName, StartTime, EndTime, SpansMidnight FROM prod.Shifts WHERE IsActive = 1 ORDER BY ShiftID`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

router.get('/work-centres', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request().query(`
      SELECT wc.WorkCentreID, wc.ProcessCode, wc.WorkCentreName, wc.SAPWorkCentre,
             m.MachineID, m.MachineCode, m.MachineName, m.IdealOutputPerHour, m.PlannedHoursPerShift
      FROM   prod.WorkCentres wc
      LEFT JOIN prod.Machines m ON m.WorkCentreID = wc.WorkCentreID AND m.IsActive = 1
      WHERE  wc.IsActive = 1
      ORDER BY wc.ProcessCode, wc.WorkCentreName, m.MachineCode`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/scrap-reasons', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request().query(`SELECT ReasonID, ReasonCode, ReasonDescription, AppliesTo FROM prod.ScrapReasons WHERE IsActive = 1 ORDER BY ReasonCode`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Active batches (live dashboard) ──────────────────────────────────────────

router.get('/active', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request().query(`
      SELECT ab.ProcessCode, ab.RecordID, ab.BatchRef, ab.Material,
             ab.Quantity, ab.UOM, ab.Status, ab.ShiftID, ab.MachineID,
             ab.CreatedAt, ab.StartedAt,
             s.ShiftName,
             m.MachineCode, m.MachineName,
             sc.StatusName,
             -- Primary operator name via kongsberg PortalUsers
             pu.Username AS PrimaryOperator
      FROM   prod.vw_ActiveBatches ab
      LEFT JOIN prod.Shifts      s  ON s.ShiftID    = ab.ShiftID
      LEFT JOIN prod.Machines    m  ON m.MachineID  = ab.MachineID
      LEFT JOIN prod.StatusCodes sc ON sc.StatusID  = ab.Status
      LEFT JOIN prod.BatchOperators bo
        ON bo.ProcessCode = ab.ProcessCode AND bo.ProcessRecordID = ab.RecordID
        AND bo.IsPrimary = 1 AND bo.RemovedAt IS NULL
      LEFT JOIN kongsberg.dbo.PortalUsers pu ON pu.UserID = bo.UserID
      ORDER BY ab.StartedAt DESC, ab.CreatedAt DESC`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Single batch detail ───────────────────────────────────────────────────────

router.get('/batch/:processCode/:recordId', async (req, res) => {
  try {
    const cfg  = processConfig(req.params.processCode.toUpperCase());
    const id   = Number(req.params.recordId);
    const pool = await getProductionPool();

    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM ${cfg.table} WHERE ${cfg.pk} = @id`);

    if (!r.recordset.length) return res.status(404).json({ success: false, error: 'Batch not found.' });

    // Operators
    const ops = await pool.request()
      .input('pc',  sql.NVarChar(5), req.params.processCode.toUpperCase())
      .input('rid', sql.Int, id)
      .query(`SELECT bo.BatchOperatorID, bo.UserID, bo.IsPrimary, bo.AssignedAt, bo.RemovedAt,
                     pu.Username
              FROM   prod.BatchOperators bo
              LEFT JOIN kongsberg.dbo.PortalUsers pu ON pu.UserID = bo.UserID
              WHERE  bo.ProcessCode = @pc AND bo.ProcessRecordID = @rid
              ORDER BY bo.IsPrimary DESC, bo.AssignedAt`);

    res.json({ success: true, data: { batch: r.recordset[0], operators: ops.recordset } });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

// ── Create new batch ──────────────────────────────────────────────────────────

router.post('/batch', async (req, res) => {
  const { processCode, shiftID, machineID, material, operatorUserID, ...extra } = req.body;
  if (!processCode || !shiftID || !material)
    return res.status(400).json({ success: false, error: 'processCode, shiftID and material are required.' });

  const code = processCode.toUpperCase();
  const uid  = operatorUserID ?? userId(req);

  try {
    processConfig(code); // validates code
    const pool = await getProductionPool();
    let insertId;

    // Process-specific insert
    if (code === 'MX') {
      const { mixCode, supplierBatchNo, supplierTubNo, notes } = extra;
      const r = await pool.request()
        .input('shift',   sql.TinyInt,    shiftID)
        .input('mat',     sql.NVarChar(18), material)
        .input('mc',      sql.NVarChar(18), mixCode || '')
        .input('sbn',     sql.NVarChar(50), supplierBatchNo || '')
        .input('stn',     sql.NVarChar(20), supplierTubNo || '')
        .input('uid',     sql.Int,          uid)
        .input('notes',   sql.NVarChar(sql.MAX), notes || null)
        .query(`INSERT INTO prod.Mixing (ShiftID,Material,MixCode,SupplierBatchNo,SupplierTubNo,CreatedByUserID,Notes)
                OUTPUT INSERTED.MixingID VALUES (@shift,@mat,@mc,@sbn,@stn,@uid,@notes)`);
      insertId = r.recordset[0].MixingID;

    } else if (code === 'DR') {
      const { productBarcode, salesOrderSAP, notes } = extra;
      if (!productBarcode || !salesOrderSAP)
        return res.status(400).json({ success: false, error: 'productBarcode and salesOrderSAP required for Drumming.' });
      const r = await pool.request()
        .input('shift',  sql.TinyInt,    shiftID)
        .input('mach',   sql.Int,        machineID || null)
        .input('mat',    sql.NVarChar(18), material)
        .input('bar',    sql.NVarChar(50), productBarcode)
        .input('so',     sql.NVarChar(12), salesOrderSAP)
        .input('uid',    sql.Int,          uid)
        .input('notes',  sql.NVarChar(sql.MAX), notes || null)
        .query(`INSERT INTO prod.Drumming (ShiftID,MachineID,Material,ProductBarcode,SalesOrderSAP,CreatedByUserID,Notes)
                OUTPUT INSERTED.DrummingID VALUES (@shift,@mach,@mat,@bar,@so,@uid,@notes)`);
      insertId = r.recordset[0].DrummingID;

    } else if (code === 'EW') {
      const { firewallRequired, notes } = extra;
      const r = await pool.request()
        .input('shift',  sql.TinyInt,    shiftID)
        .input('mach',   sql.Int,        machineID || null)
        .input('mat',    sql.NVarChar(18), material)
        .input('fw',     sql.Bit,         firewallRequired !== false ? 1 : 0)
        .input('uid',    sql.Int,          uid)
        .input('notes',  sql.NVarChar(sql.MAX), notes || null)
        .query(`INSERT INTO prod.Ewald (ShiftID,MachineID,Material,FirewallRequired,CreatedByUserID,Notes)
                OUTPUT INSERTED.EwaldID VALUES (@shift,@mach,@mat,@fw,@uid,@notes)`);
      insertId = r.recordset[0].EwaldID;

    } else if (code === 'FW') {
      const { ewaldID } = extra;
      if (!ewaldID) return res.status(400).json({ success: false, error: 'ewaldID required for Firewall.' });
      const r = await pool.request()
        .input('ewid',   sql.Int, ewaldID)
        .input('uid',    sql.Int, uid)
        .input('notes',  sql.NVarChar(sql.MAX), extra.notes || null)
        .query(`INSERT INTO prod.Firewall (EwaldID,InspectedByUserID,Notes)
                OUTPUT INSERTED.FirewallID VALUES (@ewid,@uid,@notes)`);
      insertId = r.recordset[0].FirewallID;

    } else if (code === 'HA') {
      const { salesOrderSAP, notes } = extra;
      // Snapshot QA routing
      const qaRow = await pool.request()
        .input('mat', sql.NVarChar(18), material)
        .query(`SELECT RequiresQA FROM prod.HoseAssemblyQARouting WHERE Material = @mat`);
      const requiresQA = qaRow.recordset[0]?.RequiresQA ?? 0;
      const r = await pool.request()
        .input('shift',  sql.TinyInt,    shiftID)
        .input('mach',   sql.Int,        machineID || null)
        .input('mat',    sql.NVarChar(18), material)
        .input('so',     sql.NVarChar(12), salesOrderSAP || null)
        .input('qa',     sql.Bit,          requiresQA)
        .input('uid',    sql.Int,          uid)
        .input('notes',  sql.NVarChar(sql.MAX), notes || null)
        .query(`INSERT INTO prod.HoseAssembly (ShiftID,MachineID,Material,SalesOrderSAP,RequiresQA,CreatedByUserID,Notes)
                OUTPUT INSERTED.HoseAssemblyID VALUES (@shift,@mach,@mat,@so,@qa,@uid,@notes)`);
      insertId = r.recordset[0].HoseAssemblyID;

    } else {
      // Generic metre-based processes: EXT, CO, BR, CL, TW
      const cfg = PROCESS[code];
      const r = await pool.request()
        .input('shift',  sql.TinyInt,    shiftID)
        .input('mach',   sql.Int,        machineID || null)
        .input('mat',    sql.NVarChar(18), material)
        .input('uid',    sql.Int,          uid)
        .input('notes',  sql.NVarChar(sql.MAX), extra.notes || null)
        .query(`INSERT INTO ${cfg.table} (ShiftID,MachineID,Material,CreatedByUserID,Notes)
                OUTPUT INSERTED.${cfg.pk} VALUES (@shift,@mach,@mat,@uid,@notes)`);
      insertId = r.recordset[0][cfg.pk];
    }

    // Primary operator
    await pool.request()
      .input('pc',  sql.NVarChar(5), code)
      .input('rid', sql.Int, insertId)
      .input('uid', sql.Int, uid)
      .query(`INSERT INTO prod.BatchOperators (ProcessCode,ProcessRecordID,UserID,IsPrimary,AssignedByUserID)
              VALUES (@pc,@rid,@uid,1,@uid)`);

    // Event log
    await writeEvent(pool, code, insertId, 'STARTED', `Batch created by user ${uid}`, 0, uid);

    res.status(201).json({ success: true, data: { processCode: code, recordId: insertId } });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

// ── Update batch status ───────────────────────────────────────────────────────

router.patch('/batch/:processCode/:recordId/status', async (req, res) => {
  const code = req.params.processCode.toUpperCase();
  const id   = Number(req.params.recordId);
  const { status } = req.body;
  if (!status) return res.status(400).json({ success: false, error: 'status is required.' });

  try {
    const cfg  = processConfig(code);
    const pool = await getProductionPool();
    const uid  = userId(req);

    const setClause = status === 2 /* IN_PROGRESS */ ? `Status=@s, StartedAt=GETDATE()`
                    : status === 4 /* COMPLETE */     ? `Status=@s, CompletedAt=GETDATE()`
                    : `Status=@s`;

    await pool.request()
      .input('id', sql.Int,    id)
      .input('s',  sql.TinyInt, status)
      .query(`UPDATE ${cfg.table} SET ${setClause} WHERE ${cfg.pk}=@id AND IsReversed=0`);

    const statusNames = { 1:'OPEN', 2:'IN_PROGRESS', 3:'ON_HOLD', 4:'COMPLETE', 5:'CANCELLED' };
    await writeEvent(pool, code, id, statusNames[status] ?? 'NOTE', `Status changed to ${statusNames[status] ?? status}`, 0, uid);

    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

// ── Update batch quantity ─────────────────────────────────────────────────────

router.patch('/batch/:processCode/:recordId/quantity', async (req, res) => {
  const code = req.params.processCode.toUpperCase();
  const id   = Number(req.params.recordId);
  const { quantity } = req.body;
  if (quantity == null) return res.status(400).json({ success: false, error: 'quantity is required.' });

  try {
    const cfg  = processConfig(code);
    const pool = await getProductionPool();

    await pool.request()
      .input('id', sql.Int,            id)
      .input('q',  sql.Decimal(12, 3), quantity)
      .query(`UPDATE ${cfg.table} SET ${cfg.qtyCol}=@q WHERE ${cfg.pk}=@id AND IsReversed=0`);

    res.json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

// ── Operators ─────────────────────────────────────────────────────────────────

router.post('/batch/:processCode/:recordId/operators', async (req, res) => {
  const code = req.params.processCode.toUpperCase();
  const id   = Number(req.params.recordId);
  const { addUserID } = req.body;
  if (!addUserID) return res.status(400).json({ success: false, error: 'addUserID is required.' });

  try {
    processConfig(code);
    const pool  = await getProductionPool();
    const uid   = userId(req);

    // Check not already active on this batch
    const exists = await pool.request()
      .input('pc',  sql.NVarChar(5), code)
      .input('rid', sql.Int, id)
      .input('uid', sql.Int, addUserID)
      .query(`SELECT 1 FROM prod.BatchOperators WHERE ProcessCode=@pc AND ProcessRecordID=@rid AND UserID=@uid AND RemovedAt IS NULL`);
    if (exists.recordset.length) return res.status(409).json({ success: false, error: 'User is already active on this batch.' });

    await pool.request()
      .input('pc',  sql.NVarChar(5), code)
      .input('rid', sql.Int, id)
      .input('uid', sql.Int, addUserID)
      .input('by',  sql.Int, uid)
      .query(`INSERT INTO prod.BatchOperators (ProcessCode,ProcessRecordID,UserID,IsPrimary,AssignedByUserID) VALUES (@pc,@rid,@uid,0,@by)`);

    await writeEvent(pool, code, id, 'OPERATOR_ADD', `User ${addUserID} added to batch`, 0, uid);
    res.status(201).json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

router.delete('/batch/:processCode/:recordId/operators/:targetUserId', async (req, res) => {
  const code       = req.params.processCode.toUpperCase();
  const id         = Number(req.params.recordId);
  const targetUid  = Number(req.params.targetUserId);

  try {
    processConfig(code);
    const pool = await getProductionPool();
    const uid  = userId(req);

    await pool.request()
      .input('pc',  sql.NVarChar(5), code)
      .input('rid', sql.Int, id)
      .input('uid', sql.Int, targetUid)
      .query(`UPDATE prod.BatchOperators SET RemovedAt=GETDATE() WHERE ProcessCode=@pc AND ProcessRecordID=@rid AND UserID=@uid AND RemovedAt IS NULL`);

    await writeEvent(pool, code, id, 'OPERATOR_REMOVE', `User ${targetUid} removed from batch`, 0, uid);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Traceability ──────────────────────────────────────────────────────────────

router.post('/trace', async (req, res) => {
  const { childProcessCode, childRecordID, parentProcessCode, parentRecordID } = req.body;
  if (!childProcessCode || !childRecordID || !parentProcessCode || !parentRecordID)
    return res.status(400).json({ success: false, error: 'childProcessCode, childRecordID, parentProcessCode, parentRecordID are required.' });

  try {
    const pool = await getProductionPool();
    const uid  = userId(req);

    await pool.request()
      .input('cc', sql.NVarChar(5), childProcessCode.toUpperCase())
      .input('cr', sql.Int, childRecordID)
      .input('pc', sql.NVarChar(5), parentProcessCode.toUpperCase())
      .input('pr', sql.Int, parentRecordID)
      .input('uid', sql.Int, uid)
      .query(`INSERT INTO prod.ProductionTrace (ChildProcessCode,ChildRecordID,ParentProcessCode,ParentRecordID,LinkedByUserID)
              VALUES (@cc,@cr,@pc,@pr,@uid)`);

    res.status(201).json({ success: true });
  } catch (err) {
    if (err.number === 2627) return res.status(409).json({ success: false, error: 'This trace link already exists.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/trace/:processCode/:recordId', async (req, res) => {
  const code = req.params.processCode.toUpperCase();
  const id   = Number(req.params.recordId);

  try {
    const pool = await getProductionPool();
    // Recursive CTE — traces all ancestors of a given batch
    const r = await pool.request()
      .input('cc', sql.NVarChar(5), code)
      .input('cr', sql.Int, id)
      .query(`
        WITH TraceChain AS (
          SELECT ChildProcessCode, ChildRecordID, ParentProcessCode, ParentRecordID, 0 AS Depth
          FROM   prod.ProductionTrace
          WHERE  ChildProcessCode = @cc AND ChildRecordID = @cr
          UNION ALL
          SELECT t.ChildProcessCode, t.ChildRecordID, t.ParentProcessCode, t.ParentRecordID, tc.Depth + 1
          FROM   prod.ProductionTrace t
          INNER JOIN TraceChain tc ON t.ChildProcessCode = tc.ParentProcessCode AND t.ChildRecordID = tc.ParentRecordID
        )
        SELECT * FROM TraceChain ORDER BY Depth`);

    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Scrap ─────────────────────────────────────────────────────────────────────

router.post('/scrap', async (req, res) => {
  const { processCode, processRecordID, reasonID, quantity, unitOfMeasure, notes } = req.body;
  if (!processCode || !processRecordID || !reasonID || !quantity || !unitOfMeasure)
    return res.status(400).json({ success: false, error: 'processCode, processRecordID, reasonID, quantity, unitOfMeasure are required.' });

  try {
    processConfig(processCode.toUpperCase());
    const pool = await getProductionPool();
    const uid  = userId(req);

    await pool.request()
      .input('pc',  sql.NVarChar(5),   processCode.toUpperCase())
      .input('rid', sql.Int,           processRecordID)
      .input('rid2', sql.Int,          reasonID)
      .input('qty', sql.Decimal(12,3), quantity)
      .input('uom', sql.NVarChar(5),   unitOfMeasure)
      .input('uid', sql.Int,           uid)
      .input('notes', sql.NVarChar(sql.MAX), notes || null)
      .query(`INSERT INTO prod.ScrapEntries (ProcessCode,ProcessRecordID,ReasonID,Quantity,UnitOfMeasure,EnteredByUserID,Notes)
              VALUES (@pc,@rid,@rid2,@qty,@uom,@uid,@notes)`);

    await writeEvent(pool, processCode.toUpperCase(), processRecordID, 'SCRAP',
      `Scrap: ${quantity} ${unitOfMeasure} — reason ${reasonID}`, 1, uid);

    res.status(201).json({ success: true });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});

// ── Event log ─────────────────────────────────────────────────────────────────

router.get('/batch/:processCode/:recordId/events', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request()
      .input('pc',  sql.NVarChar(5), req.params.processCode.toUpperCase())
      .input('rid', sql.Int,         Number(req.params.recordId))
      .query(`SELECT EventID, EventType, EventMessage, Severity, CreatedAt, CreatedByUserID
              FROM   prod.EventLog
              WHERE  ProcessCode = @pc AND ProcessRecordID = @rid
              ORDER BY CreatedAt DESC`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/event', async (req, res) => {
  const { processCode, processRecordID, eventType, message, severity } = req.body;
  if (!processCode || !processRecordID || !eventType || !message)
    return res.status(400).json({ success: false, error: 'processCode, processRecordID, eventType and message are required.' });
  try {
    const pool = await getProductionPool();
    await writeEvent(pool, processCode.toUpperCase(), processRecordID, eventType, message, severity ?? 0, userId(req));
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Batch history ─────────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  const { processCode, material, ref, fromDate, toDate, page = 1, pageSize = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  try {
    const pool = await getProductionPool();
    const parts = [];
    const request = pool.request()
      .input('offset',   sql.Int, offset)
      .input('pageSize', sql.Int, Number(pageSize));

    if (processCode) { parts.push(`ProcessCode = @pc`);   request.input('pc',  sql.NVarChar(5),  processCode.toUpperCase()); }
    if (material)    { parts.push(`Material = @mat`);     request.input('mat', sql.NVarChar(18), material); }
    if (ref)         { parts.push(`BatchRef LIKE @ref`);  request.input('ref', sql.NVarChar(20), `%${ref}%`); }
    if (fromDate)    { parts.push(`CreatedAt >= @from`);  request.input('from', sql.DateTime, new Date(fromDate)); }
    if (toDate)      { parts.push(`CreatedAt <= @to`);    request.input('to',   sql.DateTime, new Date(toDate)); }

    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

    // SQL 2005-compatible pagination: ROW_NUMBER() applied to the outer UNION ALL
    const hist = await pool.request()
      .input('offset',   sql.Int, offset)
      .input('pageSize', sql.Int, Number(pageSize))
      .query(`
        SELECT ProcessCode, RecordID, BatchRef, Material, Quantity, UOM, Status, CreatedAt, CompletedAt
        FROM (
          SELECT ROW_NUMBER() OVER (ORDER BY CreatedAt DESC) AS RowNum,
                 PC AS ProcessCode, RID AS RecordID, BatchRef, Material, Qty AS Quantity, UOM, Status, CreatedAt, CompletedAt
          FROM (
            SELECT N'MX'  AS PC, MixingID       AS RID, MixRef     AS BatchRef, Material, CAST(TotalWeightKG         AS DECIMAL(12,3)) AS Qty, N'KG' AS UOM, Status, CreatedAt, CompletedAt FROM prod.Mixing       WHERE IsReversed=0
            UNION ALL SELECT N'EXT', ExtrusionID,    ExtRef,   Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.Extrusion    WHERE IsReversed=0
            UNION ALL SELECT N'CO',  ConvolutingID,  ConvRef,  Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.Convoluting  WHERE IsReversed=0
            UNION ALL SELECT N'BR',  BraidingID,     BraidRef, Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.Braiding     WHERE IsReversed=0
            UNION ALL SELECT N'CL',  CoverlineID,    CovRef,   Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.Coverline    WHERE IsReversed=0
            UNION ALL SELECT N'TW',  TapeWrapID,     TWRef,    Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.TapeWrap     WHERE IsReversed=0
            UNION ALL SELECT N'DR',  DrummingID,     DrumRef,  Material, LengthMetres,                         N'M',  Status, CreatedAt, CompletedAt FROM prod.Drumming     WHERE IsReversed=0
            UNION ALL SELECT N'EW',  EwaldID,        EwaldRef, Material, CAST(TotalPiecesEA AS DECIMAL(12,3)), N'EA', Status, CreatedAt, CompletedAt FROM prod.Ewald        WHERE IsReversed=0
            UNION ALL SELECT N'HA',  HoseAssemblyID, HARef,    Material, CAST(QuantityEA    AS DECIMAL(12,3)), N'EA', Status, CreatedAt, CompletedAt FROM prod.HoseAssembly WHERE IsReversed=0
          ) AS AllBatches
        ) AS Paged
        WHERE RowNum > @offset AND RowNum <= (@offset + @pageSize)
        ORDER BY CreatedAt DESC`);

    res.json({ success: true, data: hist.recordset, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Ewald boxes ───────────────────────────────────────────────────────────────

router.get('/ewald/:ewaldId/boxes', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request()
      .input('id', sql.Int, Number(req.params.ewaldId))
      .query(`SELECT EwaldBoxID, PiecesEA, CustomerCode, SAPBatchNumber, BackflushedAt, IsReversed, ReversedAt, ReversalDocumentSAP
              FROM   prod.EwaldBoxes WHERE EwaldID=@id ORDER BY EwaldBoxID`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/ewald/:ewaldId/boxes', async (req, res) => {
  const { piecesEA, customerCode, sapBatchNumber } = req.body;
  if (!piecesEA) return res.status(400).json({ success: false, error: 'piecesEA is required.' });
  try {
    const pool = await getProductionPool();
    const uid  = userId(req);
    const ewaldId = Number(req.params.ewaldId);

    await pool.request()
      .input('eid',  sql.Int,          ewaldId)
      .input('pcs',  sql.Int,          piecesEA)
      .input('cc',   sql.NVarChar(10), customerCode || null)
      .input('sap',  sql.NVarChar(10), sapBatchNumber || null)
      .input('uid',  sql.Int,          uid)
      .query(`INSERT INTO prod.EwaldBoxes (EwaldID,PiecesEA,CustomerCode,SAPBatchNumber,BackflushedAt,BackflushedByUserID)
              VALUES (@eid,@pcs,@cc,@sap,GETDATE(),@uid)`);

    await writeEvent(pool, 'EW', ewaldId, 'SAP_POST', `Box posted: ${piecesEA} EA — SAP batch ${sapBatchNumber || 'pending'}`, 0, uid);
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── SAP postings log ──────────────────────────────────────────────────────────

router.post('/sap-posting', async (req, res) => {
  const { processCode, processRecordID, postingType, quantity, unitOfMeasure,
          materialDocumentSAP, salesOrderSAP, productionOrderSAP, sapBatchNumber, isSuccess, errorMessage } = req.body;
  try {
    const pool = await getProductionPool();
    const uid  = userId(req);

    await pool.request()
      .input('pc',   sql.NVarChar(5),   processCode.toUpperCase())
      .input('rid',  sql.Int,           processRecordID)
      .input('type', sql.NVarChar(20),  postingType)
      .input('qty',  sql.Decimal(12,3), quantity)
      .input('uom',  sql.NVarChar(5),   unitOfMeasure)
      .input('mdoc', sql.NVarChar(10),  materialDocumentSAP || null)
      .input('so',   sql.NVarChar(12),  salesOrderSAP || null)
      .input('po',   sql.NVarChar(12),  productionOrderSAP || null)
      .input('sb',   sql.NVarChar(10),  sapBatchNumber || null)
      .input('ok',   sql.Bit,           isSuccess ? 1 : 0)
      .input('err',  sql.NVarChar(sql.MAX), errorMessage || null)
      .input('uid',  sql.Int,           uid)
      .query(`INSERT INTO prod.SAPPostings
                (ProcessCode,ProcessRecordID,PostingType,Quantity,UnitOfMeasure,
                 MaterialDocumentSAP,SalesOrderSAP,ProductionOrderSAP,SAPBatchNumber,
                 IsSuccess,ErrorMessage,PostedByUserID)
              VALUES (@pc,@rid,@type,@qty,@uom,@mdoc,@so,@po,@sb,@ok,@err,@uid)`);

    const evt = isSuccess ? 'SAP_POST' : 'SAP_FAIL';
    await writeEvent(pool, processCode.toUpperCase(), processRecordID, evt,
      `${postingType} — ${quantity} ${unitOfMeasure} — doc: ${materialDocumentSAP || 'none'}`,
      isSuccess ? 0 : 2, uid);

    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Reversal ──────────────────────────────────────────────────────────────────

router.get('/reversal/search', async (req, res) => {
  const { materialDocument } = req.query;
  if (!materialDocument) return res.status(400).json({ success: false, error: 'materialDocument is required.' });
  try {
    const pool = await getProductionPool();
    const r = await pool.request()
      .input('doc', sql.NVarChar(10), materialDocument)
      .query(`SELECT SAPPostingID, ProcessCode, ProcessRecordID, PostingType, Quantity, UnitOfMeasure,
                     MaterialDocumentSAP, PostedAt, IsReversed
              FROM   prod.SAPPostings WHERE MaterialDocumentSAP = @doc`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/reversal/:sapPostingId', async (req, res) => {
  const { reversalDocumentSAP } = req.body;
  const postingId = Number(req.params.sapPostingId);
  if (!reversalDocumentSAP) return res.status(400).json({ success: false, error: 'reversalDocumentSAP is required.' });

  try {
    const pool = await getProductionPool();
    const uid  = userId(req);

    // Get the posting to find the process record
    const post = await pool.request()
      .input('id', sql.Int, postingId)
      .query(`SELECT ProcessCode, ProcessRecordID FROM prod.SAPPostings WHERE SAPPostingID=@id`);
    if (!post.recordset.length) return res.status(404).json({ success: false, error: 'SAP posting not found.' });

    const { ProcessCode, ProcessRecordID } = post.recordset[0];

    // Mark posting reversed
    await pool.request()
      .input('id',  sql.Int,          postingId)
      .input('doc', sql.NVarChar(10), reversalDocumentSAP)
      .input('uid', sql.Int,          uid)
      .query(`UPDATE prod.SAPPostings SET IsReversed=1, ReversalDocumentSAP=@doc, ReversedAt=GETDATE(), ReversedByUserID=@uid WHERE SAPPostingID=@id`);

    // Mark process record reversed
    const cfg = PROCESS[ProcessCode];
    if (cfg) {
      await pool.request()
        .input('rid', sql.Int, ProcessRecordID)
        .input('uid', sql.Int, uid)
        .query(`UPDATE ${cfg.table} SET IsReversed=1, ReversedAt=GETDATE(), ReversedByUserID=@uid WHERE ${cfg.pk}=@rid`);
    }

    await writeEvent(pool, ProcessCode, ProcessRecordID, 'REVERSAL',
      `SAP posting ${postingId} reversed — reversal doc: ${reversalDocumentSAP}`, 1, uid);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Scrap summary ────────────────────────────────────────────────────────────

router.get('/scrap/summary', async (req, res) => {
  try {
    const pool = await getProductionPool();
    const r = await pool.request().query(`
      SELECT se.ProcessCode,
             sr.ReasonCode, sr.ReasonDescription,
             se.UnitOfMeasure,
             COUNT(*)           AS EntryCount,
             SUM(se.Quantity)   AS TotalScrap
      FROM   prod.ScrapEntries se
      LEFT JOIN prod.ScrapReasons sr ON sr.ReasonID = se.ReasonID
      WHERE  se.EnteredAt >= DATEADD(day, -30, GETDATE())
      GROUP  BY se.ProcessCode, sr.ReasonCode, sr.ReasonDescription, se.UnitOfMeasure
      ORDER  BY se.ProcessCode, TotalScrap DESC`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/scrap/entries', async (req, res) => {
  const { processCode, processRecordID } = req.query;
  try {
    const pool = await getProductionPool();
    const request = pool.request();
    let where = '';
    if (processCode) {
      request.input('pc', sql.NVarChar(5), processCode.toUpperCase());
      where += ' AND se.ProcessCode = @pc';
    }
    if (processRecordID) {
      request.input('rid', sql.Int, Number(processRecordID));
      where += ' AND se.ProcessRecordID = @rid';
    }
    const r = await request.query(`
      SELECT se.ScrapID, se.ProcessCode, se.ProcessRecordID,
             sr.ReasonCode, sr.ReasonDescription,
             se.Quantity, se.UnitOfMeasure, se.EnteredAt, se.Notes
      FROM   prod.ScrapEntries se
      LEFT JOIN prod.ScrapReasons sr ON sr.ReasonID = se.ReasonID
      WHERE  1=1 ${where}
      ORDER BY se.EnteredAt DESC`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Portal users lookup (for operator search) ─────────────────────────────────

router.get('/users', async (req, res) => {
  const { q } = req.query;
  try {
    const pool = await getProductionPool();
    const r = await pool.request()
      .input('q', sql.NVarChar(80), `%${q || ''}%`)
      .query(`SELECT UserID, Username FROM kongsberg.dbo.PortalUsers
              WHERE IsActive=1 AND (Username LIKE @q) ORDER BY Username`);
    res.json({ success: true, data: r.recordset });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

export default router;
