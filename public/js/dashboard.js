const user = getUser();
if (!user) { window.location.href = '/login.html?next=/dashboard.html'; }

function showTab(t) {
  ['proofs','collections','settings'].forEach(name => {
    el(`tab-${name}`).style.display = name === t ? 'block' : 'none';
    const link = el(`snl-${name}`);
    if (name === t) {
      link.style.color = 'var(--ink)';
      link.style.borderRight = '2px solid var(--accent)';
    } else {
      link.style.color = 'var(--muted)';
      link.style.borderRight = 'none';
    }
  });
  if (t === 'proofs') loadProofs();
  if (t === 'collections') loadCollections();
  if (t === 'settings') loadSettings();
}

async function loadProofs() {
  const box = el('proofs-list');
  try {
    const proofs = await api('/proofs/user/mine');
    if (!proofs.length) {
      box.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Chưa có proof nào. <a href="/create.html" style="color:var(--accent)">Tạo proof đầu tiên →</a></div>`;
      return;
    }
    box.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:400">Tiêu đề</th>
            <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:400">Loại</th>
            <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:400">Kích thước</th>
            <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:400">Visibility</th>
            <th style="text-align:left;padding:8px 12px;color:var(--muted);font-weight:400">Ngày tạo</th>
            <th style="padding:8px 12px"></th>
          </tr>
        </thead>
        <tbody>
          ${proofs.map(p => `
            <tr style="border-bottom:0.5px solid var(--border)" onmouseenter="this.style.background='var(--surface)'" onmouseleave="this.style.background=''">
              <td style="padding:10px 12px">
                <span style="font-size:16px;margin-right:8px">${fileIcon(p.file_type)}</span>
                <a href="/proof.html?id=${p.id}" style="color:var(--ink)">${p.title}</a>
              </td>
              <td style="padding:10px 12px;color:var(--muted)">${p.file_type?.split('/')[1]||'—'}</td>
              <td style="padding:10px 12px;color:var(--muted)">${formatBytes(p.file_size)}</td>
              <td style="padding:10px 12px"><span class="badge ${p.visibility==='public'?'badge-green':p.visibility==='unlisted'?'badge-amber':'badge-gray'}">${p.visibility}</span></td>
              <td style="padding:10px 12px;color:var(--muted)">${formatDate(p.created_at)}</td>
              <td style="padding:10px 12px">
                <div style="display:flex;gap:6px">
                  <a href="/proof.html?id=${p.id}" class="btn btn-secondary btn-sm"><i class="ti ti-eye"></i></a>
                  <button class="btn btn-secondary btn-sm" onclick="copyProofLink('${p.id}')"><i class="ti ti-copy"></i></button>
                  <button class="btn btn-danger btn-sm" onclick="deleteProof('${p.id}',this)"><i class="ti ti-trash"></i></button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function deleteProof(id, btn) {
  if (!confirm('Xoá proof này khỏi FileProof?')) return;
  btn.disabled = true;
  try {
    await api(`/proofs/${id}`, { method: 'DELETE' });
    loadProofs();
  } catch (e) { alert(e.message); btn.disabled = false; }
}

function copyProofLink(id) {
  navigator.clipboard.writeText(`${location.origin}/proof.html?id=${id}`);
}

async function loadCollections() {
  const box = el('collections-list');
  try {
    const cols = await api('/collections/user/mine');
    if (!cols.length) {
      box.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Chưa có collection nào.</div>`;
      return;
    }
    box.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
      ${cols.map(c => `
        <div class="card" style="cursor:pointer" onclick="location.href='/collection.html?id=${c.id}'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <h3 style="font-size:14px;font-weight:500;line-height:1.35">${c.name}</h3>
            <span class="badge ${c.visibility==='public'?'badge-green':'badge-gray'}">${c.visibility}</span>
          </div>
          <div class="text-muted text-sm mb-2">${c.description||'Không có mô tả'}</div>
          <div class="text-xs text-muted">${c.proof_count} proofs · ${formatDate(c.created_at)}</div>
        </div>`).join('')}
    </div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
  }
}

async function loadSettings() {
  try {
    const u = await api('/users/me');
    el('s-name').value = u.display_name || '';
    el('s-email').value = u.email || '';
  } catch {}
}

async function saveSettings() {
  try {
    await api('/users/me', { method: 'PATCH', body: JSON.stringify({ display_name: el('s-name').value }) });
    showAlert(el('settings-alert'), 'Đã lưu.', 'success');
  } catch (e) {
    showAlert(el('settings-alert'), e.message);
  }
}

function openNewCollection() { el('new-collection-modal').classList.add('open'); }
function closeNewCollection() { el('new-collection-modal').classList.remove('open'); }

async function createCollection() {
  const name = el('nc-name').value.trim();
  if (!name) return showAlert(el('nc-alert'), 'Vui lòng nhập tên collection.');
  try {
    await api('/collections', {
      method: 'POST',
      body: JSON.stringify({ name, description: el('nc-desc').value, visibility: el('nc-visibility').value })
    });
    closeNewCollection();
    showTab('collections');
  } catch (e) {
    showAlert(el('nc-alert'), e.message);
  }
}

loadProofs();
