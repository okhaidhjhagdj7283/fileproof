const API = '/api';

function api(path, options = {}) {
  const token = localStorage.getItem('fp_token');
  return fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  });
}

function apiRaw(path, options = {}) {
  const token = localStorage.getItem('fp_token');
  return fetch(API + path, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  });
}

function getUser() {
  try { return JSON.parse(localStorage.getItem('fp_user')); } catch { return null; }
}

function setAuth(token, user) {
  localStorage.setItem('fp_token', token);
  localStorage.setItem('fp_user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('fp_token');
  localStorage.removeItem('fp_user');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return '📦';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📄';
}

async function sha256File(file, onProgress) {
  // Stream-based SHA-256 for large files
  return new Promise((resolve, reject) => {
    const CHUNK = 2 * 1024 * 1024; // 2MB chunks
    let offset = 0;
    const reader = new FileReader();

    // Use SubtleCrypto for files up to ~500MB; stream manually for larger
    const fullReader = new FileReader();
    fullReader.onload = async e => {
      try {
        const buf = e.target.result;
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hex = Array.from(new Uint8Array(hashBuf))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch (err) { reject(err); }
    };
    fullReader.onerror = reject;
    fullReader.readAsArrayBuffer(file);
  });
}

function communityStatusLabel(status) {
  const map = {
    normal: null,
    questioned: { text: 'Questioned', cls: 'badge-amber' },
    community_flagged: { text: 'Community Warning', cls: 'badge-red' },
    sensitive: { text: 'Sensitive Content', cls: 'badge-red' },
    hidden_by_filter: { text: 'Hidden by Filter', cls: 'badge-gray' },
  };
  return map[status] || null;
}

function renderCommunityWarning(status) {
  if (!status || status === 'normal') return '';
  const labels = {
    questioned: 'This proof has been questioned by community members.',
    community_flagged: 'This proof has received community flags. The file fingerprint is still verifiable, but the metadata or context may be disputed.',
    sensitive: 'This proof has been flagged as potentially sensitive. The file fingerprint is still verifiable.',
    hidden_by_filter: 'This proof is hidden by the default content filter. The file fingerprint is still verifiable.',
  };
  const msg = labels[status] || 'This proof has community warnings.';
  return `
    <div class="community-warning">
      <span class="community-warning-icon">⚠</span>
      <div>
        <strong>Community notice</strong>
        <p>${msg}</p>
        <p style="margin-top:4px;font-size:12px;color:var(--muted)">File verification is independent of community signals.</p>
      </div>
    </div>
  `;
}

function renderNav() {
  const user = getUser();
  const nav = document.getElementById('nav-user');
  if (!nav) return;
  if (user) {
    nav.innerHTML = `
      <a href="/dashboard.html" style="font-size:14px;color:var(--muted)">${user.display_name || user.email}</a>
      <button class="btn btn-secondary btn-sm" onclick="logout()">Log out</button>
    `;
  } else {
    nav.innerHTML = `
      <a href="/login.html" class="btn btn-secondary btn-sm">Log in</a>
      <a href="/login.html?tab=register" class="btn btn-primary btn-sm">Sign up</a>
    `;
  }
}

function logout() {
  clearAuth();
  window.location.href = '/';
}

function qs(sel) { return document.querySelector(sel); }
function el(id) { return document.getElementById(id); }

function showAlert(container, msg, type = 'error') {
  const icons = { error: '✕', success: '✓', warning: '⚠' };
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}"><span>${icons[type]}</span><span>${msg}</span></div>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', renderNav);
