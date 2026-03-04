/**
 * routes/reports.js
 *
 * Aggregate report endpoint — returns grouped summary data for charts.
 *
 * POST /api/reports
 * Body: { report, dateFrom, dateTo }
 *   report   — one of the keys in REPORTS below
 *   dateFrom — ISO date string e.g. "2024-01-01"  (from the date picker)
 *   dateTo   — ISO date string e.g. "2024-12-31"
 *
 * Returns: { success, rows: [{ label, value }], meta: { title, valueLabel } }
 *
 * ── Date handling note ──────────────────────────────────────────────────────
 * All date/datetime columns in this database are stored as nvarchar strings
 * in "dd.mm.yy hh:mm:ss" format (SQL Server format code 4 for the date part).
 *
 * To filter by date range we wrap each column in:
 *   CONVERT(datetime, col, 4)
 * which parses the string and strips the time, giving a proper date value
 * that can be compared against our @dateFrom / @dateTo parameters
 * (which arrive as YYYY-MM-DD and are cast to date with CONVERT(date, @p)).
 *
 * For the Staging lead-time calculation we need a datetime, so we use:
 *   CONVERT(datetime, col, 4)
 * which preserves the time component and allows DATEDIFF(minute, ...).
 *
 * Mount in server.js:
 *   import reportRoutes from './routes/reports.js';
 *   app.use('/api/reports', requireLogin, reportRoutes);
 */

import express from 'express';
import sql     from 'mssql';
import { sqlConfig } from '../server.js';

const router = express.Router();

// ── Report definitions ────────────────────────────────────────────────────────
// WHERE clause pattern for every report (except Staging):
//
//   CONVERT(datetime, <dateCol>, 4) >= CONVERT(date, @dateFrom)
//   CONVERT(datetime, <dateCol>, 4) <= CONVERT(date, @dateTo)
//
// Format code 4 = dd.mm.yy — matches the stored string format.
// CONVERT(date, @dateFrom) parses our YYYY-MM-DD picker value to a date.
// Using <= dateTo (inclusive) rather than < dateTo+1 keeps the SQL simpler.

const REPORTS = {

  Batches: {
    title:      'Total Length per Material',
    valueLabel: 'Total Length (m)',
    sql: `
      SELECT
        Material          AS label,
        SUM(TotalLength)  AS value
      FROM dbo.Batches
      WHERE CONVERT(datetime, LEFT(CreationDate, 8), 4) >= CONVERT(datetime, @dateFrom)
        AND CONVERT(datetime, LEFT(CreationDate, 8), 4) <= CONVERT(datetime, @dateTo)
      GROUP BY Material
      ORDER BY value DESC
    `,
  },

  Ewald: {
    title:      'Total Quantity per Material',
    valueLabel: 'Total Qty',
    sql: `
      SELECT
        Material          AS label,
        SUM(TotalQty)     AS value
      FROM dbo.Ewald
      CROSS APPLY (
        SELECT
          SUBSTRING(CreationDate, 7, 4) + '-' + SUBSTRING(CreationDate, 4, 2) + '-' + SUBSTRING(CreationDate, 1, 2) AS CreationIso
      ) d
      WHERE ISDATE(d.CreationIso) = 1
        AND d.CreationIso >= @dateFrom
        AND d.CreationIso <= @dateTo
      GROUP BY Material
      ORDER BY value DESC
    `,
  },

  Mixing: {
    title:      'Total Weight per Mix Code',
    valueLabel: 'Total Weight (kg)',
    sql: `
      SELECT
        MixCode           AS label,
        SUM(CAST(REPLACE(TotalWeight, ',', '.') AS decimal(18,4)))  AS value
      FROM dbo.Mixing
      CROSS APPLY (
        SELECT
          SUBSTRING(CreationDate, 7, 4) + '-' + SUBSTRING(CreationDate, 4, 2) + '-' + SUBSTRING(CreationDate, 1, 2) AS CreationIso
      ) d
      WHERE ISDATE(d.CreationIso) = 1
        AND d.CreationIso >= @dateFrom
        AND d.CreationIso <= @dateTo
      GROUP BY MixCode
      ORDER BY value DESC
    `,
  },

  Extrusion: {
    title:      'Metres per Material',
    valueLabel: 'Metres (m)',
    sql: `
      SELECT
        Material      AS label,
        SUM(Meters)   AS value
      FROM dbo.Extrusion
      CROSS APPLY (
        SELECT
          SUBSTRING(StartDate, 7, 4) + '-' + SUBSTRING(StartDate, 4, 2) + '-' + SUBSTRING(StartDate, 1, 2) AS CreationIso
      ) d
      WHERE ISDATE(d.CreationIso) = 1
        AND d.CreationIso >= @dateFrom
        AND d.CreationIso <= @dateTo
      GROUP BY Material
      ORDER BY value DESC
    `,
  },

  Convo: {
    title:      'Metres per Material',
    valueLabel: 'Metres (m)',
    sql: `
      SELECT
        Material      AS label,
        SUM(Meters)   AS value
      FROM dbo.Convo
      CROSS APPLY (
        SELECT
          SUBSTRING(RunDate, 7, 4) + '-' + SUBSTRING(RunDate, 4, 2) + '-' + SUBSTRING(RunDate, 1, 2) AS CreationIso
      ) d
      WHERE ISDATE(d.CreationIso) = 1
        AND d.CreationIso >= @dateFrom
        AND d.CreationIso <= @dateTo
      GROUP BY Material
      ORDER BY value DESC
    `,
  },

  Firewall: {
    title:      'Failed Percentage per Material',
    valueLabel: 'Failed Percentage',
    sql: `
      SELECT 
        a.Material as Label, 
        a.sapbatch as Batch, 
        a.reasoncode as Reason,
        MAX(d.total) / COUNT(a.sapbatch) as Total,
        SUM(a.failedqty) as Failed,
        MAX(e.CreationIso) as Date
      FROM dbo.firewall a
      JOIN 
        ( SELECT 
            b.sapbatch as sap, 
            MAX(b.pieces) as total, 
            c.creationdate as qdate 
          FROM dbo.ewaldboxes b 
          JOIN dbo.ewald c 
            ON b.ewaldid = c.id 
          GROUP BY b.sapbatch, c.creationdate
        ) As d
      ON a.sapbatch = d.sap
      CROSS APPLY (
        SELECT
          SUBSTRING(d.qdate, 7, 4) + '-' + SUBSTRING(d.qdate, 4, 2) + '-' + SUBSTRING(d.qdate, 1, 2) AS CreationIso
      ) e
      WHERE ISDATE(e.CreationIso) = 1
        AND e.CreationIso >= @dateFrom
        AND e.CreationIso <= @dateTo
      GROUP BY a.Material, a.sapbatch, a.reasoncode
    `
  },

  Staging: {
    title:      'Average Lead Time (Creation to Delivery)',
    valueLabel: 'Avg Hours',
    // For Staging we need datetime arithmetic, so we use CONVERT(datetime, col, 4)
    // which parses "dd.mm.yy hh:mm:ss" into a proper datetime value.
    // We group by year-month so the line chart shows a readable time series.
    sql: `
      SELECT
        CONVERT(varchar(4), DATEPART(year,  CONVERT(datetime, LEFT(CreationTime, 8), 4)))
        + '-' +
        RIGHT('0' + CONVERT(varchar(2), DATEPART(month, CONVERT(datetime, LEFT(CreationTime, 8), 4))), 2)
                                    AS label,
        AVG(CAST(
          DATEDIFF(
            minute,
            CONVERT(datetime, LEFT(CreationTime, 8), 4),
            CONVERT(datetime, LEFT(DeliveryTime, 8), 4)
          ) AS float
        ) / 60.0)                   AS value
      FROM dbo.Staging
      WHERE CONVERT(datetime, LEFT(CreationTime, 8), 4) >= CONVERT(datetime, @dateFrom)
        AND CONVERT(datetime, LEFT(CreationTime, 8), 4) <= CONVERT(datetime, @dateTo)
        AND LEFT(DeliveryTime, 8) IS NOT NULL
        AND LEFT(DeliveryTime, 8) <> ''
        AND CONVERT(datetime, LEFT(DeliveryTime, 8), 4) > CONVERT(datetime, LEFT(CreationTime, 8), 4)
      GROUP BY
        DATEPART(year,  CONVERT(datetime, LEFT(CreationTime, 8), 4)),
        DATEPART(month, CONVERT(datetime, LEFT(CreationTime, 8), 4))
      ORDER BY
        DATEPART(year,  CONVERT(datetime, LEFT(CreationTime, 8), 4)),
        DATEPART(month, CONVERT(datetime, LEFT(CreationTime, 8), 4))
    `,
  },
};

// ── Allowed report keys ───────────────────────────────────────────────────────
const ALLOWED = new Set(Object.keys(REPORTS));

// ── Date format validation — picker always sends YYYY-MM-DD ──────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── POST /api/reports ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { report, dateFrom, dateTo } = req.body;

  if (!report || !ALLOWED.has(report)) {
    return res.status(400).json({ success: false, error: `Unknown report: ${report}` });
  }
  if (!dateFrom || !DATE_RE.test(dateFrom) || !dateTo || !DATE_RE.test(dateTo)) {
    return res.status(400).json({ success: false, error: 'dateFrom and dateTo must be YYYY-MM-DD' });
  }
  if (dateFrom > dateTo) {
    return res.status(400).json({ success: false, error: 'dateFrom must not be after dateTo' });
  }

  const def = REPORTS[report];

  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      // Both parameters arrive as YYYY-MM-DD strings.
      // CONVERT(date, @dateFrom) inside each query handles the ISO format
      // natively — no format code is needed for YYYY-MM-DD.
      .input('dateFrom', sql.NVarChar(20), dateFrom)
      .input('dateTo',   sql.NVarChar(20), dateTo)
      .query(def.sql);

    const rows = (result.recordset || []).map(r => ({
      label: r.label != null ? String(r.label) : '(blank)',
      value: r.value != null ? Number(r.value)  : 0,
    }));

    res.json({
      success: true,
      rows,
      meta: { title: def.title, valueLabel: def.valueLabel },
    });

  } catch (err) {
    console.error('[reports]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;