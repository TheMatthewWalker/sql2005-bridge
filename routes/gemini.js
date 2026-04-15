/**
 * routes/gemini.js
 *
 * Gemini integration routes for the Kongsberg Portal.
 *
 * POST /generate-content — generate AI content using Gemini API

 * Mount in server.js (no requireLogin — these are public):
 *   import geminiRoutes from './routes/gemini.js';
 *   app.use('/gemini', geminiRoutes);
 */

import express      from 'express';
import bcrypt       from 'bcrypt';
import sql          from 'mssql';
import rateLimit    from 'express-rate-limit';
import { sqlConfig } from '../server.js';
import { GoogleGenAI } from "@google/genai";

const router = express.Router();
const ai = new GoogleGenAI({});

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
        INSERT INTO kongsberg.dbo.PortalAuditLog (Username, EventType, Detail, IPAddress)
        VALUES (@username, @eventType, @detail, @ip)
      `);
  } catch (err) {
    // Audit failure should never crash the request — just log to console
    console.error('[audit]', err.message);
  }
}

async function askGemini(question, req) {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: question,
  });
  await audit('ASK_GEMINI', username,
    response.contents,
    req
  );
  console.log(response.text);
  return response.text;
}


router.post('/askgemini', registerLimiter, requireLogin, async (req, res) => {
  const question = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  try {
    const answer = await askGemini(question, req);
    res.json({ answer });
  } catch (err) {
    console.error('Error asking Gemini:', err);
    res.status(500).json({ error: 'Failed to get response from Gemini' });
  }

 
});


export default router;