'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let activeDT      = null;
let currentResult = [];


const DRILLDOWN = {
  ShipmentMain: [
    { table: 'Shipment',   pkCol: 'Drum',    fkCol: 'Batch'  },
    // { table: 'Trace',   pkCol: 'Drum',    fkCol: 'Batch'  },
    { table: 'Waste',   pkCol: 'Drum',    fkCol: 'Batch'  },
    { table: 'Messages', pkCol: 'Drum',    fkCol: 'Batch'  },
  ],
  Ewald: [
    { table: 'EwaldBoxes',     pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldMessages',  pkCol: 'ID', fkCol: 'Batch'   },
    //{ table: 'EwaldScrapDocs', pkCol: 'ID', fkCol: 'EwaldID' },
    { table: 'EwaldWaste',     pkCol: 'ID', fkCol: 'EwaldID' },
  ],
  Mixing: [
    { table: 'MixingMatDocs',  pkCol: 'MixingID', fkCol: 'MixingBatch' },
    { table: 'MixingMessages', pkCol: 'MixingID', fkCol: 'Batch'       },
    // { table: 'MixingWaste',    pkCol: 'MixingID', fkCol: 'MixingID'    },
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

// ── Session check on load ─────────────────────────────────────────────────────
(async () => {
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { window.location.href = '/'; return; }
  document.getElementById('session-user').textContent = d.username;
})();

// ── Tile click handlers ───────────────────────────────────────────────────────
// All logistics tiles are currently placeholders.
// Add live handler here when a function is implemented:
//
//   document.querySelectorAll('.sap-tile--live').forEach(tile => {
//     tile.addEventListener('click', () => {
//       if (tile.dataset.fn === 'purchaseOrders') runPurchaseOrders();
//     });
//   });

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
  a.href = url; a.download = `logistics-${new Date().toISOString().slice(0, 10)}.csv`;
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
