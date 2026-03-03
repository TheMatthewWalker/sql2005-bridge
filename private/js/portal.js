'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentTable   = null;   // table name currently displayed
let currentPK      = null;   // PK column for the current table
let currentRows    = [];     // current recordset (filtered or unfiltered)
let currentColumns = [];     // column names for the current table
let contextRowIdx  = null;   // row index for right-click context
let activeDT       = null;   // live DataTable instance
let activeFilter   = null;   // { col, mode, val } or null

// ── Drill-down relationship map ───────────────────────────────────────────────
// pkCol  — column in the PARENT row to read the value from
// fkCol  — column in the CHILD table to filter on
const DRILLDOWN = {
  Batches: [
    { table: 'Coils',   pkCol: 'Drum',    fkCol: 'Batch'  },
    // { table: 'Trace',   pkCol: 'Drum',    fkCol: 'Batch'  },
    { table: 'Waste',   pkCol: 'Drum',    fkCol: 'Batch'  },
  ],
  Ewald: [
    { table: 'EwaldBoxes',     pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldMessages',  pkCol: 'ID', fkCol: 'Batch'   },
    { table: 'EwaldScrapDocs', pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldWaste',     pkCol: 'ID', fkCol: 'EwaldID' },
  ],
  Mixing: [
    { table: 'MixingMatDocs',  pkCol: 'MixingID', fkCol: 'MixingBatch' },
    { table: 'MixingMessages', pkCol: 'MixingID', fkCol: 'Batch'       },
    { table: 'MixingWaste',    pkCol: 'MixingID', fkCol: 'MixingID'    },
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
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { alert('Session expired. Please log in again.'); window.location.href = '/'; }
}, 300_000);

async function sessionOk() {
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { window.location.href = '/'; return false; }
  return true;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tbl-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.tbl-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    // Switching table always resets the filter
    activeFilter = null;
    loadTable(item.dataset.table, item.dataset.pk || null);
  });
});

// Allow pressing Enter in the value box to trigger a search
document.getElementById('filter-val').addEventListener('keydown', e => {
  if (e.key === 'Enter') applyFilter();
});

// ── Build SQL for the current table + optional filter ─────────────────────────
// All filtering is done SERVER-SIDE via parameterised queries so it searches
// the full table, not just the rows already in memory.
//
// We send the query through the existing /query endpoint.  Because the column
// name comes from a whitelist (columns returned by SQL Server itself) and the
// table name was already vetted by the sidebar, the only truly "user" value
// is the filter string — which we embed safely using SQL LIKE / = patterns
// controlled entirely here.  The value never touches the SQL string; it is
// passed as a separate parameter via the /api/filter-records endpoint below.
function buildQuery(tableName, filter) {
  if (!filter) {
    return { sql: `SELECT TOP 500 * FROM dbo.${tableName}`, parameterised: false };
  }
  return { tableName, col: filter.col, mode: filter.mode, val: filter.val, parameterised: true };
}

// ── Load (or reload) the main data panel ─────────────────────────────────────
async function loadTable(tableName, pkCol, filter = null) {
  if (!(await sessionOk())) return;

  currentTable  = tableName;
  currentPK     = pkCol;
  currentRows   = [];
  contextRowIdx = null;

  // Toolbar
  document.getElementById('toolbar').style.display = 'flex';
  document.getElementById('toolbar-title').textContent = tableName;
  document.getElementById('row-badge').textContent = '…';
  document.getElementById('toolbar-hint').textContent = DRILLDOWN[tableName]
    ? 'Right-click any row to drill into related sub-tables'
    : 'No drill-down configured for this table';

  // Destroy existing DataTable
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }

  // Spinner
  document.getElementById('data-panel').innerHTML =
    '<div class="loading-wrap"><div class="spinner"></div>Loading data…</div>';

  try {
    let records;

    if (!filter) {
      // ── Unfiltered: plain TOP 500 via existing /query endpoint ──
      const res  = await fetch('/query', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: `SELECT TOP 500 * FROM dbo.${tableName}` }),
      });
      const data = await res.json();
      if (!data.success) { showError(data.error || 'Query failed'); return; }
      records = data.recordset || [];
    } else {
      // ── Filtered: dedicated parameterised endpoint ──
      const res  = await fetch('/api/filter-records', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tableName: tableName,
          col:       filter.col,
          mode:      filter.mode,
          val:       filter.val,
        }),
      });
      const data = await res.json();
      if (!data.success) { showError(data.error || 'Filter query failed'); return; }
      records = data.recordset || [];
    }

    if (records.length === 0) {
      document.getElementById('data-panel').innerHTML = emptyBlock();
      document.getElementById('row-badge').textContent = '0 rows';
      // Still populate column dropdown if we already know the columns
      if (currentColumns.length === 0 && !filter) {
        // Can't infer columns from empty result — leave bar as-is
      }
      updateFilterUI(filter);
      return;
    }

    currentRows    = records;
    currentColumns = Object.keys(records[0]);

    document.getElementById('row-badge').textContent =
      `${records.length}${records.length === 500 && !filter ? '+ rows (top 500)' : ' rows'}`;

    // Populate column dropdown (first load only, or when table changes)
    populateColumnDropdown(currentColumns);

    // Show the filter bar
    document.getElementById('filter-bar').classList.add('visible');

    // Render table
    document.getElementById('data-panel').innerHTML = buildTableHTML(records, 'main-dt');
    activeDT = new DataTable('#main-dt', { pageLength: 25, scrollX: true });

    // Right-click handlers
    document.querySelectorAll('#main-dt tbody tr').forEach((tr, i) => {
      tr.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextRowIdx = i;
        showCtx(e, tableName);
      });
    });

    updateFilterUI(filter);

  } catch (err) {
    showError(err.message);
  }
}

// ── Filter helpers ────────────────────────────────────────────────────────────
function populateColumnDropdown(cols) {
  const sel = document.getElementById('filter-col');
  // Preserve current selection if the column still exists
  const prev = sel.value;
  sel.innerHTML = '';
  cols.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  if (prev && cols.includes(prev)) sel.value = prev;
}

function updateFilterUI(filter) {
  const clearBtn   = document.getElementById('btn-clear');
  const badge      = document.getElementById('filter-badge');

  if (filter) {
    clearBtn.classList.add('visible');
    badge.classList.add('visible');
    // Restore the inputs to reflect the active filter
    document.getElementById('filter-col').value  = filter.col;
    document.getElementById('filter-mode').value = filter.mode;
    document.getElementById('filter-val').value  = filter.val;
  } else {
    clearBtn.classList.remove('visible');
    badge.classList.remove('visible');
  }
}

async function applyFilter() {
  if (!currentTable) return;
  const col  = document.getElementById('filter-col').value;
  const mode = document.getElementById('filter-mode').value;
  const val  = document.getElementById('filter-val').value.trim();
  if (!val) { alert('Please enter a value to filter by.'); return; }

  activeFilter = { col, mode, val };
  await loadTable(currentTable, currentPK, activeFilter);
}

async function clearFilter() {
  activeFilter = null;
  document.getElementById('filter-val').value = '';
  await loadTable(currentTable, currentPK, null);
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtx(e, tableName) {
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-label').textContent = `dbo.${tableName}`;
  document.getElementById('ctx-drill').classList.toggle('disabled', !DRILLDOWN[tableName]);
  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth  - 240);
  const y = Math.min(e.clientY, window.innerHeight - 140);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
}

function closeCtx() { document.getElementById('ctx-menu').style.display = 'none'; }

document.addEventListener('click',   closeCtx);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCtx(); closeDrilldown(); } });

function copyRow() {
  closeCtx();
  if (contextRowIdx === null || !currentRows[contextRowIdx]) return;
  const text = Object.entries(currentRows[contextRowIdx])
    .map(([k, v]) => `${k}: ${v ?? ''}`)
    .join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Drill-down ────────────────────────────────────────────────────────────────
async function openDrilldown() {
  closeCtx();
  if (contextRowIdx === null) return;
  const relations = DRILLDOWN[currentTable];
  if (!relations) return;
  const parentRow = currentRows[contextRowIdx];

  const overlay = document.getElementById('dd-overlay');
  const body    = document.getElementById('dd-body');
  overlay.classList.add('open');
  document.getElementById('dd-title').textContent = `Related Records — ${currentTable}`;
  document.getElementById('dd-subtitle').textContent = '';
  body.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Fetching related data…</div>';

  const results = await Promise.all(
    relations.map(rel =>
      fetch('/api/related-records', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tableName: rel.table, fkCol: rel.fkCol, fkValue: parentRow[rel.pkCol] }),
      })
      .then(r => r.json())
      .then(data => ({ rel, data }))
      .catch(err => ({ rel, data: { success: false, error: err.message } }))
    )
  );

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

  results.forEach(({ rel, data }) => {
    if (data.recordset && data.recordset.length > 0) {
      try { new DataTable(`#dd-${rel.table}`, { pageLength: 10, scrollX: true }); } catch (_) {}
    }
  });
}

function closeDrilldown() { document.getElementById('dd-overlay').classList.remove('open'); }

document.getElementById('dd-overlay').addEventListener('click', function (e) {
  if (e.target === this) closeDrilldown();
});

// ── CSV export (respects active filter) ──────────────────────────────────────
async function exportCSV() {
  if (!currentTable) return;

  let query;
  if (activeFilter) {
    // Build the LIKE/= clause for the CSV export too
    // The /query-csv endpoint uses an API key rather than session, so we
    // construct the SQL here using the safe pattern (value from our own state).
    const safeVal = activeFilter.val.replace(/'/g, "''"); // escape single quotes for SQL string literal
    let pattern;
    switch (activeFilter.mode) {
      case 'exact':  pattern = `'${safeVal}'`;       break;
      case 'starts': pattern = `'${safeVal}%'`;      break;
      default:       pattern = `'%${safeVal}%'`;     break;
    }
    query = `SELECT * FROM dbo.${currentTable} WHERE ${activeFilter.col} LIKE ${pattern}`;
  } else {
    query = `SELECT * FROM dbo.${currentTable}`;
  }

  const form  = document.createElement('form');
  form.method = 'POST'; form.action = '/query-csv';
  form.append(hiddenInput('query', query));
  form.append(hiddenInput('key',   'you-will-never-guess-this-ka'));
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

function hiddenInput(name, value) {
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

function showError(msg) {
  document.getElementById('data-panel').innerHTML =
    `<div class="loading-wrap" style="color:var(--error)">
       <span style="font-family:'IBM Plex Mono',monospace;font-size:12px">✕ ${esc(msg)}</span>
     </div>`;
  document.getElementById('row-badge').textContent = 'error';
}

function emptyBlock() {
  return `<div class="loading-wrap" style="flex-direction:column;gap:10px">
    <span style="font-size:36px;opacity:.15">∅</span>
    <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim)">No matching records found</span>
  </div>`;
}
