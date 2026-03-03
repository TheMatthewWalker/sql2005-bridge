// ─────────────────────────────────────────────────────────────────────────────
// Kongsberg Portal — Table Browser
// All navigation is via the sidebar. Right-click any row to drill into the
// related sub-tables for that record.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let currentTable   = null;   // name of the table currently displayed
let currentPK      = null;   // PK column name for the current table
let currentRows    = [];     // full recordset for the current table
let contextRowIdx  = null;   // index into currentRows for the right-clicked row
let activeDT       = null;   // active DataTable instance

// ── Drill-down map ────────────────────────────────────────────────────────────
// For each main table: which sub-tables link to it, and via which columns.
//   pkCol  — column in the PARENT row whose value we look up
//   fkCol  — column in the CHILD table we filter on
const DRILLDOWN = {
  Batches: [
    { table: 'Coils',   pkCol: 'Drum',    fkCol: 'Batch'  },
    { table: 'Trace',   pkCol: 'Drum',    fkCol: 'Batch'  },
    { table: 'Waste',   pkCol: 'Drum',    fkCol: 'Batch'  },
  ],
  Ewald: [
    { table: 'EwaldBoxes',    pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldMessages', pkCol: 'ID', fkCol: 'Batch'   },
    { table: 'EwaldScrapDocs',pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldWaste',    pkCol: 'ID', fkCol: 'EwaldID' },
  ],
  Mixing: [
    { table: 'MixingMatDocs',  pkCol: 'MixingID', fkCol: 'MixingBatch' },
    { table: 'MixingMessages', pkCol: 'MixingID', fkCol: 'Batch'        },
    { table: 'MixingWaste',    pkCol: 'MixingID', fkCol: 'MixingID'     },
  ],
  Extrusion: [
    { table: 'ExtrusionMessages', pkCol: 'ExtBatch', fkCol: 'Batch'    },
    { table: 'ExtrusionTrace',    pkCol: 'ExtBatch', fkCol: 'ExtBatch' },
    { table: 'ExtrusionWaste',    pkCol: 'ExtBatch', fkCol: 'ExtBatch' },
  ],
  Convo: [
    { table: 'ConvoMessages', pkCol: 'ConvoID', fkCol: 'Batch'      },
    { table: 'ConvoTrace',    pkCol: 'ConvoID', fkCol: 'ConvoID'    },
    { table: 'ConvoWaste',    pkCol: 'ConvoID', fkCol: 'convobatch' },
  ],
  Firewall: [
    { table: 'FirewallMessages', pkCol: 'SAPBatch', fkCol: 'SAPBatch' },
  ],
  Staging: [
    { table: 'StagingItems', pkCol: 'StagingID', fkCol: 'StagingID' },
  ],
};

// ── Session management ────────────────────────────────────────────────────────
setInterval(async () => {
  const data = await fetch('/session-check').then(r => r.json());
  if (!data.loggedIn) {
    alert('Your session has expired. Please log in again.');
    window.location.href = '/';
  }
}, 300_000); // every 5 minutes

async function sessionOk() {
  const data = await fetch('/session-check').then(r => r.json());
  if (!data.loggedIn) { window.location.href = '/'; return false; }
  return true;
}

// ── Sidebar click handlers ────────────────────────────────────────────────────
document.querySelectorAll('.tbl-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.tbl-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadTable(item.dataset.table, item.dataset.pk || null);
  });
});

// ── Load a table into the main panel ─────────────────────────────────────────
async function loadTable(tableName, pkCol) {
  if (!(await sessionOk())) return;

  currentTable  = tableName;
  currentPK     = pkCol;
  currentRows   = [];
  contextRowIdx = null;

  // Toolbar
  const toolbar = document.getElementById('toolbar');
  toolbar.style.display = 'flex';
  document.getElementById('toolbar-title').textContent = tableName;
  document.getElementById('row-badge').textContent = '…';

  const hasDrill = !!DRILLDOWN[tableName];
  document.getElementById('toolbar-hint').textContent = hasDrill
    ? 'Right-click any row to drill into related sub-tables'
    : 'No drill-down configured for this table';

  // Destroy old DataTable instance cleanly
  if (activeDT) {
    try { activeDT.destroy(); } catch (_) {}
    activeDT = null;
  }

  // Show spinner
  const panel = document.getElementById('data-panel');
  panel.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Loading data…</div>';

  try {
    const res  = await fetch('/query', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: `SELECT TOP 500 * FROM dbo.${tableName}` }),
    });
    const data = await res.json();

    if (!data.success) {
      panel.innerHTML = errorBlock(data.error || 'Query failed');
      document.getElementById('row-badge').textContent = 'error';
      return;
    }

    if (!data.recordset || data.recordset.length === 0) {
      panel.innerHTML = emptyBlock();
      document.getElementById('row-badge').textContent = '0 rows';
      return;
    }

    currentRows = data.recordset;
    document.getElementById('row-badge').textContent = `${data.recordset.length} rows`;

    // Render table
    panel.innerHTML = buildTableHTML(data.recordset, 'main-dt');
    activeDT = new DataTable('#main-dt', { pageLength: 25, scrollX: true });

    // Attach right-click listener to each body row
    document.querySelectorAll('#main-dt tbody tr').forEach((tr, i) => {
      tr.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextRowIdx = i;
        showCtx(e, tableName);
      });
    });

  } catch (err) {
    panel.innerHTML = errorBlock(err.message);
    document.getElementById('row-badge').textContent = 'error';
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtx(e, tableName) {
  const menu  = document.getElementById('ctx-menu');
  const drill = document.getElementById('ctx-drill');

  document.getElementById('ctx-label').textContent = `dbo.${tableName}`;
  drill.classList.toggle('disabled', !DRILLDOWN[tableName]);

  menu.style.display = 'block';
  // Keep menu inside viewport
  const x = Math.min(e.clientX, window.innerWidth  - 240);
  const y = Math.min(e.clientY, window.innerHeight - 140);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
}

function closeCtx() {
  document.getElementById('ctx-menu').style.display = 'none';
}

document.addEventListener('click',   closeCtx);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeCtx(); closeDrilldown(); }
});

function copyRow() {
  closeCtx();
  if (contextRowIdx === null || !currentRows[contextRowIdx]) return;
  const row  = currentRows[contextRowIdx];
  const text = Object.entries(row).map(([k, v]) => `${k}: ${v ?? ''}`).join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Drill-down ────────────────────────────────────────────────────────────────
async function openDrilldown() {
  closeCtx();
  if (contextRowIdx === null) return;

  const relations = DRILLDOWN[currentTable];
  if (!relations) return;

  const parentRow = currentRows[contextRowIdx];

  // Show modal immediately with spinner
  const overlay = document.getElementById('dd-overlay');
  const body    = document.getElementById('dd-body');
  overlay.classList.add('open');
  document.getElementById('dd-title').textContent    = `Related Records — ${currentTable}`;
  document.getElementById('dd-subtitle').textContent = '';
  body.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Fetching related data…</div>';

  // Fetch each sub-table in parallel
  const results = await Promise.all(
    relations.map(rel =>
      fetch('/api/related-records', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tableName: rel.table,
          fkCol:     rel.fkCol,
          fkValue:   parentRow[rel.pkCol],
        }),
      })
      .then(r => r.json())
      .then(data => ({ rel, data }))
      .catch(err => ({ rel, data: { success: false, error: err.message } }))
    )
  );

  // Build modal content
  let html = '';
  for (const { rel, data } of results) {
    const pkVal = parentRow[rel.pkCol];
    html += `<div class="dd-section">${rel.table}
      <span style="color:var(--text-dim);font-size:9px;margin-left:8px;letter-spacing:1px">
        ${rel.fkCol} = ${esc(String(pkVal ?? ''))}
      </span>
    </div>`;

    if (!data.success || !data.recordset || data.recordset.length === 0) {
      html += `<div class="dd-empty">No related records found in ${rel.table}.</div>`;
    } else {
      html += buildTableHTML(data.recordset, `dd-${rel.table}`);
    }
  }

  body.innerHTML = html || '<div class="loading-wrap">No related data configured.</div>';

  // Init DataTables for each sub-table that has rows
  results.forEach(({ rel, data }) => {
    if (data.recordset && data.recordset.length > 0) {
      try { new DataTable(`#dd-${rel.table}`, { pageLength: 10, scrollX: true }); } catch (_) {}
    }
  });
}

function closeDrilldown() {
  document.getElementById('dd-overlay').classList.remove('open');
}

document.getElementById('dd-overlay').addEventListener('click', function (e) {
  if (e.target === this) closeDrilldown();
});

// ── CSV export ────────────────────────────────────────────────────────────────
async function exportCSV() {
  if (!currentTable) return;
  const form   = document.createElement('form');
  form.method  = 'POST';
  form.action  = '/query-csv';
  const q = input('query', `SELECT * FROM dbo.${currentTable}`);
  const k = input('key',   'you-will-never-guess-this-ka');
  form.append(q, k);
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

function input(name, value) {
  const el = document.createElement('input');
  el.type = 'hidden'; el.name = name; el.value = value;
  return el;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildTableHTML(rows, id) {
  const cols = Object.keys(rows[0]);
  let h = `<table id="${id}" style="width:100%"><thead><tr>`;
  cols.forEach(c => { h += `<th>${esc(c)}</th>`; });
  h += '</tr></thead><tbody>';
  rows.forEach(row => {
    h += '<tr>';
    cols.forEach(c => {
      let v = row[c]; if (v === null || v === undefined) v = '';
      h += `<td>${esc(String(v))}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorBlock(msg) {
  return `<div class="loading-wrap" style="color:var(--error)">
    <span style="font-family:'IBM Plex Mono',monospace;font-size:12px">✕ ${esc(msg)}</span>
  </div>`;
}

function emptyBlock() {
  return `<div class="loading-wrap" style="flex-direction:column;gap:10px">
    <span style="font-size:36px;opacity:.15">∅</span>
    <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim)">No data returned</span>
  </div>`;
}
