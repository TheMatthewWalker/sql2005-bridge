'use strict';

let activeDT = null;
let currentResult = [];
let deliveryRows = [];
let selectedDeliveryIds = new Set();
let latestShipment = null;

const BUCKETS = [
  { key: 'priority', label: 'Priority', dot: 'priority', defaultOpen: true },
  { key: 'backlog', label: 'Backlog', dot: 'backlog', defaultOpen: true },
  { key: 'today', label: 'Today', dot: 'today', defaultOpen: true },
  { key: 'this-week', label: 'This Week', dot: 'week', defaultOpen: true },
  { key: 'this-month', label: 'This Month', dot: 'month', defaultOpen: false },
  { key: 'other', label: 'Everything Else', dot: 'other', defaultOpen: false },
];

(async () => {
  const d = await fetch('/session-check').then(r => r.json());
  if (!d.loggedIn) { window.location.href = '/'; return; }
  document.getElementById('session-user').textContent = d.username;
})();

document.querySelectorAll('.sap-tile--live').forEach(tile => {
  tile.addEventListener('click', () => {
    const fn = tile.dataset.fn;
    if (fn === 'openDeliveries') runOpenDeliveries();
  });
});

async function checkSession() {
  try {
    const d = await fetch('/session-check').then(r => r.json());
    if (!d.loggedIn) { alert('Your session has expired. Please log in again.'); window.location.href = '/'; return false; }
    return true;
  } catch {
    alert('Unable to verify your session. Please log in again.');
    window.location.href = '/';
    return false;
  }
}

function showResultPanel(title, hint) {
  if (activeDT) { try { activeDT.destroy(); } catch (_) {} activeDT = null; }
  document.getElementById('tile-section').classList.add('hidden');
  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-hint').textContent = hint;
  document.getElementById('result-row-badge').classList.add('hidden');
  document.getElementById('btn-export-csv').classList.add('hidden');
  document.getElementById('result-body').innerHTML = '<div class="sap-loading"><div class="spinner"></div>Loading deliveries...</div>';
}

function backToTiles() {
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('tile-section').classList.remove('hidden');
  document.getElementById('result-body').innerHTML = '';
  selectedDeliveryIds = new Set();
  deliveryRows = [];
  latestShipment = null;
}

function getDateBucket(dueDate) {
  if (!dueDate) return 'other';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (dueDay < today) return 'backlog';
  if (dueDay.getTime() === today.getTime()) return 'today';
  const dow = today.getDay() || 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  if (dueDay <= sunday) return 'this-week';
  if (due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth()) return 'this-month';
  return 'other';
}

async function runOpenDeliveries() {
  if (!await checkSession()) return;
  showResultPanel('Open Deliveries', 'Completed deliveries ready for shipment creation');
  try {
    const res = await fetch('/api/deliverymain/completed-unshipped');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load deliveries');
    deliveryRows = json.data || [];
    currentResult = deliveryRows;
    selectedDeliveryIds = new Set();
    const badge = document.getElementById('result-row-badge');
    badge.textContent = `${deliveryRows.length} ready`;
    badge.classList.remove('hidden');
    if (!deliveryRows.length) {
      document.getElementById('result-body').innerHTML = '<div class="sap-error">No completed deliveries are currently available for shipment creation.</div>';
      return;
    }
    renderOpenDeliveries();
  } catch (err) {
    document.getElementById('result-body').innerHTML = `<div class="sap-error">${esc(err.message)}</div>`;
  }
}

function renderOpenDeliveries() {
  const bucketMap = {}; BUCKETS.forEach(b => { bucketMap[b.key] = []; });
  deliveryRows.forEach(r => { const key = r.deliveryPriority === 1 ? 'priority' : getDateBucket(r.dueDate); bucketMap[key].push(r); });
  const sections = BUCKETS.filter(b => bucketMap[b.key].length).map(b => {
    const collapsed = b.defaultOpen ? '' : ' ps-section--collapsed';
    const rows = bucketMap[b.key].map(r => {
      const due = r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-GB') : '—';
      const completed = r.completionDate ? new Date(r.completionDate).toLocaleDateString('en-GB') : '—';
      const flag = b.key === 'priority' ? '<span class="ps-priority-flag"></span>' : '';
      return `<tr class="ps-row lg-row" data-id="${esc(String(r.deliveryID))}" data-customer="${esc(String(r.customerID))}"><td class="lg-check-cell"><input type="checkbox" class="lg-check" data-id="${esc(String(r.deliveryID))}"></td><td>${flag}${esc(String(r.deliveryID))}</td><td>${esc(r.destinationName || '—')}</td><td>${esc(completed)}</td><td>${esc(due)}</td><td>${esc(r.deliveryService || '')}</td><td>${esc(String(r.palletCount ?? 0))}</td><td>${esc(String(r.grossWeight ?? 0))}</td><td>${esc(String(r.deliveryVolume ?? 0))}</td></tr>`;
    }).join('');
    return `<div class="ps-section${collapsed}"><div class="ps-section-header"><span class="ps-section-dot ps-section-dot--${b.dot}"></span><span class="ps-section-title">${b.label}</span><span class="ps-section-count">${bucketMap[b.key].length}</span><span class="ps-chevron">v</span></div><div class="ps-section-body"><table class="ps-table"><thead><tr><th></th><th>Delivery</th><th>Destination</th><th>Completed</th><th>Due</th><th>Service</th><th>Pallets</th><th>Weight</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  document.getElementById('result-body').innerHTML = `<div class="lg-actions"><div><div class="lg-selection-title">Completed picksheets</div><div class="toolbar-hint" id="lg-selection-hint">Select deliveries for one customer, then create a shipment.</div></div><div class="toolbar-spacer"></div><button type="button" class="btn-secondary" id="lg-clear-btn" disabled>Clear Selection</button><button type="button" class="btn-submit" id="lg-create-btn" disabled>Create Shipment</button></div><div id="lg-selection-msg" class="lg-selection-msg hidden"></div><div class="ps-sections">${sections}</div>`;
  bindOpenDeliveriesEvents();
  updateSelectionUI();
}

function bindOpenDeliveriesEvents() {
  document.querySelectorAll('.ps-section-header').forEach(h => h.addEventListener('click', () => h.closest('.ps-section').classList.toggle('ps-section--collapsed')));
  document.querySelectorAll('.lg-check').forEach(input => input.addEventListener('change', onDeliveryToggle));
  document.querySelectorAll('.lg-row').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('input')) return;
    showPickedPallets(row.dataset.id, row.children[2]?.textContent || '');
  }));
  document.getElementById('lg-clear-btn').addEventListener('click', () => {
    selectedDeliveryIds = new Set();
    document.querySelectorAll('.lg-check').forEach(input => { input.checked = false; });
    updateSelectionUI();
  });
  document.getElementById('lg-create-btn').addEventListener('click', openShipmentModal);
}
function onDeliveryToggle(e) {
  const id = Number(e.target.dataset.id);
  const row = deliveryRows.find(item => Number(item.deliveryID) === id);
  if (!row) return;
  const lockedCustomer = getSelectedCustomerId();
  if (e.target.checked && lockedCustomer && String(lockedCustomer) !== String(row.customerID)) {
    e.target.checked = false;
    showSelectionMessage('Only deliveries for the same customer can be added to one shipment.');
    return;
  }
  if (e.target.checked) selectedDeliveryIds.add(id); else selectedDeliveryIds.delete(id);
  updateSelectionUI();
}
function getSelectedRows() { return deliveryRows.filter(row => selectedDeliveryIds.has(Number(row.deliveryID))); }
function getSelectedCustomerId() { const first = getSelectedRows()[0]; return first ? first.customerID : null; }
function showSelectionMessage(message) {
  const el = document.getElementById('lg-selection-msg');
  if (!el) return;
  el.textContent = message; el.classList.remove('hidden');
}
function updateSelectionUI() {
  const rows = getSelectedRows(); const lockedCustomer = rows[0]?.customerID ?? null;
  const totals = rows.reduce((acc, row) => { acc.pallets += Number(row.palletCount || 0); acc.weight += Number(row.grossWeight || 0); acc.volume += Number(row.deliveryVolume || 0); return acc; }, { pallets: 0, weight: 0, volume: 0 });
  const hint = document.getElementById('lg-selection-hint');
  if (hint) hint.textContent = rows.length ? `${rows.length} selected · ${totals.pallets} pallets · ${totals.weight.toFixed(3)} weight · ${totals.volume.toFixed(3)} volume` : 'Select deliveries for one customer, then create a shipment.';
  const msg = document.getElementById('lg-selection-msg'); if (msg && !rows.length) msg.classList.add('hidden');
  document.querySelectorAll('.lg-row').forEach(row => {
    const differentCustomer = lockedCustomer && row.dataset.customer !== String(lockedCustomer) && !selectedDeliveryIds.has(Number(row.dataset.id));
    row.classList.toggle('lg-row--selected', selectedDeliveryIds.has(Number(row.dataset.id)));
    row.classList.toggle('lg-row--disabled', Boolean(differentCustomer));
    const checkbox = row.querySelector('.lg-check'); if (checkbox) checkbox.disabled = Boolean(differentCustomer);
  });
  const createBtn = document.getElementById('lg-create-btn'); if (createBtn) createBtn.disabled = rows.length === 0;
  const clearBtn = document.getElementById('lg-clear-btn'); if (clearBtn) clearBtn.disabled = rows.length === 0;
}
function buildShipmentDraft() {
  const rows = getSelectedRows();
  const first = rows[0];
  return rows.reduce((draft, row) => {
    draft.palletCount += Number(row.palletCount || 0);
    draft.grossWeight += Number(row.grossWeight || 0);
    draft.shipmentVolume += Number(row.deliveryVolume || 0);
    return draft;
  }, { destinationName: first.destinationName || '', destinationStreet: first.destinationStreet || '', destinationCity: first.destinationCity || '', destinationPostCode: first.destinationPostCode || '', destinationCountry: first.destinationCountry || '', incoTerms: first.defaultIncoterms || '', plannedCollection: new Date().toISOString().slice(0, 10), palletCount: 0, grossWeight: 0, shipmentVolume: 0 });
}
function openModal(html) {
  const overlay = document.getElementById('ps-modal-overlay');
  overlay.innerHTML = html; overlay.classList.remove('hidden');
}
function closePickModal() { const overlay = document.getElementById('ps-modal-overlay'); overlay.classList.add('hidden'); overlay.innerHTML = ''; }
async function openShipmentModal() {
  if (!await checkSession()) return;
  const rows = getSelectedRows(); if (!rows.length) return;
  const draft = buildShipmentDraft();
  openModal(`<div class="ps-modal lg-modal"><div class="ps-modal-header"><div><div class="ps-modal-title">Create Shipment</div><div class="ps-modal-sub">${esc(rows[0].destinationName || '')} · ${rows.length} deliveries</div></div><button class="ps-modal-close" onclick="closePickModal()">×</button></div><div class="ps-modal-body"><form id="lg-shipment-form" class="transfer-form"><div class="tf-section-label">Shipment Header</div><div class="tf-row"><div class="tf-field"><label class="tf-label">Planned Collection</label><input class="tf-input" type="date" id="lg-planned" value="${esc(draft.plannedCollection)}"></div><div class="tf-field"><label class="tf-label">Forwarder ID</label><input class="tf-input" type="number" id="lg-forwarder"></div><div class="tf-field"><label class="tf-label">Tracking Number</label><input class="tf-input" type="text" id="lg-tracking"></div><div class="tf-field"><label class="tf-label">Incoterms</label><input class="tf-input" type="text" id="lg-incoterms" value="${esc(draft.incoTerms)}"></div></div><div class="tf-row"><div class="tf-field tf-field--wide"><label class="tf-label">Destination Name</label><input class="tf-input" type="text" id="lg-dest-name" value="${esc(draft.destinationName)}"></div><div class="tf-field tf-field--wide"><label class="tf-label">Destination Street</label><input class="tf-input" type="text" id="lg-dest-street" value="${esc(draft.destinationStreet)}"></div></div><div class="tf-row"><div class="tf-field"><label class="tf-label">City</label><input class="tf-input" type="text" id="lg-dest-city" value="${esc(draft.destinationCity)}"></div><div class="tf-field"><label class="tf-label">Post Code</label><input class="tf-input" type="text" id="lg-dest-postcode" value="${esc(draft.destinationPostCode)}"></div><div class="tf-field"><label class="tf-label">Country</label><input class="tf-input" type="text" id="lg-dest-country" value="${esc(draft.destinationCountry)}"></div></div><div class="tf-row"><label class="lg-flag"><input type="checkbox" id="lg-customs-required"> Customs Required</label><label class="lg-flag"><input type="checkbox" id="lg-customs-complete"> Customs Complete</label></div><div class="tf-section-label">Calculated Totals <span class="tf-locked">Read only</span></div><div class="tf-row"><div class="tf-field"><label class="tf-label">Pallet Count</label><input class="tf-input" readonly value="${esc(draft.palletCount.toFixed(3))}"></div><div class="tf-field"><label class="tf-label">Gross Weight</label><input class="tf-input" readonly value="${esc(draft.grossWeight.toFixed(3))}"></div><div class="tf-field"><label class="tf-label">Volume</label><input class="tf-input" readonly value="${esc(draft.shipmentVolume.toFixed(3))}"></div></div><div id="lg-submit-result"></div></form></div><div class="ps-modal-actions"><button type="button" class="btn-secondary" onclick="closePickModal()">Cancel</button><button type="button" class="btn-submit" id="lg-confirm-btn">Confirm Shipment</button></div></div>`);
  document.getElementById('lg-confirm-btn').addEventListener('click', submitShipmentCreate);
}
async function submitShipmentCreate() {
  const button = document.getElementById('lg-confirm-btn');
  const result = document.getElementById('lg-submit-result');
  button.disabled = true; button.textContent = 'Creating...'; result.innerHTML = '';
  try {
    const payload = { deliveryIDs: [...selectedDeliveryIds], plannedCollection: document.getElementById('lg-planned').value || null, forwarderID: document.getElementById('lg-forwarder').value || null, trackingNumber: document.getElementById('lg-tracking').value.trim(), incoTerms: document.getElementById('lg-incoterms').value.trim(), destinationName: document.getElementById('lg-dest-name').value.trim(), destinationStreet: document.getElementById('lg-dest-street').value.trim(), destinationCity: document.getElementById('lg-dest-city').value.trim(), destinationPostCode: document.getElementById('lg-dest-postcode').value.trim(), destinationCountry: document.getElementById('lg-dest-country').value.trim(), customsRequired: document.getElementById('lg-customs-required').checked, customsComplete: document.getElementById('lg-customs-complete').checked };
    const res = await fetch('/api/shipmentmain/create-from-deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json(); if (!json.success) throw new Error(json.error || 'Failed to create shipment');
    latestShipment = json.data; closePickModal(); await runOpenDeliveries(); showPostCreateModal(json.data);
  } catch (err) {
    result.innerHTML = `<div class="sap-error tf-inline-error">${esc(err.message)}</div>`;
    button.disabled = false; button.textContent = 'Confirm Shipment';
  }
}
function showPostCreateModal(data) {
  openModal(`<div class="ps-modal lg-modal"><div class="ps-modal-header"><div><div class="ps-modal-title">Shipment ${esc(data.shipmentRef)}</div><div class="ps-modal-sub">Shipment created successfully</div></div><button class="ps-modal-close" onclick="closePickModal()">×</button></div><div class="ps-modal-body"><div class="lg-post-grid"><div class="lg-post-card"><div class="lg-post-title">Folder</div><div class="toolbar-hint" id="lg-folder-result">${esc(data.folderPath || '')}</div><button class="btn-secondary lg-post-btn" id="lg-folder-btn">Create Folder</button></div><div class="lg-post-card"><div class="lg-post-title">Packing List</div><div class="toolbar-hint" id="lg-doc-result">Generate shipment and delivery PDFs.</div><button class="btn-secondary lg-post-btn" id="lg-doc-btn">Create Packing List</button><div id="lg-doc-links" class="lg-doc-links"></div></div><div class="lg-post-card${data.canSendEmail ? '' : ' lg-post-card--muted'}"><div class="lg-post-title">Collection Email</div><div class="toolbar-hint" id="lg-email-result">${data.canSendEmail ? 'Send Ex Works collection email with attachments.' : 'Available only for Ex Works shipments.'}</div><button class="btn-secondary lg-post-btn" id="lg-email-btn" ${data.canSendEmail ? '' : 'disabled'}>Send Email</button></div></div></div><div class="ps-modal-actions"><button type="button" class="btn-submit" onclick="closePickModal()">Done</button></div></div>`);
  document.getElementById('lg-folder-btn').addEventListener('click', () => runShipmentAction('create-folder', 'lg-folder-result'));
  document.getElementById('lg-doc-btn').addEventListener('click', () => runShipmentAction('generate-packing-list', 'lg-doc-result', true));
  if (data.canSendEmail) document.getElementById('lg-email-btn').addEventListener('click', () => runShipmentAction('send-collection-email', 'lg-email-result'));
}
async function runShipmentAction(action, resultId, showLinks = false) {
  const result = document.getElementById(resultId); if (!latestShipment?.shipmentID) return;
  result.textContent = 'Working...';
  try {
    const res = await fetch(`/api/shipmentmain/${encodeURIComponent(latestShipment.shipmentID)}/${action}`, { method: 'POST' });
    const json = await res.json(); if (!json.success) throw new Error(json.error || 'Action failed');
    if (action === 'create-folder') result.textContent = json.data.folderPath;
    if (action === 'send-collection-email') result.textContent = `Sent to ${json.data.sentTo}`;
    if (showLinks) { result.textContent = json.data.folderPath; document.getElementById('lg-doc-links').innerHTML = (json.data.files || []).map(file => `<a class="lg-doc-link" target="_blank" href="${esc(file.downloadUrl)}">${esc(file.fileName)}</a>`).join(''); }
  } catch (err) { result.textContent = err.message; }
}
async function showPickedPallets(deliveryId, destName) {
  if (!await checkSession()) return;
  openModal(`<div class="ps-modal"><div class="ps-modal-header"><div><div class="ps-modal-title">Picked Pallets</div><div class="ps-modal-sub">Delivery #${esc(deliveryId)} · ${esc(destName)}</div></div><button class="ps-modal-close" onclick="closePickModal()">×</button></div><div class="ps-modal-body"><div class="sap-loading"><div class="spinner"></div>Fetching pallets...</div></div><div class="ps-modal-actions"><button class="btn-submit" onclick="closePickModal()">Close</button></div></div>`);
  try {
    const res = await fetch(`/api/deliverymain/${encodeURIComponent(deliveryId)}/pallets`); const json = await res.json(); if (!json.success) throw new Error(json.error || 'Failed to load pallets');
    const body = document.querySelector('#ps-modal-overlay .ps-modal-body'); const pallets = json.data || [];
    if (!pallets.length) { body.innerHTML = '<div class="sap-error" style="padding:24px">No pallets picked for this delivery yet.</div>'; return; }
    body.innerHTML = `<table class="ps-pallet-table"><thead><tr><th>Type</th><th>Finished</th><th>Length</th><th>Width</th><th>Height</th><th>Gross Wt.</th><th>Location</th></tr></thead><tbody>${pallets.map(p => `<tr><td>${esc(p.palletType || '')}</td><td>${p.palletFinish ? 'Yes' : 'No'}</td><td>${esc(String(p.palletLength || ''))}</td><td>${esc(String(p.palletWidth || ''))}</td><td>${esc(String(p.palletHeight || ''))}</td><td>${esc(String(p.grossWeight || ''))}</td><td>${esc(p.palletLocation || '')}</td></tr>`).join('')}</tbody></table>`;
  } catch (err) {
    document.querySelector('#ps-modal-overlay .ps-modal-body').innerHTML = `<div class="sap-error" style="padding:24px">${esc(err.message)}</div>`;
  }
}
function exportResultCSV() {
  if (!currentResult.length) return;
  const columns = Object.keys(currentResult[0]);
  const lines = [columns.join(','), ...currentResult.map(row => columns.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','))];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `logistics-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
}
function esc(str) { if (str == null) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

