'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentFn       = null;
let activeBatches   = [];
let selectedStation = null;
let selectedBatch   = null;
let liveTimer       = null;
let refreshTimer    = null;

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function api(path, opts) {
  return fetch('/api/productionnexus' + path, opts).then(r => r.json());
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function runTimer(startedAt, el) {
  if (!el) return;
  if (liveTimer) clearInterval(liveTimer);
  if (!startedAt) { el.textContent = '—'; return; }
  const tick = () => {
    const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  };
  tick();
  liveTimer = setInterval(tick, 1000);
}

function statusBadge(statusId) {
  const map = { 1:'open', 2:'in-progress', 3:'on-hold', 4:'complete', 5:'cancelled' };
  const labels = { 1:'Open', 2:'Running', 3:'On Hold', 4:'Complete', 5:'Cancelled' };
  const cls = map[statusId] || 'open';
  return `<span class="pn-status pn-status--${cls}">${esc(labels[statusId] || statusId)}</span>`;
}

function stateColor(s) {
  if (s === 2) return 'var(--accent)';
  if (s === 3) return '#D97706';
  return 'var(--text-muted)';
}

// ── Initialise ────────────────────────────────────────────────────────────────
(async () => {
  try {
    const session = await fetch('/session-check').then(r => r.json());
    if (!session.loggedIn) { window.location.href = '/'; return; }
    document.getElementById('session-user').textContent = session.username;
  } catch { window.location.href = '/'; }
})();

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.sap-tile[data-fn]').forEach(tile => {
  if (tile.classList.contains('sap-tile--placeholder')) return;
  tile.addEventListener('click', () => openFunction(tile.dataset.fn));
});

document.getElementById('btn-back-tiles').addEventListener('click', backToTiles);

function openFunction(fn) {
  currentFn = fn;
  document.getElementById('tile-section').classList.add('hidden');
  document.getElementById('result-section').classList.remove('hidden');

  const titles = {
    lineFloor:    ['Line Floor', 'Live production dashboard'],
    newBatch:     ['New Batch', 'Start a production run at any work centre'],
    activeBatches:['Active Batches', 'All open and in-progress runs'],
    batchHistory: ['Batch History', 'Search completed batches'],
    traceability: ['Traceability', 'Trace a batch through the production chain'],
    scrap:        ['Scrap', 'Scrap entries and rates by work centre'],
    sapReversals: ['SAP Reversals', 'Search and reverse material document postings'],
  };
  const [title, hint] = titles[fn] || [fn, ''];
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-hint').textContent  = hint;

  const body = document.getElementById('result-body');
  body.innerHTML = '<div class="pn-loading"><div class="spinner"></div>Loading…</div>';

  const fns = {
    lineFloor:     runLineFloor,
    newBatch:      runNewBatch,
    activeBatches: runActiveBatches,
    batchHistory:  runBatchHistory,
    traceability:  runTraceability,
    scrap:         runScrap,
    sapReversals:  runSapReversals,
  };
  if (fns[fn]) fns[fn]();
}

function backToTiles() {
  if (liveTimer)    { clearInterval(liveTimer);   liveTimer    = null; }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('tile-section').classList.remove('hidden');
  document.getElementById('result-row-badge').classList.add('hidden');
  currentFn = null;
}

// ── Modal helpers ────────────────────────────────────────────────────────────

function openModal(html) {
  const overlay = document.getElementById('ps-modal-overlay');
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
}
function closeModal() {
  const overlay = document.getElementById('ps-modal-overlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

// ── LINE FLOOR ────────────────────────────────────────────────────────────────

const PROCESS_LABELS = {
  MX:'Mixing', EXT:'Extrusion', CO:'Convoluting', BR:'Braiding',
  CL:'Coverline', TW:'Tape Wrap', DR:'Drumming', EW:'Ewald', HA:'Hose Assembly'
};

async function runLineFloor() {
  // Start auto-refresh if not already running
  if (!refreshTimer) {
    refreshTimer = setInterval(() => { if (currentFn === 'lineFloor') runLineFloor(); }, 30000);
  }
  try {
    const json = await api('/active');
    if (!json.success) throw new Error(json.error);
    activeBatches = json.data || [];

    if (!activeBatches.length) {
      document.getElementById('result-body').innerHTML = '<div class="pn-empty">No active batches at the moment.</div>';
      return;
    }

    // Group by process for station display
    const byProcess = {};
    activeBatches.forEach(b => {
      if (!byProcess[b.ProcessCode]) byProcess[b.ProcessCode] = [];
      byProcess[b.ProcessCode].push(b);
    });

    const processOrder = ['MX','EXT','CO','BR','CL','TW','DR','EW','HA'];
    const activeProcesses = processOrder.filter(p => byProcess[p]);

    // Pick initial selected station
    if (!selectedStation) selectedStation = activeProcesses[0];

    renderLineFloor(byProcess, activeProcesses);
  } catch (err) {
    document.getElementById('result-body').innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`;
  }
}

function renderLineFloor(byProcess, activeProcesses) {
  // KPI strip
  const total    = activeBatches.length;
  const running  = activeBatches.filter(b => b.Status === 2).length;
  const onHold   = activeBatches.filter(b => b.Status === 3).length;

  const kpis = `
    <div class="pf-kpis">
      <div class="pf-kpi">
        <div class="pf-kpi-label">Active batches</div>
        <div class="pf-kpi-val" style="color:var(--accent)">${total}</div>
      </div>
      <div class="pf-kpi">
        <div class="pf-kpi-label">Running</div>
        <div class="pf-kpi-val" style="color:#059669">${running}</div>
      </div>
      <div class="pf-kpi">
        <div class="pf-kpi-label">On hold</div>
        <div class="pf-kpi-val" style="color:#D97706">${onHold}</div>
      </div>
      <div class="pf-kpi">
        <div class="pf-kpi-label">Work centres</div>
        <div class="pf-kpi-val">${activeProcesses.length}</div>
      </div>
      <div class="pf-kpi">
        <div class="pf-kpi-label" id="pf-clock-label">Runtime</div>
        <div class="pf-kpi-val" style="font-family:'JetBrains Mono',monospace;color:var(--accent);font-size:20px" id="pf-clock">—</div>
      </div>
    </div>`;

  // Station flow
  const stationCards = activeProcesses.map(pc => {
    const batches = byProcess[pc];
    const b = batches[0]; // show the first/primary batch
    const isFocused = pc === selectedStation;
    const color = stateColor(b.Status);
    const pct   = b.StartedAt ? Math.min(99, Math.floor((Date.now() - new Date(b.StartedAt).getTime()) / 1000 / 60)) : 0;

    return `<div class="pf-station ${isFocused ? 'pf-station--on' : ''}" data-pc="${esc(pc)}">
      <div class="pf-station-top">
        <div style="display:flex;align-items:center;gap:7px">
          <span class="pf-dot" style="background:${color};box-shadow:${b.Status!==1?`0 0 7px ${color}`:'none'}"></span>
          <span class="pf-station-name">${esc(PROCESS_LABELS[pc] || pc)}</span>
        </div>
        <span class="pf-station-state" style="color:${color};background:${color.replace(')', ',0.1)').replace('var(','rgba(').replace(/[a-z-]+\)/, '0.1)')}">${b.Status===2?'RUNNING':b.Status===3?'ON HOLD':'OPEN'}</span>
      </div>
      <div class="pf-station-ref">${esc(b.BatchRef)}</div>
      <div class="pf-station-op">OPERATOR · ${esc(b.PrimaryOperator || '—')}</div>
      <div class="pf-station-bar"><div class="pf-station-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="pf-station-meta">
        <span>${batches.length} batch${batches.length>1?'es':''}</span>
        <span>${esc(b.Material)}</span>
      </div>
    </div>`;
  });

  const connectors = activeProcesses.slice(0, -1).map(() =>
    `<div class="pf-connector"><svg viewBox="0 0 60 12" preserveAspectRatio="none">
      <line x1="0" y1="6" x2="60" y2="6" stroke="var(--border2)" stroke-width="1.5" stroke-dasharray="3 3"/>
      <circle cx="30" cy="6" r="2.5" fill="var(--accent)" opacity="0.6"/>
    </svg></div>`
  );

  const flowTrack = [];
  stationCards.forEach((card, i) => { flowTrack.push(card); if (connectors[i]) flowTrack.push(connectors[i]); });

  const flow = `<div class="pf-flow">
    <div class="pf-flow-eyebrow">Batch flow · live</div>
    <div class="pf-flow-track">${flowTrack.join('')}</div>
  </div>`;

  // Lower: batch ticker + station detail
  const selectedBatches = byProcess[selectedStation] || [];
  const tickerRows = activeBatches.map(b => `
    <div class="pf-tr ${selectedBatch === b.RecordID + b.ProcessCode ? 'pf-tr--on' : ''}" data-pc="${esc(b.ProcessCode)}" data-rid="${esc(String(b.RecordID))}">
      <span class="pf-tr-ref">${esc(b.BatchRef)}</span>
      <span class="pf-tr-mono">${esc(b.Material)}</span>
      <span>${esc(String(b.Quantity ?? '—'))} ${esc(b.UOM)}</span>
      <span class="pf-tr-mono">${fmtTime(b.StartedAt)}</span>
      <span class="pf-tr-mono">${esc(b.MachineCode || '—')}</span>
      <span>${statusBadge(b.Status)}</span>
    </div>`).join('');

  const ticker = `<div class="pf-card">
    <div class="pf-card-hdr">
      <div>
        <div class="pf-card-eyebrow">Active &amp; queued batches</div>
        <div class="pf-card-title">Batch ticker</div>
      </div>
    </div>
    <div class="pf-table">
      <div class="pf-th"><span>Batch</span><span>Material</span><span>Qty</span><span>Started</span><span>Machine</span><span>Status</span></div>
      ${tickerRows}
    </div>
  </div>`;

  // Station detail panel
  const sb = selectedBatches[0];
  const detail = sb ? `<div class="pf-card">
    <div class="pf-card-hdr">
      <div>
        <div class="pf-card-eyebrow">Station detail</div>
        <div class="pf-card-title">${esc(PROCESS_LABELS[selectedStation] || selectedStation)} — ${esc(sb.BatchRef)}</div>
      </div>
      <span class="pn-status pn-status--in-progress">${esc(sb.ShiftName || '')}</span>
    </div>
    <div class="pf-detail-grid">
      <div><div class="pf-detail-label">Operator</div><div class="pf-detail-val">${esc(sb.PrimaryOperator || '—')}</div></div>
      <div><div class="pf-detail-label">Machine</div><div class="pf-detail-val">${esc(sb.MachineName || sb.MachineCode || '—')}</div></div>
      <div><div class="pf-detail-label">Material</div><div class="pf-detail-val">${esc(sb.Material)}</div></div>
      <div><div class="pf-detail-label">Quantity</div><div class="pf-detail-val">${esc(String(sb.Quantity ?? '—'))} ${esc(sb.UOM)}</div></div>
      <div><div class="pf-detail-label">Started</div><div class="pf-detail-val">${fmt(sb.StartedAt)}</div></div>
      <div><div class="pf-detail-label">Runtime</div><div class="pf-detail-val" id="pf-detail-clock">—</div></div>
    </div>
    <div class="pf-event-log">
      <div class="pf-event-log-hdr">Event log</div>
      <div id="pf-event-log-body"><div class="pn-loading"><div class="spinner"></div>Loading…</div></div>
    </div>
  </div>` : `<div class="pf-card"><div class="pn-empty">Select a station to view details.</div></div>`;

  const lower = `<div class="pf-lower">${ticker}${detail}</div>`;

  document.getElementById('result-body').innerHTML = kpis + flow + lower;

  // Wire station click
  document.querySelectorAll('.pf-station[data-pc]').forEach(el => {
    el.addEventListener('click', () => {
      selectedStation = el.dataset.pc;
      renderLineFloor(byProcess, activeProcesses);
    });
  });

  // Wire batch row click — single click selects station, double-click opens modal
  document.querySelectorAll('.pf-tr[data-pc]').forEach(el => {
    el.addEventListener('click', () => {
      selectedStation = el.dataset.pc;
      selectedBatch = el.dataset.rid + el.dataset.pc;
      renderLineFloor(byProcess, activeProcesses);
    });
    el.addEventListener('dblclick', () => openBatchModal(el.dataset.pc, Number(el.dataset.rid)));
  });

  // Live runtime clock
  if (sb?.StartedAt) {
    runTimer(sb.StartedAt, document.getElementById('pf-detail-clock'));
    const clockLbl = document.getElementById('pf-clock-label');
    const clockEl  = document.getElementById('pf-clock');
    if (clockLbl) clockLbl.textContent = `${sb.BatchRef} runtime`;
    if (clockEl && sb.StartedAt) {
      const tick = () => {
        const s = Math.floor((Date.now() - new Date(sb.StartedAt).getTime()) / 1000);
        const h = String(Math.floor(s/3600)).padStart(2,'0');
        const m = String(Math.floor((s%3600)/60)).padStart(2,'0');
        const sec = String(s%60).padStart(2,'0');
        clockEl.textContent = `${h}:${m}:${sec}`;
      };
      tick();
    }
  }

  // Load event log for selected station
  if (sb) loadEventLog(sb.ProcessCode, sb.RecordID, 'pf-event-log-body');
}

async function loadEventLog(processCode, recordId, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const json = await api(`/batch/${processCode}/${recordId}/events`);
    const events = json.data || [];
    if (!events.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">No events recorded yet.</div>'; return; }
    el.innerHTML = events.slice(0, 20).map(e => {
      const dot = e.Severity === 2 ? 'err' : e.Severity === 1 ? 'warn' : e.EventType === 'SAP_POST' ? 'info' : 'ok';
      return `<div class="pf-log-row">
        <span class="pf-log-time">${fmtTime(e.CreatedAt)}</span>
        <span class="pf-log-dot pf-log-dot--${dot}"></span>
        <span class="pf-log-text">${esc(e.EventMessage)}</span>
      </div>`;
    }).join('');
  } catch (_) { if (el) el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Could not load events.</div>'; }
}

// ── ACTIVE BATCHES ────────────────────────────────────────────────────────────

async function runActiveBatches() {
  try {
    const json = await api('/active');
    if (!json.success) throw new Error(json.error);
    const rows = json.data || [];

    const badge = document.getElementById('result-row-badge');
    badge.textContent = `${rows.length} active`;
    badge.classList.remove('hidden');

    if (!rows.length) {
      document.getElementById('result-body').innerHTML = '<div class="pn-empty">No active batches.</div>';
      return;
    }

    const tableRows = rows.map(b => `<tr class="pn-row" data-pc="${esc(b.ProcessCode)}" data-rid="${esc(String(b.RecordID))}">
      <td class="pn-batch-ref">${esc(b.BatchRef)}</td>
      <td>${esc(PROCESS_LABELS[b.ProcessCode] || b.ProcessCode)}</td>
      <td class="pn-batch-mono">${esc(b.Material)}</td>
      <td>${esc(String(b.Quantity ?? '—'))} <span class="pn-batch-mono">${esc(b.UOM)}</span></td>
      <td class="pn-batch-mono">${esc(b.PrimaryOperator || '—')}</td>
      <td class="pn-batch-mono">${esc(b.ShiftName || '—')}</td>
      <td>${fmt(b.StartedAt)}</td>
      <td>${statusBadge(b.Status)}</td>
    </tr>`).join('');

    document.getElementById('result-body').innerHTML = `
      <div style="padding:16px 20px;overflow:auto">
        <table class="pn-batch-table">
          <thead><tr>
            <th>Batch Ref</th><th>Process</th><th>Material</th><th>Quantity</th>
            <th>Operator</th><th>Shift</th><th>Started</th><th>Status</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;

    document.querySelectorAll('.pn-row[data-pc]').forEach(row => {
      row.addEventListener('click', () => openBatchModal(row.dataset.pc, Number(row.dataset.rid)));
    });
  } catch (err) {
    document.getElementById('result-body').innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`;
  }
}

// ── BATCH HISTORY ─────────────────────────────────────────────────────────────

async function runBatchHistory() {
  document.getElementById('result-body').innerHTML = `
    <div style="padding:16px 20px">
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <input id="hist-ref" class="tf-input" placeholder="Batch ref…" style="width:140px">
        <input id="hist-mat" class="tf-input" placeholder="Material…" style="width:160px">
        <input id="hist-from" class="tf-input" type="date" style="width:150px">
        <input id="hist-to"   class="tf-input" type="date" style="width:150px">
        <button class="btn-filter-search" id="hist-search-btn">Search</button>
      </div>
      <div id="hist-results"><div class="pn-empty">Enter search criteria and click Search.</div></div>
    </div>`;

  document.getElementById('hist-search-btn').addEventListener('click', async () => {
    const ref  = document.getElementById('hist-ref').value.trim();
    const mat  = document.getElementById('hist-mat').value.trim();
    const from = document.getElementById('hist-from').value;
    const to   = document.getElementById('hist-to').value;
    const params = new URLSearchParams();
    if (ref)  params.set('ref', ref);
    if (mat)  params.set('material', mat);
    if (from) params.set('fromDate', from);
    if (to)   params.set('toDate', to);

    const el = document.getElementById('hist-results');
    el.innerHTML = '<div class="pn-loading"><div class="spinner"></div>Searching…</div>';
    try {
      const json = await api(`/history?${params}`);
      const rows = json.data || [];
      if (!rows.length) { el.innerHTML = '<div class="pn-empty">No results found.</div>'; return; }
      el.innerHTML = `<table class="pn-batch-table">
        <thead><tr><th>Ref</th><th>Process</th><th>Material</th><th>Qty</th><th>Status</th><th>Created</th><th>Completed</th></tr></thead>
        <tbody>${rows.map(b => `<tr>
          <td class="pn-batch-ref">${esc(b.BatchRef)}</td>
          <td>${esc(PROCESS_LABELS[b.ProcessCode] || b.ProcessCode)}</td>
          <td class="pn-batch-mono">${esc(b.Material)}</td>
          <td>${esc(String(b.Quantity??'—'))} <span class="pn-batch-mono">${esc(b.UOM)}</span></td>
          <td>${statusBadge(b.Status)}</td>
          <td class="pn-batch-mono">${fmt(b.CreatedAt)}</td>
          <td class="pn-batch-mono">${fmt(b.CompletedAt)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    } catch (err) { el.innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`; }
  });
}

// ── TRACEABILITY ──────────────────────────────────────────────────────────────

async function runTraceability() {
  document.getElementById('result-body').innerHTML = `
    <div style="padding:16px 20px">
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="trace-ref" class="tf-input" placeholder="Batch ref e.g. EXT-00000031" style="width:240px">
        <select id="trace-pc" class="tf-input" style="width:160px">
          <option value="">All processes</option>
          ${Object.entries(PROCESS_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
        <button class="btn-filter-search" id="trace-btn">Trace</button>
      </div>
      <div id="trace-results"><div class="pn-empty">Enter a batch reference to trace its full production history.</div></div>
    </div>`;

  document.getElementById('trace-btn').addEventListener('click', async () => {
    const ref = document.getElementById('trace-ref').value.trim();
    const pc  = document.getElementById('trace-pc').value;
    if (!ref && !pc) return;
    const el = document.getElementById('trace-results');
    el.innerHTML = '<div class="pn-loading"><div class="spinner"></div>Tracing…</div>';
    try {
      // Find the record by ref: search active + history
      const hist = await api(`/history?ref=${encodeURIComponent(ref)}${pc?'&processCode='+pc:''}`);
      const batch = (hist.data || [])[0];
      if (!batch) { el.innerHTML = '<div class="pn-empty">Batch not found.</div>'; return; }

      const traceJson = await api(`/trace/${batch.ProcessCode}/${batch.RecordID}`);
      const chain = traceJson.data || [];

      if (!chain.length) {
        el.innerHTML = `<div class="pn-empty"><strong>${esc(batch.BatchRef)}</strong> — no trace links recorded for this batch.</div>`;
        return;
      }

      el.innerHTML = `<div style="font-size:13px;margin-bottom:12px">
        Showing ${chain.length} trace link(s) for <strong>${esc(batch.BatchRef)}</strong></div>
        <table class="pn-batch-table">
          <thead><tr><th>Depth</th><th>Child Batch</th><th>Parent Batch</th></tr></thead>
          <tbody>${chain.map(t => `<tr>
            <td class="pn-batch-mono">${t.Depth}</td>
            <td class="pn-batch-ref">${esc(t.ChildProcessCode)}-${t.ChildRecordID}</td>
            <td class="pn-batch-ref">${esc(t.ParentProcessCode)}-${t.ParentRecordID}</td>
          </tr>`).join('')}</tbody>
        </table>`;
    } catch (err) { el.innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`; }
  });
}

// ── SCRAP ─────────────────────────────────────────────────────────────────────

async function runScrap() {
  document.getElementById('result-body').innerHTML = '<div class="pn-loading"><div class="spinner"></div>Loading scrap data…</div>';
  try {
    const [summaryJson, reasonsJson] = await Promise.all([
      api('/scrap/summary'),
      api('/scrap-reasons'),
    ]);
    const summary = summaryJson.data || [];
    const reasons = reasonsJson.data || [];

    const badge = document.getElementById('result-row-badge');
    badge.textContent = `Last 30 days`;
    badge.classList.remove('hidden');

    if (!summary.length) {
      document.getElementById('result-body').innerHTML = `
        <div style="padding:20px">
          <div class="pn-empty">No scrap entries in the last 30 days.</div>
        </div>`;
      return;
    }

    // Group by process
    const byProcess = {};
    summary.forEach(r => {
      if (!byProcess[r.ProcessCode]) byProcess[r.ProcessCode] = [];
      byProcess[r.ProcessCode].push(r);
    });

    const sections = Object.entries(byProcess).map(([pc, rows]) => {
      const totalScrap = rows.reduce((s, r) => s + Number(r.TotalScrap || 0), 0);
      const uom = rows[0].UnitOfMeasure;
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:700;font-size:14px">${esc(PROCESS_LABELS[pc] || pc)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--error)">${totalScrap.toFixed(3)} ${esc(uom)} total</div>
        </div>
        <table class="pn-batch-table" style="margin:0">
          <thead><tr><th>Reason</th><th>Entries</th><th>Total Scrap</th><th>UOM</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td>${esc(r.ReasonDescription || r.ReasonCode || '—')}</td>
            <td class="pn-batch-mono">${r.EntryCount}</td>
            <td class="pn-batch-mono" style="color:var(--error)">${Number(r.TotalScrap).toFixed(3)}</td>
            <td class="pn-batch-mono">${esc(r.UnitOfMeasure)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    }).join('');

    document.getElementById('result-body').innerHTML = `
      <div style="padding:16px 20px">
        <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">Scrap summary across all work centres — last 30 days</div>
        ${sections}
      </div>`;
  } catch (err) {
    document.getElementById('result-body').innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`;
  }
}

// ── SAP REVERSALS ─────────────────────────────────────────────────────────────

async function runSapReversals() {
  document.getElementById('result-body').innerHTML = `
    <div style="padding:16px 20px">
      <div style="margin-bottom:8px;font-size:13px;color:var(--text-muted)">
        Enter the SAP material document number that was reversed in SAP to find and mark the corresponding production record.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input id="rev-matdoc" class="tf-input" placeholder="Material document e.g. 5000001234" style="width:220px">
        <button class="btn-filter-search" id="rev-search-btn">Search</button>
      </div>
      <div id="rev-results"></div>
    </div>`;

  document.getElementById('rev-search-btn').addEventListener('click', async () => {
    const doc = document.getElementById('rev-matdoc').value.trim();
    if (!doc) return;
    const el = document.getElementById('rev-results');
    el.innerHTML = '<div class="pn-loading"><div class="spinner"></div>Searching…</div>';
    try {
      const json = await api(`/reversal/search?materialDocument=${encodeURIComponent(doc)}`);
      const rows = json.data || [];
      if (!rows.length) { el.innerHTML = '<div class="pn-empty">No matching SAP posting found for that document number.</div>'; return; }

      el.innerHTML = rows.map(r => `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <div style="font-weight:700;font-size:14px;margin-bottom:6px">${esc(r.ProcessCode)}-${r.ProcessRecordID} &nbsp;·&nbsp; ${esc(r.PostingType)}</div>
              <div class="pn-batch-mono" style="font-size:11px">Doc: ${esc(r.MaterialDocumentSAP)} &nbsp;·&nbsp; Qty: ${r.Quantity} ${r.UnitOfMeasure} &nbsp;·&nbsp; Posted: ${fmt(r.PostedAt)}</div>
            </div>
            ${r.IsReversed
              ? `<span class="pn-status pn-status--cancelled">Reversed</span>`
              : `<div style="display:flex;gap:6px;align-items:center">
                   <input class="tf-input rev-doc-input" placeholder="Reversal doc…" style="width:160px" data-posting-id="${r.SAPPostingID}">
                   <button class="btn-filter-search rev-confirm-btn" data-posting-id="${r.SAPPostingID}">Confirm Reversal</button>
                 </div>`}
          </div>
        </div>`).join('');

      document.querySelectorAll('.rev-confirm-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.postingId;
          const docInput = el.querySelector(`.rev-doc-input[data-posting-id="${pid}"]`);
          const reversalDoc = docInput?.value.trim();
          if (!reversalDoc) { alert('Please enter the SAP reversal document number.'); return; }
          btn.disabled = true; btn.textContent = 'Processing…';
          try {
            const res = await api(`/reversal/${pid}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reversalDocumentSAP: reversalDoc }),
            });
            if (!res.success) throw new Error(res.error);
            runSapReversals(); // refresh
          } catch (err) {
            btn.disabled = false; btn.textContent = 'Confirm Reversal';
            alert('Reversal failed: ' + err.message);
          }
        });
      });
    } catch (err) { el.innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`; }
  });
}

// ── NEW BATCH ─────────────────────────────────────────────────────────────────

async function runNewBatch() {
  document.getElementById('result-body').innerHTML = '<div class="pn-loading"><div class="spinner"></div>Loading…</div>';
  try {
    const [shiftsJson, wcJson] = await Promise.all([
      api('/shifts'),
      api('/work-centres'),
    ]);
    const shifts = shiftsJson.data || [];
    const wcs    = wcJson.data    || [];

    const processGroups = {};
    wcs.forEach(row => {
      if (!processGroups[row.ProcessCode]) processGroups[row.ProcessCode] = { wc: row, machines: [] };
      if (row.MachineID) processGroups[row.ProcessCode].machines.push(row);
    });

    const processOptions = Object.entries(PROCESS_LABELS)
      .map(([k,v]) => `<option value="${k}">${v} (${k})</option>`).join('');

    const shiftOptions = shifts.map(s => `<option value="${s.ShiftID}">${s.ShiftName} (${s.StartTime}–${s.EndTime})</option>`).join('');

    document.getElementById('result-body').innerHTML = `
      <div style="padding:20px;max-width:600px">
        <div class="transfer-form">
          <div class="tf-row">
            <div class="tf-field">
              <label class="tf-label">Process / Work Centre</label>
              <select class="tf-input" id="nb-process">${processOptions}</select>
            </div>
            <div class="tf-field">
              <label class="tf-label">Shift</label>
              <select class="tf-input" id="nb-shift">${shiftOptions}</select>
            </div>
          </div>
          <div class="tf-row">
            <div class="tf-field tf-field--wide">
              <label class="tf-label">SAP Material Number</label>
              <input class="tf-input" id="nb-material" placeholder="e.g. K-NBR-87-1234">
            </div>
          </div>
          <div id="nb-process-extra"></div>
          <div class="tf-row">
            <div class="tf-field tf-field--wide">
              <label class="tf-label">Notes</label>
              <input class="tf-input" id="nb-notes" placeholder="Optional">
            </div>
          </div>
          <div id="nb-result" style="margin-top:8px;font-size:13px"></div>
          <div class="tf-row" style="margin-top:4px">
            <button class="btn-submit" id="nb-create-btn">Create Batch</button>
          </div>
        </div>
      </div>`;

    // Show extra fields based on process
    const updateExtraFields = () => {
      const pc = document.getElementById('nb-process').value;
      let extra = '';
      if (pc === 'MX') {
        extra = `<div class="tf-row">
          <div class="tf-field"><label class="tf-label">Mix Code</label><input class="tf-input" id="nb-mixcode" placeholder="e.g. K-NBR-87-R4"></div>
          <div class="tf-field"><label class="tf-label">Supplier Batch No</label><input class="tf-input" id="nb-suppbatch"></div>
          <div class="tf-field"><label class="tf-label">Supplier Tub No</label><input class="tf-input" id="nb-supptub"></div>
        </div>`;
      } else if (pc === 'DR') {
        extra = `<div class="tf-row">
          <div class="tf-field"><label class="tf-label">Product Barcode</label><input class="tf-input" id="nb-barcode"></div>
          <div class="tf-field"><label class="tf-label">SAP Sales Order</label><input class="tf-input" id="nb-salesorder"></div>
        </div>`;
      } else if (pc === 'FW') {
        extra = `<div class="tf-row"><div class="tf-field tf-field--wide"><label class="tf-label">Ewald Batch ID</label><input class="tf-input" id="nb-ewaldid" type="number" placeholder="Enter Ewald record ID"></div></div>`;
      }
      document.getElementById('nb-process-extra').innerHTML = extra;
    };

    document.getElementById('nb-process').addEventListener('change', updateExtraFields);
    updateExtraFields();

    document.getElementById('nb-create-btn').addEventListener('click', async () => {
      const btn      = document.getElementById('nb-create-btn');
      const resultEl = document.getElementById('nb-result');
      const pc       = document.getElementById('nb-process').value;
      const shiftID  = Number(document.getElementById('nb-shift').value);
      const material = document.getElementById('nb-material').value.trim();
      const notes    = document.getElementById('nb-notes').value.trim() || undefined;

      if (!material) { resultEl.textContent = 'Material number is required.'; resultEl.style.color = 'var(--error)'; return; }

      const body = { processCode: pc, shiftID, material, notes };
      if (pc === 'MX') {
        body.mixCode       = document.getElementById('nb-mixcode')?.value.trim();
        body.supplierBatchNo = document.getElementById('nb-suppbatch')?.value.trim();
        body.supplierTubNo   = document.getElementById('nb-supptub')?.value.trim();
      } else if (pc === 'DR') {
        body.productBarcode = document.getElementById('nb-barcode')?.value.trim();
        body.salesOrderSAP  = document.getElementById('nb-salesorder')?.value.trim();
      } else if (pc === 'FW') {
        body.ewaldID = Number(document.getElementById('nb-ewaldid')?.value);
      }

      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const json = await api('/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!json.success) throw new Error(json.error);
        resultEl.style.color = 'var(--accent)';
        resultEl.textContent = `✓ Created ${json.data.processCode}-${json.data.recordId}`;
        btn.disabled = false; btn.textContent = 'Create Batch';
      } catch (err) {
        resultEl.style.color = 'var(--error)';
        resultEl.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Create Batch';
      }
    });
  } catch (err) {
    document.getElementById('result-body').innerHTML = `<div class="pn-empty">${esc(err.message)}</div>`;
  }
}
