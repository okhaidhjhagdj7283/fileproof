// ─── FileProof Global Helpers ──────────────────────────────────────────────

// ── Auth ───────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('fp_token'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('fp_user') || 'null'); } catch { return null; }
}
function setAuth(token, user) {
  localStorage.setItem('fp_token', token);
  localStorage.setItem('fp_user', JSON.stringify(user));
}
function clearAuth() {
  localStorage.removeItem('fp_token');
  localStorage.removeItem('fp_user');
}
function isLoggedIn() { return !!getToken(); }

function authHeaders(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

// ── API helper ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── DOM helper ─────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Formatters ─────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateLong(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
  if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
  if (diff < 604800) return Math.floor(diff / 86400) + ' ngày trước';
  return formatDate(iso);
}

function shortHash(h) {
  return h ? h.slice(0, 10) + '…' + h.slice(-6) : '—';
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('zip') || mime.includes('gzip')) return '🗜️';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.startsWith('text/')) return '📃';
  return '📄';
}

// ── Alert helper ───────────────────────────────────────────────────────────
function showAlert(container, msg, type = 'error') {
  if (!container) return;
  const icons = { error: '✕', success: '✓', warning: '⚠' };
  container.innerHTML = `<div class="alert alert-${type}"><span class="alert-icon">${icons[type] || '•'}</span><span>${escapeHtml(msg)}</span></div>`;
}
function clearAlert(container) { if (container) container.innerHTML = ''; }

// ── Toast notifications ────────────────────────────────────────────────────
function toast(msg, type = 'success', duration = 2800) {
  const existing = document.querySelector('.fp-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'fp-toast fp-toast--' + type;
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:${type === 'error' ? 'var(--red)' : type === 'warning' ? 'var(--amber)' : 'var(--accent)'};
    color:#fff; padding:10px 18px; border-radius:var(--radius); font-size:14px;
    box-shadow:0 4px 16px rgba(0,0,0,.2); animation: toastIn .2s ease;
    max-width: calc(100vw - 48px);
  `;
  const style = document.createElement('style');
  style.textContent = '@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}';
  document.head.appendChild(style);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Nav rendering ──────────────────────────────────────────────────────────
function renderNav() {
  const container = el('nav-user');
  if (!container) return;

  const user = getUser();
  if (user) {
    container.innerHTML = `
      <a href="/dashboard.html" class="btn btn-secondary btn-sm" style="display:none" id="nav-dash-btn">${escapeHtml(user.display_name || 'Dashboard')}</a>
      <button class="btn btn-ghost btn-sm" id="nav-logout-btn" style="display:none">Đăng xuất</button>
    `;
    // show on desktop
    const dashBtn = el('nav-dash-btn');
    const logoutBtn = el('nav-logout-btn');
    if (dashBtn) dashBtn.style.display = '';
    if (logoutBtn) {
      logoutBtn.style.display = '';
      logoutBtn.addEventListener('click', () => {
        clearAuth();
        window.location.href = '/';
      });
    }
  } else {
    container.innerHTML = `
      <a href="/login.html" class="btn btn-secondary btn-sm">Đăng nhập</a>
      <a href="/login.html?tab=register" class="btn btn-primary btn-sm">Đăng ký</a>
    `;
  }

  // Mobile drawer
  setupMobileDrawer();
}

function setupMobileDrawer() {
  const menuBtn = el('nav-menu-btn');
  if (!menuBtn) return;

  let drawer = el('mobile-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'mobile-drawer';
    drawer.className = 'mobile-drawer';
    const user = getUser();
    const links = [
      { href: '/', label: '🏠 Trang chủ' },
      { href: '/explore.html', label: '🔍 Explore' },
      { href: '/verify.html', label: '✓ Verify' },
      { href: '/create.html', label: '＋ Tạo Proof' },
      user ? { href: '/dashboard.html', label: '👤 Dashboard' } : { href: '/login.html', label: '🔑 Đăng nhập' },
    ];
    drawer.innerHTML = `
      <div class="mobile-drawer-bg"></div>
      <div class="mobile-drawer-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)">
          <span style="font-weight:600">Menu</span>
          <button id="drawer-close" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--muted)">×</button>
        </div>
        ${links.map(l => `<a href="${l.href}" class="mobile-drawer-link">${l.label}</a>`).join('')}
        ${user ? `<button class="mobile-drawer-link" style="cursor:pointer;background:none;border:none;text-align:left;color:var(--red)" id="drawer-logout">🚪 Đăng xuất</button>` : ''}
      </div>
    `;
    document.body.appendChild(drawer);

    drawer.querySelector('.mobile-drawer-bg')?.addEventListener('click', closeDrawer);
    el('drawer-close')?.addEventListener('click', closeDrawer);
    el('drawer-logout')?.addEventListener('click', () => { clearAuth(); window.location.href = '/'; });
  }

  menuBtn.addEventListener('click', () => {
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

function closeDrawer() {
  const d = el('mobile-drawer');
  if (d) d.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', renderNav);
