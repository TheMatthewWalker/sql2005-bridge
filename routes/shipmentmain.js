import express from 'express';
import sql from 'mssql';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import net from 'net';
import tls from 'tls';
import { sqlConfig } from '../server.js';

const router = express.Router();
const getPool = async () => await sql.connect(sqlConfig);
const APP_CONFIG = loadAppConfig();


function loadAppConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8')); }
  catch { return {}; }
}


function parseEmailList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '').split(/[;,]/).map(v => v.trim()).filter(Boolean);
}


function toBool(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
}


function toNullableInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}


function toDecimal(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}


function normalizeDeliveryIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.reduce((acc, item) => {
    const parsed = Number.parseInt(String(item), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || seen.has(parsed)) return acc;
    seen.add(parsed);
    acc.push(parsed);
    return acc;
  }, []);
}


function normalizeIdList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.reduce((acc, item) => {
    const parsed = Number.parseInt(String(item), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || seen.has(parsed)) return acc;
    seen.add(parsed);
    acc.push(parsed);
    return acc;
  }, []);
}


function createInClause(request, values, prefix) {
  return values.map((value, index) => {
    const key = `${prefix}${index}`;
    request.input(key, sql.BigInt, value);
    return `@${key}`;
  }).join(', ');
}
function formatShipmentRef(shipmentId) { return String(shipmentId).padStart(8, '0'); }
function sanitizeFolderSegment(value) {
  const clean = String(value || 'Unknown Customer').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim();
  return clean || 'Unknown Customer';
}


function isExWorks(incoTerms) {
  const normalized = String(incoTerms || '').trim().toUpperCase();
  return normalized === 'EXW' || normalized === 'EX WORKS';
}


function getLogisticsSettings() {
  const logistics = APP_CONFIG.logistics || {};
  const email = logistics.email || {};
  return {
    exportRoot: process.env.LOGISTICS_EXPORT_ROOT || logistics.exportRoot || path.join(process.cwd(), 'exports', 'customer-invoices'),
    originID: toNullableInteger(process.env.LOGISTICS_ORIGIN_ID ?? logistics.originID),
    originName: process.env.LOGISTICS_ORIGIN_NAME || logistics.originName || 'Kongsberg Automotive',
    originStreet: process.env.LOGISTICS_ORIGIN_STREET || logistics.originStreet || 'Euroflex Centre, Foxbridge Way',
    originCity: process.env.LOGISTICS_ORIGIN_CITY || logistics.originCity || 'Normanton',
    originPostCode: process.env.LOGISTICS_ORIGIN_POSTCODE || logistics.originPostCode || 'WF6 1TN',
    originCountry: process.env.LOGISTICS_ORIGIN_COUNTRY || logistics.originCountry || 'GB',
    smtpHost: process.env.LOGISTICS_SMTP_HOST || email.smtpHost || '',
    smtpPort: Number(process.env.LOGISTICS_SMTP_PORT || email.smtpPort || 25),
    smtpSecure: toBool(process.env.LOGISTICS_SMTP_SECURE ?? email.smtpSecure),
    smtpUser: process.env.LOGISTICS_SMTP_USER || email.smtpUser || '',
    smtpPass: process.env.LOGISTICS_SMTP_PASS || email.smtpPass || '',
    smtpHelloName: process.env.LOGISTICS_SMTP_HELLO_NAME || email.smtpHelloName || 'localhost',
    smtpConnectionTimeoutMs: Number(process.env.LOGISTICS_SMTP_TIMEOUT_MS || email.smtpTimeoutMs || 15000),
    smtpAllowInvalidCert: toBool(process.env.LOGISTICS_SMTP_ALLOW_INVALID_CERT ?? email.smtpAllowInvalidCert ?? true),
    mailFrom: process.env.LOGISTICS_EMAIL_FROM || email.from || '',
    mailCc: parseEmailList(process.env.LOGISTICS_EMAIL_CC || email.cc || []),
    mailBcc: parseEmailList(process.env.LOGISTICS_EMAIL_BCC || email.bcc || []),
  };
}


function escapePdfText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');
}


function createSimplePdfBuffer(title, lines) {
  const allLines = [String(title || '').trim(), '', ...lines.map(line => String(line ?? ''))];
  const pages = [];
  for (let i = 0; i < allLines.length; i += 44) pages.push(allLines.slice(i, i + 44));
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  let nextId = 4;
  for (const pageLines of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    const streamLines = ['BT', '/F1 11 Tf', '50 790 Td', '14 TL'];
    pageLines.forEach((line, index) => streamLines.push(`${index === 0 ? '' : 'T* '}(${escapePdfText(line)}) Tj`));
    streamLines.push('ET');
    const stream = streamLines.join('\n');
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  const maxId = nextId - 1;
  for (let id = 1; id <= maxId; id += 1) { offsets[id] = Buffer.byteLength(pdf, 'utf8'); pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}


async function getShipmentById(poolOrTx, shipmentId) {
  const result = await poolOrTx.request().input('shipmentId', sql.BigInt, shipmentId).query('SELECT * FROM Logistics.dbo.ShipmentMain WHERE shipmentID = @shipmentId');
  return result.recordset[0] || null;
}


async function getShipmentContext(shipmentId) {
  const pool = await getPool();
  const shipment = await getShipmentById(pool, shipmentId);
  if (!shipment) { const err = new Error(`Shipment ${shipmentId} not found.`); err.statusCode = 404; throw err; }
  const deliveries = await pool.request().input('shipmentId', sql.BigInt, shipmentId).query(`
    SELECT dm.deliveryID, dm.customerID, dm.dueDate, dm.completionDate, dm.deliveryService, dm.picksheetComment, 
      CAST(ISNULL(dm.netWeight, 0) AS decimal(18,3)) AS netWeight, CAST(ISNULL(dm.grossWeight, 0) AS decimal(18,3)) AS grossWeight, 
      CAST(ISNULL(dm.palletCount, 0) AS decimal(18,3)) AS palletCount, CAST(ISNULL(dm.deliveryVolume, 0) AS decimal(18,3)) AS deliveryVolume, 
      d.destinationName, d.destinationStreet, d.destinationCity, d.destinationPostCode, d.destinationCountry, 
    STUFF((
      SELECT '; ' + e.address
      FROM Logistics.dbo.Email e
      WHERE e.ID = dm.customerID
      FOR XML PATH('')
    ), 1, 2, '') AS destinationEmail
    FROM Logistics.dbo.ShipmentLink sl 
      INNER JOIN Logistics.dbo.DeliveryMain dm ON dm.deliveryID = sl.deliveryID 
      LEFT JOIN Logistics.dbo.Destinations d ON dm.customerID = d.destinationID 
    WHERE sl.shipmentID = @shipmentId ORDER BY dm.deliveryID ASC`);
  const pallets = await pool.request().input('shipmentId', sql.BigInt, shipmentId).query(`SELECT sl.deliveryID, pm.palletID, pm.palletType, pm.palletFinish, CAST(ISNULL(pm.packagingWeight, 0) AS decimal(18,3)) AS packagingWeight, CAST(ISNULL(pm.grossWeight, 0) AS decimal(18,3)) AS grossWeight, CAST(ISNULL(pm.palletVolume, 0) AS decimal(18,3)) AS palletVolume, pm.palletLength, pm.palletWidth, pm.palletHeight, pm.palletLocation FROM Logistics.dbo.ShipmentLink sl INNER JOIN Logistics.dbo.DeliveryLink dl ON dl.deliveryID = sl.deliveryID INNER JOIN Logistics.dbo.PalletMain pm ON pm.palletID = dl.palletID WHERE sl.shipmentID = @shipmentId AND ISNULL(pm.palletRemoved, 0) = 0 ORDER BY sl.deliveryID ASC, pm.palletID ASC`);
  return { shipment, deliveries: deliveries.recordset, pallets: pallets.recordset };
}


function getShipmentFolderInfo(shipment) {
  const settings = getLogisticsSettings();
  const shipmentRef = formatShipmentRef(shipment.shipmentID);
  const customerPath = path.join(settings.exportRoot, sanitizeFolderSegment(shipment.destinationName || 'Unknown Customer'));
  return { shipmentRef, customerPath, shipmentPath: path.join(customerPath, shipmentRef) };
}


async function ensureShipmentFolder(shipment) {
  const folder = getShipmentFolderInfo(shipment);
  await fsp.mkdir(folder.customerPath, { recursive: true });
  await fsp.mkdir(folder.shipmentPath, { recursive: true });
  return folder;
}


function applySiteMatch(request, fieldPrefix, settings, idParamName, nameParamName) {
  request.input(idParamName, sql.BigInt, settings.originID);
  request.input(nameParamName, sql.NVarChar, settings.originName);
  return `( (@${idParamName} IS NOT NULL AND ${fieldPrefix}ID = @${idParamName}) OR (${fieldPrefix}Name = @${nameParamName}) )`;
}


function buildShipmentQueueFilter(mode, request, settings) {
  if (mode === 'awaiting-collection') {
    return `
      ISNULL(sm.shipmentCancelled, 0) = 0
      AND ISNULL(sm.collectionStatus, 0) = 0
      AND ${applySiteMatch(request, 'sm.origin', settings, 'originSiteId', 'originSiteName')}
    `;
  }

  if (mode === 'inbound') {
    return `
      ISNULL(sm.shipmentCancelled, 0) = 0
      AND ISNULL(sm.collectionStatus, 0) = 1
      AND ISNULL(sm.deliveryStatus, 0) = 0
      AND ${applySiteMatch(request, 'sm.destination', settings, 'destinationSiteId', 'destinationSiteName')}
    `;
  }

  if (mode === 'in-transit') {
    return `
      ISNULL(sm.shipmentCancelled, 0) = 0
      AND ISNULL(sm.collectionStatus, 0) = 1
      AND ISNULL(sm.deliveryStatus, 0) = 0
      AND ${applySiteMatch(request, 'sm.origin', settings, 'transitOriginSiteId', 'transitOriginSiteName')}
    `;
  }

  if (mode === 'awaiting-booking') {
    return `
      ISNULL(sm.shipmentCancelled, 0) = 0
      AND ISNULL(sm.bookingStatus, 0) = 0
      AND sm.forwarderID IS NOT NULL
    `;
  }

  const err = new Error('Invalid shipment queue mode.');
  err.statusCode = 400;
  throw err;
}


function buildShipmentSummaryLines(context) {
  const { shipment, deliveries, pallets } = context;
  const ref = formatShipmentRef(shipment.shipmentID);
  return [
    `Shipment Ref: ${ref}`, 
    `Destination: ${shipment.destinationName || ''}`, 
    `Address: ${shipment.destinationStreet || ''}, ${shipment.destinationCity || ''}, ${shipment.destinationPostCode || ''}, ${shipment.destinationCountry || ''}`, 
    `Incoterms: ${shipment.incoTerms || ''}`, 
    `Planned Collection: ${shipment.plannedCollection ? new Date(shipment.plannedCollection).toLocaleDateString('en-GB') : ''}`, 
    `Forwarder ID: ${shipment.forwarderID ?? ''}`, 
    `Tracking Number: ${shipment.trackingNumber || ''}`, '', 
    `Deliveries Linked: ${deliveries.length}`, 
    `Pallet Count: ${shipment.palletCount ?? 0}`, 
    `Gross Weight: ${shipment.grossWeight ?? 0}`, 
    `Volume: ${shipment.shipmentVolume ?? 0}`, '', 
    `Pallet Records: ${pallets.length}`];
}


function buildDeliveryPackingLines(delivery, pallets) {
  const lines = [`Delivery ID: ${delivery.deliveryID}`, `Destination: ${delivery.destinationName || ''}`, `Due Date: ${delivery.dueDate ? new Date(delivery.dueDate).toLocaleDateString('en-GB') : ''}`, `Completed: ${delivery.completionDate ? new Date(delivery.completionDate).toLocaleDateString('en-GB') : ''}`, `Service: ${delivery.deliveryService || ''}`, `Comment: ${delivery.picksheetComment || ''}`, `Pallet Count: ${delivery.palletCount ?? 0}`, `Gross Weight: ${delivery.grossWeight ?? 0}`, `Volume: ${delivery.deliveryVolume ?? 0}`, '', 'Pallet Details:'];
  if (!pallets.length) 
    return [...lines, 'No pallet details linked to this delivery.'];
  pallets.forEach((pallet, index) => { 
    lines.push(
      `Pallet ${index + 1}: ${pallet.palletType || 'Pallet'} (#${pallet.palletID})`, 
      `  Finished: ${pallet.palletFinish ? 'Yes' : 'No'}`, 
      `  Size (L/W/H): ${pallet.palletLength || 0} / ${pallet.palletWidth || 0} / ${pallet.palletHeight || 0}`, 
      `  Gross Weight: ${pallet.grossWeight ?? 0}`, `  Volume: ${pallet.palletVolume ?? 0}`, 
      `  Location: ${pallet.palletLocation || ''}`, ''); });
  return lines;
}


async function generateShipmentDocuments(context) {
  const folder = await ensureShipmentFolder(context.shipment);
  const ref = formatShipmentRef(context.shipment.shipmentID);
  const files = [];
  const summaryName = `${ref}.pdf`;
  const summaryPath = path.join(folder.shipmentPath, summaryName);
  await fsp.writeFile(summaryPath, createSimplePdfBuffer(`Shipment ${ref}`, buildShipmentSummaryLines(context)));
  files.push({ fileName: summaryName, filePath: summaryPath, deliveryID: null });
  for (const delivery of context.deliveries) {
    const deliveryPallets = context.pallets.filter(p => Number(p.deliveryID) === Number(delivery.deliveryID));
    const fileName = `${delivery.deliveryID}.pdf`;
    const filePath = path.join(folder.shipmentPath, fileName);
    await fsp.writeFile(filePath, createSimplePdfBuffer(`Packing List ${delivery.deliveryID}`, buildDeliveryPackingLines(delivery, deliveryPallets)));
    files.push({ fileName, filePath, deliveryID: delivery.deliveryID });
  }
  return { shipmentRef: ref, folderPath: folder.shipmentPath, files };
}


function buildCollectionEmailBody(shipment) {
  const ref = formatShipmentRef(shipment.shipmentID);
  return ['Hi,', '', 'The following reference is ready to collect from Kongsberg.', '', `Ref: ${ref}`, '', 'Invoice & packing list attached.', '', 'Please arrange collection.', 'Open Monday - Thursday, 08:00 - 16:00', 'Open Friday, 08:00 - 12:00', '', 'Collection Address:', '', 'Kongsberg Automotive', 'Euroflex Centre', 'Foxbridge Way', 'Normanton', 'WF6 1TN, West Yorkshire', '', 'Best Regards', 'Kongsberg Automotive', 'Logistics Department'].join('\r\n');
}


function splitBase64Lines(value) { return value.replace(/(.{76})/g, '$1\r\n'); }

function buildMimeMessage({ from, to, cc, subject, textBody, attachments }) {
  const boundary = `----PortalShipment${Date.now()}`;
  const parts = [`From: ${from}`, `To: ${to.join(', ')}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: 8bit', '', textBody];
  for (const attachment of attachments) 
    parts.push('', `--${boundary}`, `Content-Type: application/pdf; name="${attachment.fileName}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${attachment.fileName}"`, '', splitBase64Lines(attachment.content.toString('base64')));
  parts.push('', `--${boundary}--`, '');
  return parts.join('\r\n');
}


async function sendSmtpMessage({ from, to, cc, bcc, message }) {
  const settings = getLogisticsSettings();
  if (!settings.smtpHost || !settings.mailFrom) { 
    const err = new Error('Logistics email is not configured. Set SMTP host and from address in env or config.'); 
    err.statusCode = 503; 
    throw err; }

  const recipients = [...to, ...cc, ...bcc].filter(Boolean);
  if (!recipients.length) { 
    const err = new Error('No email recipients were provided.'); 
    err.statusCode = 400; 
    throw err; }

  const createSocket = () => settings.smtpSecure
    ? tls.connect({
        host: settings.smtpHost,
        port: settings.smtpPort,
        rejectUnauthorized: !settings.smtpAllowInvalidCert,
      })
    : net.createConnection({ host: settings.smtpHost, port: settings.smtpPort });

  const socket = createSocket();
  socket.setEncoding('utf8');
  socket.setTimeout(settings.smtpConnectionTimeoutMs);
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('connect', handleConnect);
      socket.off('secureConnect', handleSecureConnect);
      socket.off('error', handleError);
      socket.off('timeout', handleTimeout);
    };
    const handleConnect = () => {
      if (!settings.smtpSecure) {
        cleanup();
        resolve();
      }
    };
    const handleSecureConnect = () => {
      cleanup();
      resolve();
    };
    const handleError = err => {
      cleanup();
      reject(err);
    };
    const handleTimeout = () => {
      cleanup();
      reject(new Error(`SMTP connection to ${settings.smtpHost}:${settings.smtpPort} timed out.`));
    };

    socket.once('connect', handleConnect);
    socket.once('secureConnect', handleSecureConnect);
    socket.once('error', handleError);
    socket.once('timeout', handleTimeout);
  });
  const pending = []; const queued = []; 
  let buffer = ''; let chunkLines = [];

  socket.on('data', data => {
    buffer += data; let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex + 1).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) { 
        chunkLines.push(line); 
        if (/^\d{3} /.test(line)) { 
          const response = chunkLines.join('\n'); 
          chunkLines = []; 
          const next = pending.shift(); 
          if (next) 
            next.resolve(response); 
          else 
            queued.push(response); } }
      newlineIndex = buffer.indexOf('\n');
    }
  });
  socket.on('error', err => { while (pending.length) pending.shift().reject(err); });
  socket.on('timeout', () => {
    while (pending.length) pending.shift().reject(new Error(`SMTP session with ${settings.smtpHost}:${settings.smtpPort} timed out.`));
    socket.destroy();
  });
  const readResponse = () => new Promise((resolve, reject) => { if (queued.length) return resolve(queued.shift()); pending.push({ resolve, reject }); });
  const assertCode = (response, allowed) => {
    const code = Number.parseInt(response.slice(0, 3), 10);
    if (!allowed.includes(code)) throw new Error(`SMTP error ${code}: ${response}`);
  };
  const sendCommand = async (command, allowed) => { socket.write(`${command}\r\n`); const response = await readResponse(); assertCode(response, allowed); return response; };
  const sendEhlo = async () => {
    try {
      await sendCommand(`EHLO ${settings.smtpHelloName}`, [250]);
    } catch (err) {
      await sendCommand(`HELO ${settings.smtpHelloName}`, [250]);
      return err;
    }
    return null;
  };

  try {
    assertCode(await readResponse(), [220]);
    const ehloError = await sendEhlo();
    if (settings.smtpUser) {
      try {
        await sendCommand('AUTH LOGIN', [334]);
        await sendCommand(Buffer.from(settings.smtpUser).toString('base64'), [334]);
        await sendCommand(Buffer.from(settings.smtpPass || '').toString('base64'), [235]);
      } catch (err) {
        err.message = `SMTP authentication failed for ${settings.smtpHost}:${settings.smtpPort}. ${err.message}`;
        throw err;
      }
    } else if (ehloError && settings.smtpSecure) {
      ehloError.message = `SMTP server ${settings.smtpHost}:${settings.smtpPort} rejected EHLO during secure relay setup. ${ehloError.message}`;
      throw ehloError;
    }
    await sendCommand(`MAIL FROM:<${from}>`, [250]);
    for (const recipient of recipients) await sendCommand(`RCPT TO:<${recipient}>`, [250, 251]);
    await sendCommand('DATA', [354]);
    socket.write(`${message}\r\n.\r\n`);
    assertCode(await readResponse(), [250]);
    await sendCommand('QUIT', [221]);
  } catch (err) {
    err.statusCode = err.statusCode || 502;
    throw err;
  } finally {
    socket.end();
  }
}


router.get('/', async (req, res) => {
  try { 
    const pool = await getPool(); 
    const result = await pool.request().query('SELECT * FROM Logistics.dbo.ShipmentMain'); 
    res.json(result.recordset); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Shipment queues ──
router.get('/queue/:mode', async (req, res) => {
  try {
    const settings = getLogisticsSettings();
    const pool = await getPool();
    const request = pool.request();
    const whereClause = buildShipmentQueueFilter(req.params.mode, request, settings);
    const result = await request.query(`
      SELECT
        sm.*,
        f.forwarderName,
        CAST(ISNULL(sm.collectionStatus, 0) AS bit) AS collectionStatus,
        CAST(ISNULL(sm.deliveryStatus, 0) AS bit) AS deliveryStatus,
        CASE WHEN ISNULL(sm.plannedDelivery, '1900-01-01') > '1900-01-01' THEN sm.plannedDelivery ELSE sm.plannedCollection END AS plannedMovement
      FROM Logistics.dbo.ShipmentMain sm
      LEFT JOIN Logistics.dbo.Forwarders f ON f.forwarderID = sm.forwarderID
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN ISNULL(sm.plannedDelivery, '1900-01-01') > '1900-01-01' THEN sm.plannedDelivery ELSE sm.plannedCollection END ASC,
        sm.shipmentID ASC`);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});


router.post('/:shipmentId/mark-collected', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('shipmentId', sql.BigInt, req.params.shipmentId)
      .query(`
        UPDATE Logistics.dbo.ShipmentMain
        SET
          collectionStatus = 1,
          actualCollection = GETDATE()
        WHERE
          shipmentID = @shipmentId
          AND ISNULL(shipmentCancelled, 0) = 0
          AND ISNULL(collectionStatus, 0) = 0;

        SELECT @@ROWCOUNT AS affectedRows;
      `);

    if (!result.recordset[0]?.affectedRows) {
      const err = new Error('Shipment could not be marked as collected.');
      err.statusCode = 409;
      throw err;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});


router.post('/:shipmentId/mark-delivered', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('shipmentId', sql.BigInt, req.params.shipmentId)
      .query(`
        UPDATE Logistics.dbo.ShipmentMain
        SET
          deliveryStatus = 1,
          actualDelivery = GETDATE()
        WHERE
          shipmentID = @shipmentId
          AND ISNULL(shipmentCancelled, 0) = 0
          AND ISNULL(collectionStatus, 0) = 1
          AND ISNULL(deliveryStatus, 0) = 0;

        SELECT @@ROWCOUNT AS affectedRows;
      `);

    if (!result.recordset[0]?.affectedRows) {
      const err = new Error('Shipment could not be marked as delivered.');
      err.statusCode = 409;
      throw err;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});


router.post('/mark-booked', async (req, res) => {
  const shipmentIds = normalizeIdList(req.body.shipmentIDs);
  if (!shipmentIds.length) {
    return res.status(400).json({ success: false, error: 'Select at least one shipment before confirming booking.' });
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    const inClause = createInClause(request, shipmentIds, 'shipmentId');
    const result = await request.query(`
      UPDATE Logistics.dbo.ShipmentMain
      SET bookingStatus = 1
      WHERE shipmentID IN (${inClause})
        AND ISNULL(shipmentCancelled, 0) = 0
        AND ISNULL(bookingStatus, 0) = 0;

      SELECT @@ROWCOUNT AS affectedRows;
    `);

    res.json({ success: true, data: { updated: Number(result.recordset[0]?.affectedRows || 0) } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});


router.post('/create-from-deliveries', async (req, res) => {
  const deliveryIDs = normalizeDeliveryIds(req.body.deliveryIDs);
  if (!deliveryIDs.length) 
    return res.status(400).json({ success: false, error: 'Select at least one delivery before creating a shipment.' });

  const pool = await getPool(); const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = tx.request(); 
    const inClause = createInClause(request, deliveryIDs, 'deliveryId');

    const deliveriesResult = await request.query(`
      SELECT dm.deliveryID, dm.customerID, dm.dueDate, dm.completionDate, dm.deliveryService, dm.picksheetComment, 
        CAST(ISNULL(dm.netWeight, 0) AS decimal(18,3)) AS netWeight, CAST(ISNULL(dm.grossWeight, 0) AS decimal(18,3)) AS grossWeight, 
        CAST(ISNULL(dm.palletCount, 0) AS decimal(18,3)) AS palletCount, CAST(ISNULL(dm.deliveryVolume, 0) AS decimal(18,3)) AS deliveryVolume, 
        d.destinationName, d.destinationStreet, d.destinationCity, d.destinationPostCode, d.destinationCountry, d.defaultIncoterms,
        STUFF((
          SELECT '; ' + e.address
          FROM Logistics.dbo.Email e
          WHERE e.ID = dm.customerID
          FOR XML PATH('')
        ), 1, 2, '') AS destinationEmail
      FROM Logistics.dbo.DeliveryMain dm 
        LEFT JOIN Logistics.dbo.Destinations d ON d.destinationID = dm.customerID 
        LEFT JOIN Logistics.dbo.ShipmentLink sl ON sl.deliveryID = dm.deliveryID 
      WHERE dm.deliveryID IN (${inClause}) AND dm.completionStatus = 1 
        AND ISNULL(dm.deliveryCancelled, 0) = 0 
        AND sl.deliveryID IS NULL 
      ORDER BY dm.deliveryID ASC`);

    const deliveries = deliveriesResult.recordset;
    if (deliveries.length !== deliveryIDs.length) 
      throw new Error('One or more deliveries are no longer available for shipment creation. Please refresh and try again.');

    const customerIds = [...new Set(deliveries.map(row => String(row.customerID)))];
    if (customerIds.length !== 1) 
      throw new Error('Selected deliveries must all belong to the same customer.');

    const first = deliveries[0]; 
    const settings = getLogisticsSettings();
    const totals = deliveries.reduce((acc, row) => { acc.netWeight += toDecimal(row.netWeight); acc.grossWeight += toDecimal(row.grossWeight); acc.palletCount += toDecimal(row.palletCount); acc.shipmentVolume += toDecimal(row.deliveryVolume); return acc; }, { netWeight: 0, grossWeight: 0, palletCount: 0, shipmentVolume: 0 });
    const shipmentDraft = {
      destinationID: first.customerID,
      destinationName: String(req.body.destinationName || first.destinationName || '').trim(),
      destinationStreet: String(req.body.destinationStreet || first.destinationStreet || '').trim(),
      destinationCity: String(req.body.destinationCity || first.destinationCity || '').trim(),
      destinationPostCode: String(req.body.destinationPostCode || first.destinationPostCode || '').trim(),
      destinationCountry: String(req.body.destinationCountry || first.destinationCountry || '').trim(),
      plannedCollection: req.body.plannedCollection ? new Date(req.body.plannedCollection) : null,
      actualCollection: req.body.actualCollection ? new Date(req.body.actualCollection) : null,
      collectionStatus: toBool(req.body.collectionStatus),
      forwarderID: toNullableInteger(req.body.forwarderID),
      trackingNumber: String(req.body.trackingNumber || '').trim(),
      incoTerms: String(req.body.incoTerms || first.defaultIncoterms || '').trim(),
      customsRequired: toBool(req.body.customsRequired),
      customsComplete: toBool(req.body.customsComplete),
      shipmentCancelled: toBool(req.body.shipmentCancelled),
    };
    const insertResult = await tx.request().input('originID', sql.BigInt, settings.originID).input('originName', sql.NVarChar, settings.originName).input('originStreet', sql.NVarChar, settings.originStreet).input('originCity', sql.NVarChar, settings.originCity).input('originPostCode', sql.NVarChar, settings.originPostCode).input('originCountry', sql.NVarChar, settings.originCountry).input('destinationID', sql.BigInt, shipmentDraft.destinationID).input('destinationName', sql.NVarChar, shipmentDraft.destinationName).input('destinationStreet', sql.NVarChar, shipmentDraft.destinationStreet).input('destinationCity', sql.NVarChar, shipmentDraft.destinationCity).input('destinationPostCode', sql.NVarChar, shipmentDraft.destinationPostCode).input('destinationCountry', sql.NVarChar, shipmentDraft.destinationCountry).input('netWeight', sql.Decimal(18, 3), totals.netWeight).input('grossWeight', sql.Decimal(18, 3), totals.grossWeight).input('palletCount', sql.Decimal(18, 3), totals.palletCount).input('shipmentVolume', sql.Decimal(18, 3), totals.shipmentVolume).input('plannedCollection', sql.DateTime, shipmentDraft.plannedCollection).input('actualCollection', sql.DateTime, shipmentDraft.actualCollection).input('collectionStatus', sql.Bit, shipmentDraft.collectionStatus).input('forwarderID', sql.BigInt, shipmentDraft.forwarderID).input('trackingNumber', sql.NVarChar, shipmentDraft.trackingNumber || null).input('incoTerms', sql.NVarChar, shipmentDraft.incoTerms || null).input('customsRequired', sql.Bit, shipmentDraft.customsRequired).input('customsComplete', sql.Bit, shipmentDraft.customsComplete).input('shipmentCancelled', sql.Bit, shipmentDraft.shipmentCancelled).query(`INSERT INTO Logistics.dbo.ShipmentMain (originID, originName, originStreet, originCity, originPostCode, originCountry, destinationID, destinationName, destinationStreet, destinationCity, destinationPostCode, destinationCountry, netWeight, grossWeight, palletCount, shipmentVolume, plannedCollection, actualCollection, collectionStatus, forwarderID, trackingNumber, incoTerms, customsRequired, customsComplete, shipmentCancelled) VALUES (@originID, @originName, @originStreet, @originCity, @originPostCode, @originCountry, @destinationID, @destinationName, @destinationStreet, @destinationCity, @destinationPostCode, @destinationCountry, @netWeight, @grossWeight, @palletCount, @shipmentVolume, @plannedCollection, @actualCollection, @collectionStatus, @forwarderID, @trackingNumber, @incoTerms, @customsRequired, @customsComplete, @shipmentCancelled); SELECT SCOPE_IDENTITY() AS shipmentID;`);
    const shipmentID = Number(insertResult.recordset[0].shipmentID);
    
    for (const deliveryID of deliveryIDs) 
      await tx.request().input('shipmentID', sql.BigInt, shipmentID).input('deliveryID', sql.BigInt, deliveryID).query('INSERT INTO Logistics.dbo.ShipmentLink (shipmentID, deliveryID) VALUES (@shipmentID, @deliveryID)');
    
    await tx.commit();
    const shipment = await getShipmentById(pool, shipmentID); 
    const folder = getShipmentFolderInfo(shipment);
    return res.status(201).json({ success: true, data: { shipmentID, shipmentRef: formatShipmentRef(shipmentID), linkedDeliveries: deliveryIDs.length, canSendEmail: isExWorks(shipment.incoTerms), folderPath: folder.shipmentPath, shipment } });
  } catch (err) {
    try { if (tx._aborted !== true) await tx.rollback(); } catch (_) {}
    return res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});


router.post('/:shipmentId/create-folder', async (req, res) => {
  try { const context = await getShipmentContext(req.params.shipmentId); 
        const folder = await ensureShipmentFolder(context.shipment); 
        res.json({ success: true, data: { 
          shipmentRef: folder.shipmentRef, folderPath: folder.shipmentPath 
        } }); }
  catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});


router.post('/:shipmentId/generate-packing-list', async (req, res) => {
  try {
    const context = await getShipmentContext(req.params.shipmentId); 
    const generated = await generateShipmentDocuments(context);
    res.json({ success: true, data: { 
      shipmentRef: generated.shipmentRef, folderPath: generated.folderPath, 
      files: generated.files.map(file => ({ 
        fileName: file.fileName, deliveryID: file.deliveryID, 
        downloadUrl: `/api/shipmentmain/${req.params.shipmentId}/documents/${encodeURIComponent(file.fileName)}` 
      })) 
    } });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});


router.get('/:shipmentId/documents/:fileName', async (req, res) => {
  try {
    const context = await getShipmentContext(req.params.shipmentId); 
    const folder = getShipmentFolderInfo(context.shipment); 
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName.toLowerCase().endsWith('.pdf')) 
      return res.status(400).json({ success: false, error: 'Only PDF documents are available.' });

    const target = path.join(folder.shipmentPath, fileName); 
    await fsp.access(target, fs.constants.F_OK); 
    return res.sendFile(target);
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});


router.post('/:shipmentId/send-collection-email', async (req, res) => {
  try {
    const context = await getShipmentContext(req.params.shipmentId);
    if (!isExWorks(context.shipment.incoTerms)) 
      return res.status(400).json({ success: false, error: 'Collection email is only available for Ex Works shipments.' });
    
    const destinationEmail = String(context.deliveries[0]?.destinationEmail || '').trim();
    if (!destinationEmail) 
      return res.status(400).json({ success: false, error: 'Destination email is missing for this shipment.' });
    
    const generated = await generateShipmentDocuments(context); const settings = getLogisticsSettings();
    const attachments = await Promise.all(generated.files.map(async file => ({ fileName: file.fileName, content: await fsp.readFile(file.filePath) })));
    const subject = `Kongsberg Automotive // Collection Ref: ${generated.shipmentRef} // ${context.shipment.destinationName || ''}`;
    const message = buildMimeMessage({ from: settings.mailFrom, to: [destinationEmail], cc: settings.mailCc, subject, textBody: buildCollectionEmailBody(context.shipment), attachments });
    
    await sendSmtpMessage({ from: settings.mailFrom, to: [destinationEmail], cc: settings.mailCc, bcc: settings.mailBcc, message });
    res.json({ success: true, data: { shipmentRef: generated.shipmentRef, sentTo: destinationEmail, cc: settings.mailCc, bcc: settings.mailBcc, attachments: generated.files.map(file => file.fileName) } });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, error: err.message }); }
});


router.get('/id/:shipmentId', async (req, res) => {
  try { 
    const pool = await getPool(); 
    const result = await pool.request().input('shipmentId', sql.BigInt, req.params.shipmentId).query('SELECT * FROM Logistics.dbo.ShipmentMain WHERE shipmentID = @shipmentId'); 
    res.json(result.recordset); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


router.get('/forwarder/:forwarderId', async (req, res) => {
  try { 
    const pool = await getPool(); 
    const result = await pool.request().input('forwarderId', sql.BigInt, req.params.forwarderId).query('SELECT * FROM Logistics.dbo.ShipmentMain WHERE forwarderID = @forwarderId'); 
    res.json(result.recordset); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


router.get('/destination/:destinationId', async (req, res) => {
  try { 
    const pool = await getPool(); 
    const result = await pool.request().input('destinationId', sql.BigInt, req.params.destinationId).query('SELECT * FROM Logistics.dbo.ShipmentMain WHERE destinationID = @destinationId'); 
    res.json(result.recordset); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


router.get('/daterange', async (req, res) => {
  try { 
    const { dateFrom, dateTo } = req.query; 
    const pool = await getPool(); 
    const result = await pool.request().input('dateFrom', sql.DateTime, new Date(dateFrom)).input('dateTo', sql.DateTime, new Date(dateTo)).query('SELECT * FROM Logistics.dbo.ShipmentMain WHERE plannedCollection BETWEEN @dateFrom AND @dateTo'); 
    res.json(result.recordset); }
  catch (err) { res.status(500).json({ error: err.message }); }
});


router.post('/', async (req, res) => {
  try {
    const { originID, originName, originStreet, originCity, originPostCode, originCountry, destinationID, destinationName, destinationStreet, destinationCity, destinationPostCode, destinationCountry, netWeight, grossWeight, palletCount, shipmentVolume, plannedCollection, actualCollection, collectionStatus, forwarderID, trackingNumber, incoTerms, customsRequired, customsComplete, shipmentCancelled } = req.body;
    const pool = await getPool();
    const result = await pool.request().input('originID', sql.BigInt, originID).input('originName', sql.NVarChar, originName).input('originStreet', sql.NVarChar, originStreet).input('originCity', sql.NVarChar, originCity).input('originPostCode', sql.NVarChar, originPostCode).input('originCountry', sql.NVarChar, originCountry).input('destinationID', sql.BigInt, destinationID).input('destinationName', sql.NVarChar, destinationName).input('destinationStreet', sql.NVarChar, destinationStreet).input('destinationCity', sql.NVarChar, destinationCity).input('destinationPostCode', sql.NVarChar, destinationPostCode).input('destinationCountry', sql.NVarChar, destinationCountry).input('netWeight', sql.Decimal, netWeight).input('grossWeight', sql.Decimal, grossWeight).input('palletCount', sql.BigInt, palletCount).input('shipmentVolume', sql.Decimal, shipmentVolume).input('plannedCollection', sql.DateTime, plannedCollection ? new Date(plannedCollection) : null).input('actualCollection', sql.DateTime, actualCollection ? new Date(actualCollection) : null).input('collectionStatus', sql.Bit, collectionStatus).input('forwarderID', sql.BigInt, forwarderID).input('trackingNumber', sql.NVarChar, trackingNumber).input('incoTerms', sql.NVarChar, incoTerms).input('customsRequired', sql.Bit, customsRequired).input('customsComplete', sql.Bit, customsComplete).input('shipmentCancelled', sql.Bit, shipmentCancelled).query(`INSERT INTO Logistics.dbo.ShipmentMain (originID, originName, originStreet, originCity, originPostCode, originCountry, destinationID, destinationName, destinationStreet, destinationCity, destinationPostCode, destinationCountry, netWeight, grossWeight, palletCount, shipmentVolume, plannedCollection, actualCollection, collectionStatus, forwarderID, trackingNumber, incoTerms, customsRequired, customsComplete, shipmentCancelled) VALUES (@originID, @originName, @originStreet, @originCity, @originPostCode, @originCountry, @destinationID, @destinationName, @destinationStreet, @destinationCity, @destinationPostCode, @destinationCountry, @netWeight, @grossWeight, @palletCount, @shipmentVolume, @plannedCollection, @actualCollection, @collectionStatus, @forwarderID, @trackingNumber, @incoTerms, @customsRequired, @customsComplete, @shipmentCancelled); SELECT SCOPE_IDENTITY() AS shipmentID;`);
    res.status(201).json({ message: 'Record created successfully', shipmentID: result.recordset[0].shipmentID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
