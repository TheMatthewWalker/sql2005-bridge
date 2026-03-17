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
    if (fn === 'displayStock') runDisplayStock();
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
            { TABNAME: 'LQUA', FIELDNAME: 'MATNR' },
            { TABNAME: 'LQUA', FIELDNAME: 'CHARG' },
            { TABNAME: 'LQUA', FIELDNAME: 'VERME' },
            { TABNAME: 'LQUA', FIELDNAME: 'LGTYP' },
            { TABNAME: 'LQUA', FIELDNAME: 'LGPLA' },
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
    const columns = ['Material', 'Batch', 'Available Qty', 'Storage Type', 'Storage Bin', 'Stock Category', 'Special Stock', 'Special Stock No.'];

    currentResult = waRows
      .map(r => {
        const parts = r.WA.split('|').map(s => s.trim());
        return {
          'Material':         parts[0] || '',
          'Batch':            parts[1] || '',
          'Available Qty':    parts[2] || '',
          'Storage Type':     parts[3] || '',
          'Storage Bin':      parts[4] || '',
          'Stock Category':   parts[5] || '',
          'Special Stock':    parts[6] || '',
          'Special Stock No.':parts[7] || '',
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

  const badge = document.getElementById('result-row-badge');
  badge.textContent = `${records.length} rows`;
  badge.classList.remove('hidden');
  document.getElementById('btn-export-csv').classList.remove('hidden');
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
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
