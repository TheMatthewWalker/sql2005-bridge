'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let activeDT      = null;
let currentResult = [];

// ── Session check on load ─────────────────────────────────────────────────────
(async () => {
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { window.location.href = '/'; return; }
  document.getElementById('session-user').textContent = d.username;
})();

// ── Tile click handlers ───────────────────────────────────────────────────────
document.querySelectorAll('.sap-tile--live').forEach(tile => {
  tile.addEventListener('click', () => {
    const fn = tile.dataset.fn;
    if (fn === 'displayStock')   runDisplayStock();
    if (fn === 'transferOrders') showTransferForm();
  });
});

// ── Display Stock ─────────────────────────────────────────────────────────────
async function runDisplayStock() {
  showResultPanel('Display Stock', 'Fetching warehouse stock from SAP LQUA…');

  try {
    const res = await fetch('/api/sap/execute-rfc', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionName:     'ZRFC_READ_TABLES',
        importParameters: { DELIMITER: '|', ROWCOUNT: '9999', NO_DATA: ' ' },
        inputTables:      { QUERY_TABLES: [{ TABNAME: 'LQUA' }] },
        inputTablesItems: {
          query_FIELDS: [
            { TABNAME: 'LQUA', FIELDNAME: 'LGORT' },
            { TABNAME: 'LQUA', FIELDNAME: 'LGTYP' },
            { TABNAME: 'LQUA', FIELDNAME: 'LGPLA' },
            { TABNAME: 'LQUA', FIELDNAME: 'MATNR' },
            { TABNAME: 'LQUA', FIELDNAME: 'VERME' },
            { TABNAME: 'LQUA', FIELDNAME: 'CHARG' },
            { TABNAME: 'LQUA', FIELDNAME: 'BESTQ' },
            { TABNAME: 'LQUA', FIELDNAME: 'SOBKZ' },
            { TABNAME: 'LQUA', FIELDNAME: 'SONUM' },
          ],
          where_clause: [
            { TEXT: 'LQUA~LGNUM EQ 312' },
          ],
        },
        exportParameters: [],
        outputTables:     { data_display: ['WA'] },
      }),
    });

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'SAP call failed');

    // Response: { success, data: { success, data: { tables: { data_display: [...] } } } }
    // First row is the SAP field-name header — skip it
    const waRows  = (json.data?.data?.tables?.data_display || []).slice(1);
    const columns = ['Storage Location', 'Storage Type', 'Storage Bin', 'Material', 'Available Qty', 'Batch', 'Stock Category', 'Special Stock', 'Special Stock No.'];

    currentResult = waRows
      .map(r => {
        const parts = r.WA.split('|').map(s => s.trim());
        return {
          'Storage Location': parts[0] || '',
          'Storage Type':     parts[1] || '',
          'Storage Bin':      parts[2] || '',
          'Material':         parts[3] || '',
          'Available Qty':    parts[4] || '',
          'Batch':            parts[5] || '',
          'Stock Category':   parts[6] || '',
          'Special Stock':    parts[7] || '',
          'Special Stock No.':parts[8] || '',
        };
      })
      .filter(r => r.Material);

    renderResultTable(currentResult, columns);
    document.getElementById('result-hint').textContent =
      `LQUA · WH 312 · ${currentResult.length} rows`;

  } catch (err) {
    document.getElementById('result-body').innerHTML =
      `<div class="sap-error">✕ ${esc(err.message)}</div>`;
  }
}


// ── Transfer Orders — form ────────────────────────────────────────────────────
function showTransferForm() {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  document.getElementById('tile-section').classList.add('hidden');
  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-title').textContent = 'Create Transfer Order';
  document.getElementById('result-hint').textContent  = 'L_TO_CREATE_SINGLE · Movement type 999';
  document.getElementById('result-row-badge').classList.add('hidden');
  document.getElementById('btn-export-csv').classList.add('hidden');

  document.getElementById('result-body').innerHTML = `
    <form class="transfer-form" id="transfer-form" onsubmit="submitTransferForm(event)">

      <div class="tf-section-label">Material &amp; Quantity</div>
      <div class="tf-row">
        <div class="tf-field tf-field--wide">
          <label class="tf-label">Material <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-material" type="text" placeholder="Material number" required>
        </div>
        <div class="tf-field">
          <label class="tf-label">Batch</label>
          <input class="tf-input" id="tf-batch" type="text" placeholder="Optional">
        </div>
        <div class="tf-field">
          <label class="tf-label">Quantity <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-qty" type="number" step="any" min="0.001" placeholder="e.g. 10" required>
        </div>
        <div class="tf-field">
          <label class="tf-label">Storage Location <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-sloc" type="text" placeholder="e.g. 0001" required>
        </div>
      </div>

      <div class="tf-section-label">Source Bin</div>
      <div class="tf-row">
        <div class="tf-field">
          <label class="tf-label">Bin Type <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-bintype" type="text" placeholder="e.g. 001" required>
        </div>
        <div class="tf-field">
          <label class="tf-label">Bin <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-bin" type="text" placeholder="e.g. A-01-01" required>
        </div>
      </div>

      <div class="tf-section-label">Destination Bin</div>
      <div class="tf-row">
        <div class="tf-field">
          <label class="tf-label">Dest. Bin Type <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-destbintype" type="text" placeholder="e.g. 001" required>
        </div>
        <div class="tf-field">
          <label class="tf-label">Dest. Bin <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-destbin" type="text" placeholder="e.g. B-02-03" required>
        </div>
      </div>

      <div class="tf-section-label">Stock Flags <span class="tf-optional">(optional)</span></div>
      <div class="tf-row">
        <div class="tf-field">
          <label class="tf-label">Stock Category</label>
          <input class="tf-input" id="tf-category" type="text" placeholder="e.g. Q, S">
        </div>
        <div class="tf-field">
          <label class="tf-label">Special Stock Indicator</label>
          <input class="tf-input" id="tf-special" type="text" placeholder="e.g. K, E">
        </div>
        <div class="tf-field tf-field--wide">
          <label class="tf-label">Special Stock Number</label>
          <input class="tf-input" id="tf-specialnum" type="text" placeholder="e.g. order number">
        </div>
      </div>

      <div class="tf-actions">
        <div id="tf-result"></div>
        <button type="submit" class="btn-submit" id="tf-submit">Create Transfer Order</button>
      </div>
    </form>`;
}

async function submitTransferForm(e) {
  e.preventDefault();

  const params = {
    sloc:          document.getElementById('tf-sloc').value.trim(),
    material:      document.getElementById('tf-material').value.trim(),
    batch:         document.getElementById('tf-batch').value.trim(),
    qty:           parseFloat(document.getElementById('tf-qty').value.replace(',', '.')),
    binType:       document.getElementById('tf-bintype').value.trim(),
    bin:           document.getElementById('tf-bin').value.trim(),
    destBinType:   document.getElementById('tf-destbintype').value.trim(),
    destBin:       document.getElementById('tf-destbin').value.trim(),
    category:      document.getElementById('tf-category').value.trim(),
    special:       document.getElementById('tf-special').value.trim(),
    specialNumber: document.getElementById('tf-specialnum').value.trim(),
  };

  const submitBtn = document.getElementById('tf-submit');
  const resultEl  = document.getElementById('tf-result');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending to SAP…';
  resultEl.innerHTML = '';

  await runStockTransfer(params);

  submitBtn.disabled = false;
  submitBtn.textContent = 'Create Transfer Order';
}

// ── Stock Transfer — SAP call ─────────────────────────────────────────────────
async function runStockTransfer(params) {
  const resultEl = document.getElementById('tf-result');
  try {
    const res = await fetch('/api/sap/execute-rfc', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        functionName:     'L_TO_CREATE_SINGLE',
        importParameters: {
          'I_LGNUM': '312', // Fixed warehouse for now, could be made dynamic later',
          'I_WERKS': '3012', // Fixed plant for now, could be made dynamic later',
          'I_LGORT': params.sloc,
          'I_SQUIT': 'X',
          'I_BWLVS': '999',
          'I_MATNR': sapPad(params.material, 18),
          'I_ANFME': params.qty,
          'I_CHARG': sapPad(params.batch,10)        || '',
          'I_ZEUGN': sapPad(params.batch,10)        || '',
          'I_VLTYP': params.binType,
          'I_VLPLA': sapPad(params.bin,10),
          'I_BESTQ': params.category     || '',
          'I_SOBKZ': params.special      || '',
          'I_SONUM': sapPad(params.specialNumber,16) || '',
          'I_NLPLA': sapPad(params.destBin,10),
          'I_NLTYP': params.destBinType,
        },
        inputTables:      {},
        inputTablesItems: {},
        exportParameters: ['E_TANUM'],
        outputTables:     { RETURN: ['TYPE', 'MESSAGE'] },
      }),
    });

    const json = await res.json();
    console.group('[SAP] L_TO_CREATE_SINGLE');
    console.log('HTTP status :', res.status);
    console.log('Full response:', json);
    console.log('Parameters  :', json.data?.data?.parameters);
    console.log('Table keys  :', Object.keys(json.data?.data?.tables || {}));
    console.log('RETURN table:', json.data?.data?.tables?.RETURN);

    if (!json.success) {
      console.error('Bridge error:', json.error);
      console.groupEnd();
      throw new Error(json.error || 'SAP call failed');
    }

    const returnRows    = json.data?.data?.tables?.RETURN || [];
    const transferOrder = json.data?.data?.parameters?.E_TANUM || '';

    // Scan RETURN rows for any E/A error messages
    let errorMsg    = '';
    let allMessages = '';
    for (const row of returnRows) {
      const t = row.TYPE    || '';
      const m = row.MESSAGE || '';
      allMessages += `${t}: ${m}\n`;
      console.log(`  RETURN row — TYPE: "${t}"  MESSAGE: "${m}"`);
      if (t === 'E' || t === 'A') errorMsg = m;
    }

    // Success: E_TANUM populated and no blocking errors
    const type = (transferOrder && !errorMsg) ? 'S' : 'E';
    const msg  = errorMsg || allMessages.trim() || 'SAP returned no message';
    console.log('Outcome     :', type === 'S' ? `SUCCESS — TO# ${transferOrder}` : `FAILED — ${msg}`);
    console.groupEnd();

    if (type === 'S') {
      resultEl.innerHTML = `
        <div class="tf-success">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
          <div>
            <div class="tf-success-title">Transfer Order Created</div>
            <div class="tf-success-to">TO#&nbsp;${esc(transferOrder)}</div>
          </div>
        </div>`;
    } else {
      resultEl.innerHTML = `<div class="sap-error tf-inline-error">✕ ${esc(msg)}</div>`;
    }

  } catch (err) {
    resultEl.innerHTML = `<div class="sap-error tf-inline-error">✕ ${esc(err.message)}</div>`;
  }
}



// ── Show result panel, hide tiles ─────────────────────────────────────────────
function showResultPanel(title, hint) {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  document.getElementById('tile-section').classList.add('hidden');
  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-hint').textContent  = hint;
  document.getElementById('result-row-badge').classList.add('hidden');
  document.getElementById('btn-export-csv').classList.add('hidden');
  document.getElementById('result-body').innerHTML =
    '<div class="sap-loading"><div class="spinner"></div>Connecting to SAP…</div>';
}

// ── Back to tiles ─────────────────────────────────────────────────────────────
function backToTiles() {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  currentResult = [];
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('tile-section').classList.remove('hidden');
}

// ── Render DataTable with per-column filters ──────────────────────────────────
function renderResultTable(records, columns) {
  const filterRow = columns.map(c =>
    `<th><input class="col-filter-input" type="text" placeholder="${esc(c)}…" data-col="${esc(c)}"></th>`
  ).join('');

  const tbody = records.map(row =>
    `<tr>${columns.map(c => `<td>${esc(row[c] ?? '')}</td>`).join('')}</tr>`
  ).join('');

  document.getElementById('result-body').innerHTML = `
    <table id="sap-dt" style="width:100%">
      <thead>
        <tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
        <tr class="col-filter-row">${filterRow}</tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`;

  activeDT = new DataTable('#sap-dt', {
    pageLength:    10,
    scrollX:       true,
    orderCellsTop: true,
    layout:        { padding: { bottom: 12 } },
    initComplete:  function () {
      const api = this.api();
      api.table().header().querySelectorAll('.col-filter-input').forEach(input => {
        const colIdx = columns.indexOf(input.dataset.col);
        if (colIdx === -1) return;
        input.addEventListener('input', function () {
          api.column(colIdx).search(this.value).draw();
        });
      });
    },
  });

  // ── Right-click context menu ────────────────────────────────────────────────
  const ctxMenu     = document.getElementById('ctx-menu');
  const ctxTransfer = document.getElementById('ctx-transfer');
  let ctxRowData    = null;

  document.getElementById('sap-dt').addEventListener('contextmenu', e => {
    const tr = e.target.closest('tbody tr');
    if (!tr) return;
    e.preventDefault();

    // Build row object directly from DOM cells — works correctly after any sort/filter
    const cells = Array.from(tr.querySelectorAll('td'));
    ctxRowData = {};
    columns.forEach((col, i) => { ctxRowData[col] = cells[i]?.textContent?.trim() || ''; });

    ctxMenu.style.left = `${Math.min(e.pageX, window.innerWidth  - 200)}px`;
    ctxMenu.style.top  = `${Math.min(e.pageY, window.innerHeight - 60)}px`;
    ctxMenu.classList.remove('hidden');
  });

  ctxTransfer.onclick = () => {
    ctxMenu.classList.add('hidden');
    if (ctxRowData) showTransferFormFromRow(ctxRowData);
  };

  document.addEventListener('click',       () => ctxMenu.classList.add('hidden'), { once: false });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('#ctx-menu') && !e.target.closest('#sap-dt tbody')) ctxMenu.classList.add('hidden'); });

  const badge = document.getElementById('result-row-badge');
  badge.textContent = `${records.length} rows`;
  badge.classList.remove('hidden');
  document.getElementById('btn-export-csv').classList.remove('hidden');
}

// ── Transfer form pre-filled from a stock row ─────────────────────────────────
function showTransferFormFromRow(row) {
  const hasBatch = !!row['Batch'];

  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  document.getElementById('result-title').textContent = 'Create Transfer Order';
  document.getElementById('result-hint').textContent  = `From ${row['Storage Bin']} · ${row['Material']}`;
  document.getElementById('result-row-badge').classList.add('hidden');
  document.getElementById('btn-export-csv').classList.add('hidden');

  document.getElementById('result-body').innerHTML = `
    <form class="transfer-form" id="transfer-form" onsubmit="submitTransferFormRow(event)">

      <div class="tf-section-label">Source — from stock</div>
      <div class="tf-prefill-grid">
        ${prefillItem('Storage Location', row['Storage Location'])}
        ${prefillItem('Storage Type',     row['Storage Type'])}
        ${prefillItem('Storage Bin',      row['Storage Bin'])}
        ${prefillItem('Material',         row['Material'])}
        ${prefillItem('Stock Category',   row['Stock Category']   || '—')}
        ${prefillItem('Special Stock',    row['Special Stock']    || '—')}
        ${prefillItem('Special Stock No.',row['Special Stock No.']|| '—')}
        ${hasBatch
          ? prefillItem('Batch', row['Batch'])
          : `<div class="tf-field">
               <label class="tf-label">Batch</label>
               <div class="tf-prefill-value tf-muted">None</div>
             </div>`}
      </div>

      <div class="tf-section-label">Quantity</div>
      <div class="tf-row">
        <div class="tf-field">
          <label class="tf-label">Quantity <span class="tf-req">*</span>${hasBatch ? ' <span class="tf-locked">locked to batch qty</span>' : ''}</label>
          <input class="tf-input" id="tf-qty" type="number" step="any" min="0.001"
            value="${esc(parseSapQty(row['Available Qty']))}"
            ${hasBatch ? 'readonly' : ''} required>
        </div>
      </div>

      <div class="tf-section-label">Destination Bin</div>
      <div class="tf-row">
        <div class="tf-field">
          <label class="tf-label">Dest. Bin Type <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-destbintype" type="text" placeholder="e.g. 001" required>
        </div>
        <div class="tf-field">
          <label class="tf-label">Dest. Bin <span class="tf-req">*</span></label>
          <input class="tf-input" id="tf-destbin" type="text" placeholder="e.g. B-02-03" required>
        </div>
      </div>

      <div class="tf-actions">
        <div id="tf-result"></div>
        <button type="button" class="btn-secondary" onclick="runDisplayStock()">← Back to Stock</button>
        <button type="submit" class="btn-submit" id="tf-submit">Create Transfer Order</button>
      </div>

    </form>`;

  // Store source data for submission
  document.getElementById('transfer-form').dataset.source = JSON.stringify(row);
}

function prefillItem(label, value) {
  return `
    <div class="tf-field">
      <label class="tf-label">${esc(label)}</label>
      <div class="tf-prefill-value">${esc(value)}</div>
    </div>`;
}

async function submitTransferFormRow(e) {
  e.preventDefault();
  const row = JSON.parse(e.target.dataset.source);

  const params = {
    sloc:          row['Storage Location'],
    material:      row['Material'],
    batch:         row['Batch']            || '',
    qty:           parseFloat(document.getElementById('tf-qty').value.replace(',', '.')),
    binType:       row['Storage Type'],
    bin:           row['Storage Bin'],
    destBinType:   document.getElementById('tf-destbintype').value.trim(),
    destBin:       document.getElementById('tf-destbin').value.trim(),
    category:      row['Stock Category']    || '',
    special:       row['Special Stock']     || '',
    specialNumber: row['Special Stock No.'] || '',
  };

  const submitBtn = document.getElementById('tf-submit');
  const resultEl  = document.getElementById('tf-result');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending to SAP…';
  resultEl.innerHTML = '';

  await runStockTransfer(params);

  submitBtn.disabled = false;
  submitBtn.textContent = 'Create Transfer Order';
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportResultCSV() {
  if (!currentResult.length) return;
  const columns = Object.keys(currentResult[0]);
  const lines   = [
    columns.join(','),
    ...currentResult.map(row =>
      columns.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Utility ───────────────────────────────────────────────────────────────────

// parseSapQty — convert SAP/German number format to a plain decimal string.
// SAP uses '.' as thousands separator and ',' as decimal separator.
// e.g. "10.875,000" → "10875.000",  "90,5" → "90.5",  "157,000" → "157.000"
function parseSapQty(value) {
  const str = String(value ?? '').trim();
  return str.includes(',')
    ? str.replace(/\./g, '').replace(',', '.')   // remove thousand-sep dots, swap decimal comma
    : str.replace(/\./g, '');                     // no decimal part — just remove thousand-sep dots
}

// sapPad — pad purely numeric values with leading zeros to the required SAP field length.
// Alphanumeric values (letters, slashes, hyphens, etc.) are returned unchanged.
// Examples:
//   sapPad('12345',    18) → '000000000000012345'
//   sapPad('28-0658',  18) → '28-0658'
//   sapPad('',         18) → ''
function sapPad(value, length) {
  const str = String(value ?? '').trim();
  return /^\d+$/.test(str) ? str.padStart(length, '0') : str;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
