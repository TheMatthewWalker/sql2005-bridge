/**
 * routes/useradmin.js
 *
 * Admin API endpoints for user management.
 *
 * All routes require: requireLogin + requireRole('admin')
 *
 * Mount in server.js:
 *   import adminRoutes from './routes/useradmin.js';
 *   app.use('/api/useradmin', requireLogin, requireRole('admin'), adminRoutes);
 *
 * Endpoints:
 *   GET  /pending                — list users with IsActive = 0
 *   GET  /users                  — list all users with their departments
 *   PUT  /users/:id              — update role, status, departments, notes
 *   POST /users/:id/approve      — activate a pending user
 *   POST /users/:id/reject       — delete a pending registration
 *   GET  /audit                  — audit log, optionally filtered by event type
 */

import express from 'express';
import sql     from 'mssql';
import { sqlConfig } from '../server.js';

const router = express.Router();

// ── Audit helper ──────────────────────────────────────────────────────────────
async function audit(eventType, actorUsername, detail, req) {
  try {
    const pool = await sql.connect(sqlConfig);
    const ip   = req.ip || req.socket?.remoteAddress || null;
    await pool.request()
      .input('username',  sql.NVarChar(80),  actorUsername || null)
      .input('eventType', sql.NVarChar(50),  eventType)
      .input('detail',    sql.NVarChar(500), detail || null)
      .input('ip',        sql.NVarChar(45),  ip)
      .query(`
        INSERT INTO dbo.PortalAuditLog (Username, EventType, Detail, IPAddress)
        VALUES (@username, @eventType, @detail, @ip)
      `);
  } catch (err) {
    console.error('[admin audit]', err.message);
  }
}

// ── GET /pending ──────────────────────────────────────────────────────────────
// Returns all users with IsActive = 0 (pending approval)
router.get('/pending', async (req, res) => {
  try {
    const pool   = await sql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT UserID, Username, Email, CreatedAt
      FROM dbo.PortalUsers
      WHERE IsActive = 0
      ORDER BY CreatedAt ASC
    `);
    res.json({ success: true, users: result.recordset });
  } catch (err) {
    console.error('[admin/pending]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /users ────────────────────────────────────────────────────────────────
// Returns all users with their permitted departments
router.get('/users', async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);

    const usersResult = await pool.request().query(`
      SELECT
        UserID, Username, Email, Role,
        IsActive, IsLocked, FailedLogins,
        CreatedAt, LastLogin, Notes
      FROM dbo.PortalUsers
      ORDER BY CreatedAt DESC
    `);

    const deptsResult = await pool.request().query(`
      SELECT UserID, Department FROM dbo.PortalUserDepartments
    `);

    // Group departments by UserID
    const deptMap = {};
    for (const row of deptsResult.recordset) {
      if (!deptMap[row.UserID]) deptMap[row.UserID] = [];
      deptMap[row.UserID].push(row.Department);
    }

    const users = usersResult.recordset.map(u => ({
      ...u,
      departments: deptMap[u.UserID] || [],
    }));

    res.json({ success: true, users });

  } catch (err) {
    console.error('[admin/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /users/:id ────────────────────────────────────────────────────────────
// Update an existing user's role, status, departments and notes
router.put('/users/:id', async (req, res) => {
  const userID = parseInt(req.params.id, 10);
  if (!userID || isNaN(userID)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  const { role, isActive, isLocked, notes, departments } = req.body;

  const VALID_ROLES = ['viewer', 'editor', 'admin', 'superadmin'];
  const VALID_DEPTS = ['production','logistics','warehouse','finance','sales','quality','engineering','management'];

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }
  if (departments && !departments.every(d => VALID_DEPTS.includes(d))) {
    return res.status(400).json({ success: false, error: 'Invalid department in list' });
  }

  try {
    const pool = await sql.connect(sqlConfig);

    // Get current state for audit comparison
    const current = await pool.request()
      .input('userID', sql.Int, userID)
      .query('SELECT Username, Role, IsActive, IsLocked FROM dbo.PortalUsers WHERE UserID = @userID');

    if (!current.recordset[0]) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const prev = current.recordset[0];

    // Update user record
    await pool.request()
      .input('userID',   sql.Int,          userID)
      .input('role',     sql.NVarChar(20),  role     ?? prev.Role)
      .input('isActive', sql.Bit,           isActive ?? prev.IsActive)
      .input('isLocked', sql.Bit,           isLocked ?? prev.IsLocked)
      .input('notes',    sql.NVarChar(500), notes    ?? null)
      .query(`
        UPDATE dbo.PortalUsers
        SET Role     = @role,
            IsActive = @isActive,
            IsLocked = @isLocked,
            Notes    = @notes,
            -- Reset failed logins if admin is unlocking
            FailedLogins = CASE WHEN @isLocked = 0 THEN 0 ELSE FailedLogins END
        WHERE UserID = @userID
      `);

    // Replace department access — delete existing then re-insert
    if (Array.isArray(departments)) {
      await pool.request()
        .input('userID', sql.Int, userID)
        .query('DELETE FROM dbo.PortalUserDepartments WHERE UserID = @userID');

      for (const dept of departments) {
        await pool.request()
          .input('userID',    sql.Int,         userID)
          .input('dept',      sql.NVarChar(50), dept)
          .input('grantedBy', sql.NVarChar(80), req.session.user.username)
          .query(`
            INSERT INTO dbo.PortalUserDepartments (UserID, Department, GrantedBy)
            VALUES (@userID, @dept, @grantedBy)
          `);
      }
    }

    // Audit log
    const actor = req.session.user.username;
    if (role && role !== prev.Role) {
      await audit('ROLE_CHANGE', actor,
        `Changed ${prev.Username} role: ${prev.Role} → ${role}`, req);
    }
    if (Array.isArray(departments)) {
      await audit('DEPT_CHANGE', actor,
        `Updated ${prev.Username} departments: ${departments.join(', ') || 'none'}`, req);
    }
    if (isLocked !== undefined && !!isLocked !== !!prev.IsLocked) {
      await audit(isLocked ? 'LOCKED' : 'UNLOCKED', actor,
        `${isLocked ? 'Locked' : 'Unlocked'} account: ${prev.Username}`, req);
    }

    res.json({ success: true });

  } catch (err) {
    console.error('[admin/users PUT]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /users/:id/approve ───────────────────────────────────────────────────
// Activate a pending user, assign role and departments
router.post('/users/:id/approve', async (req, res) => {
  const userID = parseInt(req.params.id, 10);
  if (!userID || isNaN(userID)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  const { role = 'viewer', departments = [] } = req.body;

  const VALID_ROLES = ['viewer', 'editor', 'admin'];
  const VALID_DEPTS = ['production','logistics','warehouse','finance','sales','quality','engineering','management'];

  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }
  if (!departments.every(d => VALID_DEPTS.includes(d))) {
    return res.status(400).json({ success: false, error: 'Invalid department in list' });
  }

  try {
    const pool  = await sql.connect(sqlConfig);
    const actor = req.session.user.username;

    // Activate and assign role
    const result = await pool.request()
      .input('userID',     sql.Int,         userID)
      .input('role',       sql.NVarChar(20), role)
      .input('approvedBy', sql.NVarChar(80), actor)
      .query(`
        UPDATE dbo.PortalUsers
        SET IsActive   = 1,
            Role       = @role,
            ApprovedBy = @approvedBy,
            ApprovedAt = GETDATE()
        OUTPUT INSERTED.Username
        WHERE UserID = @userID AND IsActive = 0
      `);

    if (!result.recordset[0]) {
      return res.status(404).json({ success: false, error: 'Pending user not found' });
    }
    const approvedUsername = result.recordset[0].Username;

    // Grant departments
    for (const dept of departments) {
      await pool.request()
        .input('userID',    sql.Int,         userID)
        .input('dept',      sql.NVarChar(50), dept)
        .input('grantedBy', sql.NVarChar(80), actor)
        .query(`
          INSERT INTO dbo.PortalUserDepartments (UserID, Department, GrantedBy)
          VALUES (@userID, @dept, @grantedBy)
        `);
    }

    await audit('APPROVED', actor,
      `Approved ${approvedUsername} as ${role} — depts: ${departments.join(', ') || 'none'}`, req);

    res.json({ success: true });

  } catch (err) {
    console.error('[admin/approve]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /users/:id/reject ────────────────────────────────────────────────────
// Delete a pending registration request entirely
router.post('/users/:id/reject', async (req, res) => {
  const userID = parseInt(req.params.id, 10);
  if (!userID || isNaN(userID)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  try {
    const pool  = await sql.connect(sqlConfig);
    const actor = req.session.user.username;

    const result = await pool.request()
      .input('userID', sql.Int, userID)
      .query(`
        DELETE FROM dbo.PortalUsers
        OUTPUT DELETED.Username
        WHERE UserID = @userID AND IsActive = 0
      `);

    if (!result.recordset[0]) {
      return res.status(404).json({ success: false, error: 'Pending user not found' });
    }

    await audit('REJECTED', actor,
      `Rejected registration for ${result.recordset[0].Username}`, req);

    res.json({ success: true });

  } catch (err) {
    console.error('[admin/reject]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /audit ────────────────────────────────────────────────────────────────
// Returns the last 500 audit log entries, optionally filtered by event type
router.get('/audit', async (req, res) => {
  const { event } = req.query;

  const VALID_EVENTS = [
    'LOGIN_OK','LOGIN_FAIL','LOGOUT','REGISTER',
    'APPROVED','REJECTED','ROLE_CHANGE','DEPT_CHANGE','LOCKED','UNLOCKED',
  ];

  if (event && !VALID_EVENTS.includes(event)) {
    return res.status(400).json({ success: false, error: 'Invalid event filter' });
  }

  try {
    const pool    = await sql.connect(sqlConfig);
    const request = pool.request();

    let whereClause = '';
    if (event) {
      request.input('event', sql.NVarChar(50), event);
      whereClause = 'WHERE EventType = @event';
    }

    const result = await request.query(`
      SELECT TOP 500
        LogID, EventTime, Username, EventType, Detail, IPAddress
      FROM dbo.PortalAuditLog
      ${whereClause}
      ORDER BY EventTime DESC
    `);

    res.json({ success: true, rows: result.recordset });

  } catch (err) {
    console.error('[admin/audit]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;