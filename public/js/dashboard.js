// ─── FileProof Dashboard ───────────────────────────────────────────────────

let activeTab = 'proofs';

function setTab(tab) {
  activeTab = tab;
  ['proofs','collections'].forEach(t => {
    const btn = el('tab-' + t);
    const panel = el('panel-' + t);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.borderBottomColor = t === tab ? 'var(--accent)' : 'transparent';
      btn.style.color = t === tab ? 'var(--ink)' : 'var(--muted)';
    }
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'proofs') loadMyProofs();
  if (tab === 'collections') loadMyCollections();
}

async function loadMyProofs() {
  const c = el('my-proofs-list');
  if (!c) return;
  c.innerHTML = '<div class="text-muted text-sm">Đang tải…</div>';
  try {
    const proofs = await api('/proofs/user/mine');
    // Update stats
    const totalViews = proofs.reduce((s, p) => s + (p.view_count || 0), 0);
    const totalUseful = proofs.reduce((s, p) => s + (p.useful_count || 0), 0);
    if (el('stat-total')) el('stat-total').textContent = proofs.length;
    if (el('stat-views')) el('stat-views').textContent = totalViews;
    if (el('stat-useful')) el('stat-useful').textContent = totalUseful;

    if (!proofs.length) {
      c.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Bạn chưa tạo proof nào.</p><a href="/create.html" class="btn btn-primary btn-sm">Tạo proof đầu tiên</a></div>`;
      return;
    }
    c.innerHTML = proofs.map(p => {
      const tags = Array.isArray(p.tags) ? p.tags : JSON.parse(p.tags || '[]');
      return `
        <div class="proof-row" style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div class="file-icon-cell">${fileIcon(p.file_type)}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
              <a href="/proof.html?id=${p.id}" style="font-weight:500;color:var(--ink);font-size:14px">${escapeHtml(p.title)}</a>
              <span class="badge ${p.status === 'active' ? 'badge-green' : 'badge-gray'}" style="font-size:10px">${p.status}</span>
              ${p.community_status && p.community_status !== 'normal' ? `<span class="badge badge-amber" style="font-size:10px">${p.community_status.replace(/_/g,' ')}</span>` : ''}
            </div>
            <div class="text-muted text-sm">
              ${formatBytes(p.file_size)} · ${capitalize(p.visibility)} · ${formatDate(p.created_at)}
            </div>
            <div class="text-xs text-muted mt-1">
              ${p.view_count || 0} lượt xem · ${p.useful_count || 0} hữu ích · ${p.comment_count || 0} bình luận
            </div>
            ${tags.length ? `<div class="mt-1">${tags.map(t => `<span class="tag" style="font-size:10px">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
          </div>
          <div class="proof-row-actions" style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
            <a href="/proof.html?id=${p.id}" class="btn btn-secondary btn-xs">Xem</a>
            <button class="btn btn-secondary btn-xs" onclick="copyLink('${p.id}')">Link</button>
            <button class="btn btn-danger btn-xs" onclick="removeProof('${p.id}')">Xóa</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    c.innerHTML = `<div class="alert alert-error"><span>✕</span><span>${escapeHtml(e.message)}</span></div>`;
  }
}

async function loadMyCollections() {
  const c = el('my-collections-list');
  if (!c) return;
  c.innerHTML = '<div class="text-muted text-sm">Đang tải…</div>';
  try {
    const cols = await api('/collections/user/mine');
    if (!cols.length) {
      c.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📁</div><p>Chưa có collection nào.</p><a href="/collection.html" class="btn btn-secondary btn-sm">Tạo collection</a></div>`;
      return;
    }
    c.innerHTML = cols.map(col => `
      <div class="proof-row" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="file-icon-cell" style="font-size:22px">📁</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:14px">${escapeHtml(col.name)}</div>
          <div class="text-muted text-sm">${col.proof_count || 0} proofs · ${capitalize(col.visibility)} · ${formatDate(col.updated_at)}</div>
          ${col.description ? `<div class="text-xs text-muted mt-1">${escapeHtml(col.description.slice(0,80))}${col.description.length > 80 ? '…' : ''}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <a href="/collection.html?id=${col.id}" class="btn btn-secondary btn-xs">Xem</a>
          <button class="btn btn-secondary btn-xs" onclick="copyCollectionLink('${col.id}')">Link</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    c.innerHTML = `<div class="alert alert-error"><span>✕</span><span>${escapeHtml(e.message)}</span></div>`;
  }
}

async function removeProof(id) {
  if (!confirm('Xóa proof này khỏi FileProof? File gốc vẫn được lưu trong storage.')) return;
  try {
    await api(`/proofs/${id}/remove-from-app`, { method: 'DELETE' });
    toast('Đã xóa proof');
    loadMyProofs();
  } catch (e) { toast(e.message, 'error'); }
}

function copyLink(id) {
  const url = `${location.origin}/proof.html?id=${id}`;
  navigator.clipboard.writeText(url).then(() => toast('Đã sao chép link!'));
}

function copyCollectionLink(id) {
  const url = `${location.origin}/collection.html?id=${id}`;
  navigator.clipboard.writeText(url).then(() => toast('Đã sao chép link!'));
}

document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (!user) { location.href = '/login.html?next=/dashboard.html'; return; }
  if (el('user-name')) el('user-name').textContent = user.display_name || user.email;
  setTab('proofs');
});
