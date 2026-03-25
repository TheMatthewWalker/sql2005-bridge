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
    if (fn === 'openPicksheets') runOpenPicksheets();
  });
});

// ── Display Stock ─────────────────────────────────────────────────────────────
async function runDisplayStock() {
  if (!await checkSession()) return;
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
    StorageLocation:        document.getElementById('tf-sloc').value.trim(),
    Material:               document.getElementById('tf-material').value.trim(),
    Batch:                  document.getElementById('tf-batch').value.trim(),
    Quantity:               parseFloat(document.getElementById('tf-qty').value.replace(',', '.')),
    SourceType:          document.getElementById('tf-bintype').value.trim(),
    SourceBin:              document.getElementById('tf-bin').value.trim(),
    DestinationType:     document.getElementById('tf-destbintype').value.trim(),
    DestinationBin:         document.getElementById('tf-destbin').value.trim(),
    StockCategory:          document.getElementById('tf-category').value.trim(),
    SpecialStockIndicator:  document.getElementById('tf-special').value.trim(),
    SpecialStockNumber:     document.getElementById('tf-specialnum').value.trim(),
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
  if (!await checkSession()) return false;
  const resultEl = document.getElementById('tf-result');
  const isConsignment = params.SpecialStockIndicator === 'K' && params.DestinationType === 'SA';

  try 
  {
    var res;
    if (params.SpecialStockIndicator === 'K' && params.DestinationType === 'SA') // Consignment stock to production bin requires different RFC
    {
      res = await fetch('/api/sap/warehouse/consignment-mb1b', {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify({
          'DeliveryNote': '',
          'Header': "Consignment Usage",
          'StorageLocation': params.StorageLocation,
          'SpecialStockNumber': params.SpecialStockNumber,
          'Material': params.Material,
          'Quantity': params.Quantity,
          'DestinationType': params.DestinationType,
          'DestinationBin': params.DestinationBin,
          'SourceType': params.SourceType,
          'SourceBin': params.SourceBin
        }),
      });
    }
    else
    {
      res = await fetch('/api/sap/warehouse/transfer-order', {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json', 
        },
        body: JSON.stringify(params),
      });
    }

    const json = await res.json();

    if (!json.success) {
      console.error('Bridge error:', json.error);
      console.groupEnd();
      throw new Error(json.error || 'SAP call failed');
    }

    let type, msg;

    if (isConsignment) {
        const parts = [
            json.data?.mb1bMessage,
            json.data?.toNonConsignMessage,
            json.data?.toConsignMessage
        ].filter(Boolean);
        type = 'S';
        msg  = parts.map(esc).join('<br>') || 'Consignment processed';
    } else {
        const transferOrder = json.data?.transferOrderNumber || '';
        const errorMsg      = json.error || '';
        const messages      = json.data?.messages || [];

        type = (json.data?.success && !errorMsg) ? 'S' : 'E';

        const lines = [];
        if (transferOrder) lines.push(`Transfer Order: ${esc(transferOrder)}`);
        if (messages.length) lines.push(...messages.map(esc));
        msg = errorMsg ? esc(errorMsg) : (lines.join('<br>') || 'SAP returned no message');
    }

    if (type === 'S') {
      resultEl.innerHTML = `
        <div class="tf-success">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
          <div>
            <div class="tf-success-title">Transfer Order Created</div>
            <div class="tf-success-to">${msg}</div>
          </div>
        </div>`;
    } else {
      resultEl.innerHTML = `<div class="sap-error tf-inline-error">✕ ${msg}</div>`;
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

// ── Session guard ─────────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const d = await fetch('/session-check').then(r => r.json());
    if (!d.loggedIn) {
      alert('Your session has expired. Please log in again.');
      window.location.href = '/';
      return false;
    }
    return true;
  } catch {
    alert('Unable to verify your session. Please log in again.');
    window.location.href = '/';
    return false;
  }
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

  // ── Stock Right-click context menu ────────────────────────────────────────────────
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
    if (ctxRowData) 
        showTransferFormFromRow(ctxRowData);
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
    StorageLocation:          row['Storage Location'],
    Material:      row['Material'],
    Batch:         row['Batch']            || '',
    Quantity:      parseFloat(document.getElementById('tf-qty').value.replace(',', '.')),
    SourceType:   row['Storage Type'],
    SourceBin:    row['Storage Bin'],
    DestinationType:   document.getElementById('tf-destbintype').value.trim(),
    DestinationBin:       document.getElementById('tf-destbin').value.trim(),
    StockCategory:      row['Stock Category']    || '',
    SpecialStockIndicator:       row['Special Stock']     || '',
    SpecialStockNumber: row['Special Stock No.'] || '',
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

// ── Open Picksheets ───────────────────────────────────────────────────────────
async function runOpenPicksheets() {
  if (!await checkSession()) return;
  showResultPanel('Open Picksheets', 'Loading open deliveries…');

  try {
    const res  = await fetch('/api/deliverymain/open-picksheets');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load picksheets');

    const rows = json.data;
    if (!rows.length) {
      document.getElementById('result-body').innerHTML =
        '<div class="sap-error">No open picksheets found.</div>';
      return;
    }

    const badge = document.getElementById('result-row-badge');
    badge.textContent = `${rows.length} open`;
    badge.classList.remove('hidden');

    renderPicksheets(rows);
  } catch (err) {
    document.getElementById('result-body').innerHTML =
      `<div class="sap-error">✕ ${esc(err.message)}</div>`;
  }
}

const BUCKETS = [
  { key: 'priority',   label: 'Priority',       dot: 'priority', defaultOpen: true  },
  { key: 'backlog',    label: 'Backlog',         dot: 'backlog',  defaultOpen: true  },
  { key: 'today',      label: 'Today',           dot: 'today',    defaultOpen: true  },
  { key: 'this-week',  label: 'This Week',       dot: 'week',     defaultOpen: true  },
  { key: 'this-month', label: 'This Month',      dot: 'month',    defaultOpen: false },
  { key: 'other',      label: 'Everything Else', dot: 'other',    defaultOpen: false },
];

function getDateBucket(dueDate) {
  if (!dueDate) return 'other';
  const now    = new Date();
  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due    = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  if (dueDay < today) return 'backlog';
  if (dueDay.getTime() === today.getTime()) return 'today';

  const dow    = today.getDay() || 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

  if (dueDay <= sunday) return 'this-week';
  if (due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth()) return 'this-month';
  return 'other';
}

function renderPicksheets(rows) {
  const bucketMap = {};
  BUCKETS.forEach(b => { bucketMap[b.key] = []; });
  rows.forEach(r => {
    const key = r.deliveryPriority === 1 ? 'priority' : getDateBucket(r.dueDate);
    bucketMap[key].push(r);
  });

  const html = BUCKETS
    .filter(b => bucketMap[b.key].length > 0)
    .map(b => {
      const collapsed = b.defaultOpen ? '' : ' ps-section--collapsed';
      const thead = `<tr><th>Delivery ID</th><th>Destination</th><th>Due Date</th><th>Service</th><th>Comment</th></tr>`;
      const tbody = bucketMap[b.key].map(r => {
        const due  = r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB') : '—';
        const flag = b.key === 'priority' ? '<span class="ps-priority-flag"></span>' : '';
        return `<tr class="ps-row" data-id="${esc(String(r.deliveryID))}" data-dest="${esc(r.destinationName ?? '')}">
          <td>${flag}${esc(String(r.deliveryID))}</td>
          <td>${esc(r.destinationName ?? '—')}</td>
          <td>${esc(due)}</td>
          <td>${esc(r.deliveryService ?? '')}</td>
          <td>${esc(r.picksheetComment ?? '')}</td>
        </tr>`;
      }).join('');
      return `<div class="ps-section${collapsed}">
        <div class="ps-section-header">
          <span class="ps-section-dot ps-section-dot--${b.dot}"></span>
          <span class="ps-section-title">${b.label}</span>
          <span class="ps-section-count">${bucketMap[b.key].length}</span>
          <span class="ps-chevron">▼</span>
        </div>
        <div class="ps-section-body">
          <table class="ps-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>
        </div>
      </div>`;
    }).join('');

  document.getElementById('result-body').innerHTML = `<div class="ps-sections">${html}</div>`;

  document.querySelectorAll('.ps-section-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.ps-section').classList.toggle('ps-section--collapsed'));
  });

  document.querySelectorAll('.ps-row').forEach(tr => {
    tr.addEventListener('click', () => showPickedPallets(tr.dataset.id, tr.dataset.dest));
  });
}

// ── Pallet popup modal ─────────────────────────────────────────────────────────
async function showPickedPallets(deliveryId, destName) {
  if (!await checkSession()) return;

  const overlay = document.getElementById('ps-modal-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="ps-modal">
      <div class="ps-modal-header">
        <div>
          <div class="ps-modal-title">Picked Pallets</div>
          <div class="ps-modal-sub">Delivery #${esc(deliveryId)} · ${esc(destName)}</div>
        </div>
        <button class="ps-modal-close" onclick="closePickModal()">✕</button>
      </div>
      <div class="ps-modal-body">
        <div class="sap-loading"><div class="spinner"></div>Fetching pallets…</div>
      </div>
      <div class="ps-modal-actions">
        <button class="btn-submit" disabled title="Coming soon">+ Add Pallet</button>
      </div>
    </div>`;

  try {
    const res  = await fetch(`/api/deliverymain/${encodeURIComponent(deliveryId)}/pallets`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load pallets');

    const body    = overlay.querySelector('.ps-modal-body');
    const pallets = json.data;

    if (!pallets.length) {
      body.innerHTML = '<div class="sap-error" style="padding:24px">No pallets picked for this delivery yet.</div>';
      return;
    }

    const rows = pallets.map(p => `<tr>
      <td>${esc(p.palletType ?? '')}</td>
      <td class="${p.palletFinish ? 'ps-finish-yes' : 'ps-finish-no'}">${p.palletFinish ? 'Yes' : 'No'}</td>
      <td>${esc(String(p.palletLength ?? ''))}</td>
      <td>${esc(String(p.palletWidth  ?? ''))}</td>
      <td>${esc(String(p.palletHeight ?? ''))}</td>
      <td>${esc(String(p.grossWeight  ?? ''))}</td>
      <td>${esc(p.palletLocation ?? '')}</td>
      <td><button class="btn-edit-pallet" disabled title="Coming soon">Edit</button></td>
    </tr>`).join('');

    body.innerHTML = `
      <table class="ps-pallet-table">
        <thead><tr>
          <th>Type</th><th>Finished</th><th>Length</th><th>Width</th>
          <th>Height</th><th>Gross Wt.</th><th>Location</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

  } catch (err) {
    overlay.querySelector('.ps-modal-body').innerHTML =
      `<div class="sap-error" style="padding:24px">✕ ${esc(err.message)}</div>`;
  }
}

function closePickModal() {
  document.getElementById('ps-modal-overlay').classList.add('hidden');
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
