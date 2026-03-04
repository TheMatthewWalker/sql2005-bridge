/**
 * routes/auth.js
 *
 * Authentication routes for the Kongsberg Portal.
 *
 * POST /login        — authenticate with username + password
 * GET  /logout       — destroy session and redirect to login
 * POST /register     — submit a registration request (pending admin approval)
 * GET  /session-check — returns current session info as JSON
 *
 * Mount in server.js (no requireLogin — these are public):
 *   import authRoutes from './routes/auth.js';
 *   app.use('/', authRoutes);
 */

import express      from 'express';
import bcrypt       from 'bcrypt';
import sql          from 'mssql';
import rateLimit    from 'express-rate-limit';
import { sqlConfig } from '../server.js';

const router = express.Router();

// ── Rate limiter — max 10 login attempts per 15 minutes per IP ────────────────
const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  handler: (req, res) => {
    res.redirect('/?error=too_many_attempts');
  },
});

// ── Helper — write to audit log ───────────────────────────────────────────────
async function audit(eventType, username, detail, req) {
  try {
    const pool = await sql.connect(sqlConfig);
    const ip   = req.ip || req.socket?.remoteAddress || null;
    await pool.request()
      .input('username',  sql.NVarChar(80),  username  || null)
      .input('eventType', sql.NVarChar(50),  eventType)
      .input('detail',    sql.NVarChar(500), detail    || null)
      .input('ip',        sql.NVarChar(45),  ip)
      .query(`
        INSERT INTO dbo.PortalAuditLog (Username, EventType, Detail, IPAddress)
        VALUES (@username, @eventType, @detail, @ip)
      `);
  } catch (err) {
    // Audit failure should never crash the request — just log to console
    console.error('[audit]', err.message);
  }
}

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.redirect('/?error=missing_fields');
  }

  try {
    const pool = await sql.connect(sqlConfig);

    // Fetch user + their permitted departments in one go
    const userResult = await pool.request()
      .input('username', sql.NVarChar(80), username.trim())
      .query(`
        SELECT
          u.UserID, u.Username, u.Email, u.PasswordHash,
          u.Role, u.IsActive, u.IsLocked, u.FailedLogins
        FROM dbo.PortalUsers u
        WHERE u.Username = @username
      `);

    const user = userResult.recordset[0];

    // ── Unknown user — use a fake compare to prevent timing attacks ──────────
    if (!user) {
      await bcrypt.compare(password, '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      await audit('LOGIN_FAIL', username, 'Unknown username', req);
      return res.redirect('/?error=invalid_credentials');
    }

    // ── Account checks before password verification ───────────────────────────
    if (!user.IsActive) {
      await audit('LOGIN_FAIL', username, 'Account pending approval', req);
      return res.redirect('/?error=pending_approval');
    }

    if (user.IsLocked) {
      await audit('LOGIN_FAIL', username, 'Account locked', req);
      return res.redirect('/?error=account_locked');
    }

    // ── Password check ────────────────────────────────────────────────────────
    const passwordValid = await bcrypt.compare(password, user.PasswordHash);

    if (!passwordValid) {
      // Increment failed login counter — lock after 10 consecutive failures
      const newFailCount = user.FailedLogins + 1;
      const shouldLock   = newFailCount >= 10;

      await pool.request()
        .input('userID',      sql.Int, user.UserID)
        .input('failedLogins', sql.Int, newFailCount)
        .input('isLocked',    sql.Bit, shouldLock ? 1 : 0)
        .query(`
          UPDATE dbo.PortalUsers
          SET FailedLogins = @failedLogins, IsLocked = @isLocked
          WHERE UserID = @userID
        `);

      await audit('LOGIN_FAIL', username,
        shouldLock ? 'Account locked after 10 failures' : `Failed attempt ${newFailCount}`,
        req
      );
      return res.redirect('/?error=invalid_credentials');
    }

    // ── Success — fetch departments ───────────────────────────────────────────
    const deptResult = await pool.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        SELECT Department FROM dbo.PortalUserDepartments
        WHERE UserID = @userID
      `);

    const departments = deptResult.recordset.map(r => r.Department);

    // Reset failed login counter, update LastLogin
    await pool.request()
      .input('userID', sql.Int, user.UserID)
      .query(`
        UPDATE dbo.PortalUsers
        SET FailedLogins = 0, IsLocked = 0, LastLogin = GETDATE()
        WHERE UserID = @userID
      `);

    await audit('LOGIN_OK', username, null, req);

    // ── Regenerate session ID to prevent session fixation ─────────────────────
    req.session.regenerate(err => {
      if (err) {
        console.error('[login] session regenerate error:', err);
        return res.redirect('/?error=server_error');
      }

      req.session.user = {
        userID:      user.UserID,
        username:    user.Username,
        email:       user.Email,
        role:        user.Role,
        departments, // array of permitted department slugs
      };

      res.redirect('/private/landing.html');
    });

  } catch (err) {
    console.error('[login]', err.message);
    res.redirect('/?error=server_error');
  }
});

// ── GET /logout ───────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  const username = req.session?.user?.username;
  req.session.destroy(async () => {
    if (username) await audit('LOGOUT', username, null, req);
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ── POST /register ────────────────────────────────────────────────────────────
// Submits a registration request. Account is created with IsActive = 0
// (pending approval). An admin must approve it before the user can log in.

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max:      5,                // max 5 registration attempts per IP per hour
  handler: (req, res) => {
    res.status(429).json({ success: false, error: 'Too many registration attempts. Try again later.' });
  },
});

router.post('/register', registerLimiter, async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  // ── Basic validation ───────────────────────────────────────────────────────
  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  const usernameClean = username.trim();
  const emailClean    = email.trim().toLowerCase();

  if (usernameClean.length < 3 || usernameClean.length > 80) {
    return res.status(400).json({ success: false, error: 'Username must be 3–80 characters.' });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    return res.status(400).json({ success: false, error: 'Invalid email address.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, error: 'Passwords do not match.' });
  }

  // Password strength: min 10 chars, at least one uppercase, one digit
  if (password.length < 10 ||
      !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password)) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 10 characters with one uppercase letter and one number.',
    });
  }

  try {
    const pool = await sql.connect(sqlConfig);

    // ── Check for existing username or email ──────────────────────────────────
    const existing = await pool.request()
      .input('username', sql.NVarChar(80),  usernameClean)
      .input('email',    sql.NVarChar(160), emailClean)
      .query(`
        SELECT Username, Email FROM dbo.PortalUsers
        WHERE Username = @username OR Email = @email
      `);

    if (existing.recordset.length > 0) {
      const clash = existing.recordset[0];
      const field = clash.Username?.toLowerCase() === usernameClean.toLowerCase()
        ? 'username' : 'email address';
      return res.status(409).json({
        success: false,
        error: `That ${field} is already registered.`,
      });
    }

    // ── Hash password and insert ──────────────────────────────────────────────
    const hash = await bcrypt.hash(password, 12);

    await pool.request()
      .input('username', sql.NVarChar(80),  usernameClean)
      .input('email',    sql.NVarChar(160), emailClean)
      .input('hash',     sql.NVarChar(256), hash)
      .query(`
        INSERT INTO dbo.PortalUsers (Username, Email, PasswordHash, Role, IsActive)
        VALUES (@username, @email, @hash, 'viewer', 0)
      `);

    await audit('REGISTER', usernameClean, 'Registration request submitted — pending approval', req);

    res.json({
      success: true,
      message: 'Registration request submitted. An administrator will review your account.',
    });

  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ── GET /session-check ────────────────────────────────────────────────────────
// Returns current session state as JSON — used by front-end JS.
router.get('/session-check', (req, res) => {
  const user = req.session?.user;
  if (!user) return res.json({ loggedIn: false });

  res.json({
    loggedIn:    true,
    username:    user.username,
    role:        user.role,
    departments: user.departments,
  });
});

export default router;