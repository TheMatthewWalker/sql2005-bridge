/**
 * js/admin.js
 * Kongsberg Portal — User Administration UI
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  'production','logistics','warehouse',
  'finance','sales','quality','engineering','management',
];

const DEPT_LABELS = {
  production:  'Production',  logistics:   'Logistics',
  warehouse:   'Warehouse',   finance:     'Finance',
  sales:       'Sales',       quality:     'Quality',
  engineering: 'Engineering', management:  'Management',
};

// ── State ─────────────────────────────────────────────────────────────────────
let editingUserID     = null;
let approvingUserID   = null;
let allUsers          = [];

// ── Initialise ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSession();
  await Promise.all([loadPending(), loadUsers()]);
  setupNav();
  setupSearch();
  setupSqlConsole();

  // Load audit when that section is first opened
  document.querySelector('[data-section="audit"]')
    .addEventListener('click', () => { if (allAuditLoaded === false) loadAudit(); }, { once: true });
});

// ── Session ───────────────────────────────────────────────────────────────────
async function loadSession() {
  try {
    const data = await api('/session-check');
    if (!data.loggedIn) { location.href = '/'; return; }
    document.getElementById('session-user').textContent = data.username;
    document.getElementById('session-role').textContent = data.role;
  } catch { location.href = '/'; }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('section-' + item.dataset.section).classList.add('active');
    });
  });
}

// ── Pending Approvals ─────────────────────────────────────────────────────────
async function loadPending() {
  const list = document.getElementById('pending-list');
  list.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Loading…</div>';

  try {
    const data = await api('/api/admin/pending');
    const badge = document.getElementById('pending-count');

    if (!data.users || data.users.length === 0) {
      badge.textContent = '0';
      badge.classList.add('zero');
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✓</div>
          No pending registration requests
        </div>`;
      return;
    }

    badge.textContent = data.users.length;
    badge.classList.remove('zero');

    list.innerHTML = data.users.map((u, i) => `
      <div class="pending-card" style="animation-delay:${i * 0.05}s">
        <div class="pending-avatar">${esc(u.Username.charAt(0).toUpperCase())}</div>
        <div class="pending-info">
          <div class="pending-name">${esc(u.Username)}</div>
          <div class="pending-email">${esc(u.Email)}</div>
          <div class="pending-meta">Registered ${formatDate(u.CreatedAt)}</div>
        </div>
        <div class="pending-actions">
          <button class="btn-primary" onclick="openApproveModal(${u.UserID}, '${esc(u.Username)}', '${esc(u.Email)}')">
            Review &amp; Approve
          </button>
        </div>
      </div>`).join('');

  } catch (err) {
    list.innerHTML = `<div class="empty-state">✕ ${esc(err.message)}</div>`;
  }
}

// ── All Users ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="loading-cell"><div class="spinner"></div> Loading…</td></tr>';

  try {
    const data = await api('/api/admin/users');
    allUsers = data.users || [];
    document.getElementById('users-count').textContent = allUsers.length;
    renderUsersTable(allUsers);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">✕ ${esc(err.message)}</td></tr>`;
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const statusBadge = u.IsLocked
      ? '<span class="badge badge--locked">Locked</span>'
      : u.IsActive
        ? '<span class="badge badge--active">Active</span>'
        : '<span class="badge badge--pending">Pending</span>';

    const deptTags = (u.departments || [])
      .map(d => `<span class="dept-tag">${esc(DEPT_LABELS[d] || d)}</span>`)
      .join('');

    return `
      <tr>
        <td><strong>${esc(u.Username)}</strong></td>
        <td>${esc(u.Email)}</td>
        <td><span class="badge badge--${u.Role}">${esc(u.Role)}</span></td>
        <td>${statusBadge}</td>
        <td>${u.LastLogin ? formatDate(u.LastLogin) : '<span style="color:var(--text-muted)">Never</span>'}</td>
        <td><div class="dept-tags">${deptTags || '<span style="color:var(--text-muted);font-size:11px">None</span>'}</div></td>
        <td style="text-align:center">
          <button class="btn-icon btn-icon--edit" title="Edit user"
            onclick="openEditModal(${u.UserID})">✎</button>
        </td>
      </tr>`;
  }).join('');
}

// ── Search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  document.getElementById('user-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u =>
      u.Username.toLowerCase().includes(q) ||
      u.Email.toLowerCase().includes(q)
    );
    renderUsersTable(filtered);
  });
}

// ── Edit User Modal ───────────────────────────────────────────────────────────
function openEditModal(userID) {
  const user = allUsers.find(u => u.UserID === userID);
  if (!user) return;

  editingUserID = userID;
  document.getElementById('edit-username').textContent = user.Username;
  document.getElementById('edit-role').value           = user.Role;
  document.getElementById('edit-active').checked       = !!user.IsActive;
  document.getElementById('edit-locked').checked       = !!user.IsLocked;
  document.getElementById('edit-notes').value          = user.Notes || '';

  updateToggleLabel('edit-active',  'edit-active-label',  'Active',  'Inactive');
  updateToggleLabel('edit-locked',  'edit-locked-label',  'Locked',  'Unlocked');

  document.getElementById('edit-active').addEventListener('change', () =>
    updateToggleLabel('edit-active', 'edit-active-label', 'Active', 'Inactive'));
  document.getElementById('edit-locked').addEventListener('change', () =>
    updateToggleLabel('edit-locked', 'edit-locked-label', 'Locked', 'Unlocked'));

  renderDeptGrid('edit-depts', user.departments || []);
  document.getElementById('edit-overlay').classList.add('open');
}

function closeEditModal() {
  editingUserID = null;
  document.getElementById('edit-overlay').classList.remove('open');
}

async function saveUser() {
  if (!editingUserID) return;

  const role        = document.getElementById('edit-role').value;
  const isActive    = document.getElementById('edit-active').checked ? 1 : 0;
  const isLocked    = document.getElementById('edit-locked').checked ? 1 : 0;
  const notes       = document.getElementById('edit-notes').value.trim();
  const departments = getCheckedDepts('edit-depts');

  try {
    await api('/api/admin/users/' + editingUserID, 'PUT', {
      role, isActive, isLocked, notes, departments,
    });
    closeEditModal();
    await loadUsers();
    showToast('User updated successfully', 'success');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
}

// ── Approve Modal ─────────────────────────────────────────────────────────────
function openApproveModal(userID, username, email) {
  approvingUserID = userID;
  document.getElementById('approve-info').innerHTML =
    `<strong>${esc(username)}</strong><br>${esc(email)}`;
  document.getElementById('approve-role').value = 'viewer';
  renderDeptGrid('approve-depts', []);
  document.getElementById('approve-overlay').classList.add('open');
}

function closeApproveModal() {
  approvingUserID = null;
  document.getElementById('approve-overlay').classList.remove('open');
}

async function approveUser() {
  if (!approvingUserID) return;

  const role        = document.getElementById('approve-role').value;
  const departments = getCheckedDepts('approve-depts');

  try {
    await api('/api/admin/users/' + approvingUserID + '/approve', 'POST', {
      role, departments,
    });
    closeApproveModal();
    await Promise.all([loadPending(), loadUsers()]);
    showToast('User approved and activated', 'success');
  } catch (err) {
    showToast('Approval failed: ' + err.message, 'error');
  }
}

async function rejectUser() {
  if (!approvingUserID) return;
  if (!confirm('Are you sure you want to reject and delete this registration request?')) return;

  try {
    await api('/api/admin/users/' + approvingUserID + '/reject', 'POST');
    closeApproveModal();
    await loadPending();
    showToast('Registration request rejected', 'error');
  } catch (err) {
    showToast('Rejection failed: ' + err.message, 'error');
  }
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
let allAuditLoaded = false;

async function loadAudit() {
  const tbody  = document.getElementById('audit-tbody');
  const filter = document.getElementById('audit-filter').value;
  tbody.innerHTML = '<tr><td colspan="5" class="loading-cell"><div class="spinner"></div> Loading…</td></tr>';

  try {
    const url  = '/api/admin/audit' + (filter ? '?event=' + encodeURIComponent(filter) : '');
    const data = await api(url);
    allAuditLoaded = true;

    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No audit records found</td></tr>';
      return;
    }

    tbody.innerHTML = data.rows.map(r => `
      <tr>
        <td>${formatDateTime(r.EventTime)}</td>
        <td>${r.Username ? esc(r.Username) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td><span class="event-badge event--${esc(r.EventType)}">${esc(r.EventType)}</span></td>
        <td>${r.Detail ? esc(r.Detail) : '—'}</td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-size:11px">${r.IPAddress ? esc(r.IPAddress) : '—'}</span></td>
      </tr>`).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">✕ ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById('audit-filter')?.addEventListener('change', () => {
  if (allAuditLoaded) loadAudit();
});

// ── Department Grid Helper ────────────────────────────────────────────────────
function renderDeptGrid(containerId, checked) {
  const el = document.getElementById(containerId);
  el.innerHTML = DEPARTMENTS.map(dept => `
    <label class="dept-check ${checked.includes(dept) ? 'checked' : ''}" data-dept="${dept}">
      <input type="checkbox" ${checked.includes(dept) ? 'checked' : ''}>
      <span class="dept-check-name">${DEPT_LABELS[dept]}</span>
      <span class="dept-check-tick">✓</span>
    </label>`).join('');

  el.querySelectorAll('.dept-check').forEach(label => {
    label.addEventListener('click', () => {
      const cb = label.querySelector('input');
      cb.checked = !cb.checked;
      label.classList.toggle('checked', cb.checked);
    });
  });
}

function getCheckedDepts(containerId) {
  return [...document.querySelectorAll(`#${containerId} .dept-check.checked`)]
    .map(el => el.dataset.dept);
}

// ── Toggle Label Helper ───────────────────────────────────────────────────────
function updateToggleLabel(checkboxId, labelId, trueText, falseText) {
  const checked = document.getElementById(checkboxId).checked;
  document.getElementById(labelId).textContent = checked ? trueText : falseText;
}

// ── API Helper ────────────────────────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok || data.success === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── Toast Notification ────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.style.cssText = `
    position: fixed; bottom: 28px; right: 28px; z-index: 9999;
    padding: 12px 20px; border-radius: 8px; font-family: 'Manrope', sans-serif;
    font-size: 13px; font-weight: 600; color: #fff;
    box-shadow: 0 4px 16px rgba(30,45,69,0.2);
    animation: fadeUp 0.25s ease;
    background: ${type === 'success' ? '#059669' : type === 'error' ? '#DC2626' : '#2563EB'};
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── SQL Console ───────────────────────────────────────────────────────────────
let sqlLastRows = [];

function buildSqlTable(rows) {
  const cols = Object.keys(rows[0]);
  let h = '<div class="table-wrap"><table><thead><tr>';
  cols.forEach(c => { h += `<th>${esc(c)}</th>`; });
  h += '</tr></thead><tbody>';
  rows.forEach(row => {
    h += '<tr>';
    cols.forEach(c => { h += `<td>${esc(String(row[c] ?? ''))}</td>`; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function exportSqlCsv() {
  if (!sqlLastRows.length) return;
  const cols  = Object.keys(sqlLastRows[0]);
  const lines = [
    cols.map(c  => `"${String(c).replace(/"/g, '""')}"`).join(','),
    ...sqlLastRows.map(row =>
      cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `sql-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function runSql() {
  const inputEl   = document.getElementById('sql-input');
  const resultEl  = document.getElementById('sql-result');
  const countEl   = document.getElementById('sql-row-count');
  const exportBtn = document.getElementById('sql-export');
  if (!inputEl || !resultEl) return;

  const query = inputEl.value.trim();
  if (!query) return;

  sqlLastRows = [];
  if (countEl)   { countEl.textContent = ''; countEl.style.display = 'none'; }
  if (exportBtn) exportBtn.style.display = 'none';
  resultEl.innerHTML = '<div class="loading-wrap"><div class="spinner"></div>Running…</div>';

  try {
    const res  = await fetch('/query', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      resultEl.innerHTML = `<div class="empty-state error-state">✕ ${esc((data && data.error) || `HTTP ${res.status}`)}</div>`;
      return;
    }

    const rows = data.recordset || [];
    if (rows.length) {
      sqlLastRows = rows;
      resultEl.innerHTML = buildSqlTable(rows);
      if (countEl)   { countEl.textContent = `${rows.length} row(s)`; countEl.style.display = ''; }
      if (exportBtn) exportBtn.style.display = '';
    } else {
      const affected = Array.isArray(data.rowsAffected)
        ? data.rowsAffected.reduce((s, v) => s + (v || 0), 0)
        : (data.rowsAffected || 0);
      resultEl.innerHTML = `<div class="empty-state">Query OK — ${affected} row(s) affected.</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="empty-state error-state">✕ ${esc(err.message)}</div>`;
  }
}

function setupSqlConsole() {
  const inputEl   = document.getElementById('sql-input');
  const runBtn    = document.getElementById('sql-run');
  const clearBtn  = document.getElementById('sql-clear');
  const exportBtn = document.getElementById('sql-export');

  if (inputEl) {
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); }
    });
  }
  if (runBtn)    runBtn.addEventListener('click', runSql);
  if (exportBtn) exportBtn.addEventListener('click', exportSqlCsv);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (inputEl) inputEl.value = '';
      sqlLastRows = [];
      const resultEl  = document.getElementById('sql-result');
      const countEl   = document.getElementById('sql-row-count');
      const exportBtn = document.getElementById('sql-export');
      if (resultEl)  resultEl.innerHTML = '<div class="empty-state">No query executed yet.</div>';
      if (countEl)   countEl.style.display = 'none';
      if (exportBtn) exportBtn.style.display = 'none';
    });
  }
}
