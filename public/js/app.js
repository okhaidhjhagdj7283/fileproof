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

function apiForm(path, formData) {
  const token = localStorage.getItem('fp_token');
  return fetch(API + path, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
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
  return new Date(d).toLocaleDateString('vi-VN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s/60) + ' phút trước';
  if (s < 86400) return Math.floor(s/3600) + ' giờ trước';
  return Math.floor(s/86400) + ' ngày trước';
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

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const buf = e.target.result;
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function renderNav() {
  const user = getUser();
  const nav = document.getElementById('nav-user');
  if (!nav) return;
  if (user) {
    nav.innerHTML = `
      <a href="/dashboard.html" style="font-size:14px;color:var(--muted)">${user.display_name || user.email}</a>
      <button class="btn btn-secondary btn-sm" onclick="logout()">Đăng xuất</button>
    `;
  } else {
    nav.innerHTML = `
      <a href="/login.html" class="btn btn-secondary btn-sm">Đăng nhập</a>
      <a href="/login.html?tab=register" class="btn btn-primary btn-sm">Đăng ký</a>
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
  container.innerHTML = `<div class="alert alert-${type}"><span>${icons[type]}</span><span>${msg}</span></div>`;
}

document.addEventListener('DOMContentLoaded', renderNav);
