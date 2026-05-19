// ─── FileProof Global App ─────────────────────────────────────────────────────

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const FP = {
  getToken: () => localStorage.getItem('fp_token'),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem('fp_user') || 'null'); } catch { return null; }
  },
  setAuth: (token, user) => {
    localStorage.setItem('fp_token', token);
    localStorage.setItem('fp_user', JSON.stringify(user));
  },
  clearAuth: () => {
    localStorage.removeItem('fp_token');
    localStorage.removeItem('fp_user');
  },
  isLoggedIn: () => !!localStorage.getItem('fp_token'),

  authHeaders: () => {
    const token = localStorage.getItem('fp_token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },

  formatBytes: (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  },

  formatDate: (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  shortHash: (hash) => hash ? hash.slice(0, 12) + '...' + hash.slice(-6) : '—',
};

// ─── Render nav user state ────────────────────────────────────────────────────

function renderNav() {
  const container = document.getElementById('nav-user');
  if (!container) return;

  const user = FP.getUser();
  if (user) {
    container.innerHTML = `
      <a href="/dashboard.html" class="btn btn-secondary btn-sm">${user.display_name || 'Dashboard'}</a>
      <button class="btn btn-ghost btn-sm" id="nav-logout">Sign out</button>
    `;
    document.getElementById('nav-logout')?.addEventListener('click', () => {
      FP.clearAuth();
      window.location.href = '/';
    });
  } else {
    container.innerHTML = `
      <a href="/login.html" class="btn btn-secondary btn-sm">Sign in</a>
      <a href="/login.html?mode=register" class="btn btn-primary btn-sm">Sign up</a>
    `;
  }
}

document.addEventListener('DOMContentLoaded', renderNav);
