'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let activeDT      = null;
let currentResult = [];
let rawRows       = {};  // keyed by material for breakdown lookup

// ── Session check on load ─────────────────────────────────────────────────────
(async () => {
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { window.location.href = '/'; return; }
  document.getElementById('session-user').textContent = d.username;
})();

// ── Tile click handlers ───────────────────────────────────────────────────────
document.querySelectorAll('.sap-tile--live').forEach(tile => {
  tile.addEventListener('click', () => {
    if (tile.dataset.fn === 'materialCosting') showCostingForm();
  });
});

// ── Show result panel, hide tiles ─────────────────────────────────────────────
function showResultPanel(title, hint) {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  document.getElementById('tile-section').classList.add('hidden');
  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-hint').textContent  = hint;
  document.getElementById('result-row-badge').classList.add('hidden');
  document.getElementById('btn-export-csv').classList.add('hidden');
}

// ── Back to tiles ─────────────────────────────────────────────────────────────
function backToTiles() {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  currentResult = [];
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('tile-section').classList.remove('hidden');
}

// ── Material Costing form ─────────────────────────────────────────────────────
function showCostingForm() {
  showResultPanel('Material Costing', 'SAP standard cost sheet via costing BAPI');

  document.getElementById('result-body').innerHTML = `
    <form class="cost-form" id="cost-form">
      <table class="cf-table" id="cf-table">
        <thead>
          <tr>
            <th class="cf-th">Material</th>
            <th class="cf-th">Quantity</th>
            <th class="cf-th">Incoterms</th>
            <th class="cf-th">Country</th>
            <th class="cf-th"></th>
          </tr>
        </thead>
        <tbody id="cf-tbody"></tbody>
      </table>
      <div class="cf-actions">
        <button type="button" class="btn-add-row" onclick="addCostingRow()">+ Add Row</button>
        <button class="btn-run" type="submit" id="cf-submit">Run</button>
      </div>
    </form>`;

  addCostingRow();
  document.getElementById('cost-form').addEventListener('submit', runMaterialCosting);
}

function addCostingRow() {
  const tbody = document.getElementById('cf-tbody');
  const tr = document.createElement('tr');
  tr.className = 'cf-data-row';
  tr.innerHTML = `
    <td><input class="cf-input" type="text" name="material" placeholder="000000000100012345"></td>
    <td><input class="cf-input" type="number" name="quantity" placeholder="100" min="0" step="any"></td>
    <td><input class="cf-input" type="text" name="incoterms" placeholder="DDP" maxlength="10"></td>
    <td><input class="cf-input" type="text" name="country" placeholder="GB" maxlength="3"></td>
    <td><button type="button" class="btn-remove-row" onclick="removeCostingRow(this)">✕</button></td>`;
  tbody.appendChild(tr);
  updateRemoveButtons();
}

function removeCostingRow(btn) {
  btn.closest('tr').remove();
  updateRemoveButtons();
}

function updateRemoveButtons() {
  const rows = document.querySelectorAll('#cf-tbody .cf-data-row');
  rows.forEach(r => {
    r.querySelector('.btn-remove-row').style.visibility = rows.length > 1 ? 'visible' : 'hidden';
  });
}

// ── Run Material Costing ──────────────────────────────────────────────────────
async function runMaterialCosting(e) {
  e.preventDefault();

  const items = Array.from(document.querySelectorAll('#cf-tbody .cf-data-row')).map(tr => {
    const material  = tr.querySelector('[name=material]').value.trim();
    const qtyRaw    = tr.querySelector('[name=quantity]').value.trim();
    const incoterms = tr.querySelector('[name=incoterms]').value.trim();
    const country   = tr.querySelector('[name=country]').value.trim();
    return {
      material,
      ...(qtyRaw    ? { quantity: parseFloat(qtyRaw) } : {}),
      ...(incoterms ? { incoterms }                    : {}),
      ...(country   ? { country }                      : {}),
    };
  });

  //const date = new Date().toISOString().slice(0, 10);
  const date = '31.12.2026';

  const btn = document.getElementById('cf-submit');
  btn.disabled = true;
  btn.textContent = 'Running…';

  document.getElementById('result-body').innerHTML =
    '<div class="sap-loading"><div class="spinner"></div>Connecting to SAP…</div>';

  try {
    const res  = await fetch('/api/sap/cost-sheet', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ items, date } ),
    });
    const json = await res.json();


    if (!json.success)
      throw new Error(json.error ?? 'SAP request failed');

    const rows = json.data

    console.log('Raw rows from SAP:', rows);

    if (!Array.isArray(rows) || rows.length === 0) {
      document.getElementById('result-body').innerHTML =
        '<div class="sap-error">No costing data returned for the selected parameters.</div>';
      return;
    }

    // Store raw rows keyed by material for breakdown lookup
    rawRows = {};
    rows.forEach(r => { if (r.material) rawRows[r.material] = r; });

    // Sum all kst fields for total cost, then derive per-unit cost
    currentResult = rows.map(r => {
      const kstTotal = Object.keys(r)
        .filter(k => k.startsWith('kst'))
        .reduce((sum, k) => sum + parseSapNumber(r[k]), 0);

      const lotSize = r.lotSize;
      const unit    = r.unit ?? '';

      return {
        Material:            r.material ?? '',
        'Price (£) Per Unit': (kstTotal / lotSize).toFixed(2) || 0,
        'Unit of Measure':   unit,
      };
    });

    renderResultTable(currentResult, Object.keys(currentResult[0]));

  } catch (err) {
    document.getElementById('result-body').innerHTML =
      `<div class="sap-error">✕ ${esc(err.message)}</div>`;
  }
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
    <table id="fin-dt" style="width:100%">
      <thead>
        <tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
        <tr class="col-filter-row">${filterRow}</tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`;

  activeDT = new DataTable('#fin-dt', {
    pageLength:    25,
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

  const badge = document.getElementById('result-row-badge');
  badge.textContent = `${records.length} rows`;
  badge.classList.remove('hidden');
  document.getElementById('btn-export-csv').classList.remove('hidden');

  // Right-click context menu on data rows
  document.querySelector('#fin-dt tbody').addEventListener('contextmenu', e => {
    const td = e.target.closest('td');
    if (!td) return;
    e.preventDefault();
    const material = td.closest('tr').querySelector('td')?.textContent?.trim();
    if (!material) return;
    showCtxMenu(e.clientX, e.clientY, material);
  });
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtxMenu(x, y, material) {
  hideCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'fin-ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" id="ctx-breakdown">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="1" x2="8" y2="15"/><path d="M11 4H5.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H4"/>
      </svg>
      View Cost Breakdown
    </div>`;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  document.body.appendChild(menu);
  menu.querySelector('#ctx-breakdown').addEventListener('click', () => {
    hideCtxMenu();
    showBreakdownModal(material);
  });
  document.addEventListener('click', hideCtxMenu, { once: true });
}

function hideCtxMenu() {
  document.getElementById('fin-ctx-menu')?.remove();
}

// ── Cost breakdown modal ──────────────────────────────────────────────────────
const KST_LABELS = {
  kst001: 'Direct Material', kst002: 'Inbound Freight', kst004: 'Outbound Freight',
  kst006: 'Depreciation', kst008: 'Direct Labor', kst017: 'Variable Production Overhead',
  kst019: 'Scrap', kst033: 'Tariffs',
};

function showBreakdownModal(material) {
  const r = rawRows[material];
  if (!r) return;

  const kstKeys  = Object.keys(KST_LABELS);
  const lotSize  = r.lotSize ?? 1;
  const kstTotal = kstKeys.reduce((sum, k) => sum + parseSapNumber(r[k]), 0);
  const unit     = r.unit ?? '';

  const rows = kstKeys.map(k => {
    const val = parseSapNumber(r[k]);
    return `<tr>
      <td class="bd-label">${esc(KST_LABELS[k])}</td>
      <td class="bd-value">${(val / lotSize).toFixed(2)}</td>
      <td class="bd-pct">${(kstTotal) > 0 ? ((val / kstTotal) * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('fin-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'fin-modal';
  modal.className = 'fin-modal-overlay';
  modal.innerHTML = `
    <div class="fin-modal">
      <div class="fin-modal-header">
        <div>
          <div class="fin-modal-title">Cost Breakdown</div>
          <div class="fin-modal-sub">${esc(material)}</div>
        </div>
        <button class="fin-modal-close" onclick="document.getElementById('fin-modal').remove()">✕</button>
      </div>
      <table class="fin-modal-table">
        <thead><tr><th>Component</th><th>Value (£)</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="bd-total">
            <td>Total</td>
            <td>${(kstTotal / lotSize).toFixed(2)}</td>
            <td>100%</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
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
  a.href = url; a.download = `material-costing-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Utility ───────────────────────────────────────────────────────────────────
// Handles SAP/German number format: "1.234,56" → 1234.56
// If already a JS number, returns as-is.
function parseSapNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/\./g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
