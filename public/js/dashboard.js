let activeTab = 'proofs';

function setTab(tab) {
  activeTab = tab;
  ['proofs', 'collections'].forEach(t => {
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`panel-${t}`)?.style && (document.getElementById(`panel-${t}`).style.display = t === tab ? '' : 'none');
  });
  if (tab === 'proofs') loadMyProofs();
  if (tab === 'collections') loadMyCollections();
}

async function loadMyProofs() {
  const container = document.getElementById('my-proofs-list');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted)">Loading…</div>';
  try {
    const proofs = await api('/proofs/user/mine');
    if (!proofs.length) {
      container.innerHTML = '<p style="color:var(--muted)">You haven\'t created any proofs yet. <a href="/create.html">Create your first proof →</a></p>';
      return;
    }
    container.innerHTML = proofs.map(p => {
      const tags = Array.isArray(p.tags) ? p.tags : JSON.parse(p.tags || '[]');
      const statusCls = p.status === 'active' ? 'badge-green' : 'badge-gray';
      const commCls = p.community_status !== 'normal' ? 'badge-amber' : '';
      return `
        <div class="proof-row card card-sm" style="margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="font-size:22px;flex-shrink:0">${fileIcon(p.file_type)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <a href="/proof.html?id=${p.id}" style="font-weight:500;color:var(--ink)">${escapeHtml(p.title)}</a>
              <span class="badge ${statusCls}">${p.status}</span>
              ${p.community_status !== 'normal' ? `<span class="badge badge-amber">${p.community_status.replace(/_/g,' ')}</span>` : ''}
            </div>
            <div style="font-size:13px;color:var(--muted);margin-top:3px;">
              ${formatBytes(p.file_size)} · ${capitalize(p.visibility)} · ${formatDate(p.created_at)}
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px;">
              ${p.view_count} views · ${p.useful_count || 0} useful · ${p.question_count || 0} questioned · ${p.comment_count || 0} comments
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">
            <a href="/proof.html?id=${p.id}" class="btn btn-secondary btn-sm">View</a>
            <button class="btn btn-secondary btn-sm" onclick="copyLink('${p.id}')">Copy link</button>
            <button class="btn btn-danger btn-sm" onclick="removeProof('${p.id}')">Remove</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error"><span>✕</span><span>${e.message}</span></div>`;
  }
}

async function loadMyCollections() {
  const container = document.getElementById('my-collections-list');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted)">Loading…</div>';
  try {
    const cols = await api('/collections/user/mine');
    if (!cols.length) {
      container.innerHTML = '<p style="color:var(--muted)">No collections yet. <a href="/collection.html">Create a collection →</a></p>';
      return;
    }
    container.innerHTML = cols.map(c => `
      <div class="card card-sm" style="margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;">${escapeHtml(c.name)}</div>
          <div style="font-size:13px;color:var(--muted)">${c.proof_count} proofs · ${capitalize(c.visibility)} · Updated ${formatDate(c.updated_at)}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <a href="/collection.html?id=${c.id}" class="btn btn-secondary btn-sm">View</a>
        </div>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error"><span>✕</span><span>${e.message}</span></div>`;
  }
}

async function removeProof(id) {
  if (!confirm('Remove this proof from FileProof? The original file will remain in storage.')) return;
  try {
    await api(`/proofs/${id}/remove-from-app`, { method: 'DELETE' });
    loadMyProofs();
  } catch (e) { alert(e.message); }
}

function copyLink(id) {
  const url = `${location.origin}/proof.html?id=${id}`;
  navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (!user) return (location.href = '/login.html');
  document.getElementById('user-name').textContent = user.display_name || user.email;
  setTab('proofs');
});
