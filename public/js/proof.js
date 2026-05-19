const proofId = new URLSearchParams(location.search).get('id');
let proofData = null;

async function loadProof() {
  if (!proofId) { showError('Thiếu proof ID', ''); return; }
  try {
    proofData = await api(`/proofs/${proofId}`);
    renderProof(proofData);
  } catch (e) {
    showError('Không thể tải proof', e.message);
  }
}

function showError(title, msg) {
  el('proof-loading').style.display = 'none';
  el('proof-error').style.display = 'block';
  el('error-title').textContent = title;
  el('error-msg').textContent = msg;
}

function renderProof(p) {
  el('proof-loading').style.display = 'none';
  el('proof-content').style.display = 'block';

  document.title = p.title + ' — FileProof';
  el('proof-title').textContent = p.title;
  el('proof-meta').textContent = `Preserved ${formatDate(p.created_at)} · ${p.view_count} lượt xem`;
  el('btn-download').href = `/api/proofs/${p.id}/download`;

  if (p.category) {
    el('proof-category-badge').style.display = 'inline-flex';
    el('proof-category-badge').textContent = p.category;
  }

  const media = el('media-container');
  if (p.file_type?.startsWith('image/')) {
    media.innerHTML = `<img src="/api/proofs/${p.id}/download" style="max-width:100%;border-radius:var(--radius-lg);max-height:500px;object-fit:contain">`;
  } else if (p.file_type?.startsWith('video/')) {
    media.innerHTML = `<video controls style="width:100%;border-radius:var(--radius-lg);max-height:460px;background:#000">
      <source src="/api/proofs/${p.id}/download" type="${p.file_type}">
    </video>`;
  } else if (p.file_type?.startsWith('audio/')) {
    media.innerHTML = `<audio controls style="width:100%;margin-bottom:12px"><source src="/api/proofs/${p.id}/download"></audio>`;
  } else if (p.file_type === 'application/pdf') {
    media.innerHTML = `<iframe src="/api/proofs/${p.id}/download" style="width:100%;height:500px;border:1px solid var(--border);border-radius:var(--radius-lg)"></iframe>`;
  } else {
    media.innerHTML = `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:48px;margin-bottom:12px">${fileIcon(p.file_type)}</div>
      <div style="font-size:15px;font-weight:500;margin-bottom:6px">${p.file_name}</div>
      <div class="text-muted text-sm">Preview không khả dụng cho định dạng này.</div>
    </div>`;
  }

  el('d-filename').textContent = p.file_name;
  el('d-filetype').textContent = p.file_type;
  el('d-filesize').textContent = formatBytes(p.file_size);
  el('d-date').textContent = formatDate(p.created_at);
  el('d-submitter').textContent = p.submitter_type === 'anonymous' ? 'Anonymous' : (p.owner_name || 'Người dùng');
  el('d-visibility').textContent = p.visibility;
  el('d-views').textContent = p.view_count;
  el('d-hash').textContent = p.sha256_hash;

  if (p.description) {
    el('description-block').style.display = 'block';
    el('proof-desc').textContent = p.description;
  }
  if (p.location_text) {
    el('location-block').style.display = 'block';
    el('d-location').textContent = p.location_text;
  }
  if (p.tags?.length) {
    el('tags-block').style.display = 'block';
    el('tags-list').innerHTML = p.tags.map(t => `<span class="badge badge-gray">${t}</span>`).join('');
  }

  el('verify-upload').addEventListener('change', e => {
    if (e.target.files[0]) verifyLocalFile(e.target.files[0]);
  });
}

async function verifyServer() {
  const box = el('verify-result');
  box.innerHTML = `<div class="text-muted text-sm"><span class="spinner"></span> Đang tải file từ server và tính hash...</div>`;
  try {
    const resp = await fetch(`/api/proofs/${proofId}/download`);
    const blob = await resp.blob();
    const file = new File([blob], proofData.file_name, { type: proofData.file_type });
    const hash = await sha256File(file);
    showVerifyResult(hash, proofData.sha256_hash, 'server');
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">Lỗi khi tải file: ${e.message}</div>`;
  }
}

async function verifyLocalFile(file) {
  const box = el('verify-result');
  box.innerHTML = `<div class="text-muted text-sm"><span class="spinner"></span> Đang tính hash của "${file.name}"...</div>`;
  try {
    const hash = await sha256File(file);
    showVerifyResult(hash, proofData.sha256_hash, 'local', file.name);
  } catch (e) {
    box.innerHTML = `<div class="alert alert-error">Lỗi: ${e.message}</div>`;
  }
}

function showVerifyResult(hash, expected, source, filename) {
  const match = hash === expected;
  const box = el('verify-result');
  if (match) {
    box.innerHTML = `
      <div class="verify-result match">
        <div class="verify-result-icon">✓</div>
        <div class="verify-result-title" style="color:var(--accent)">Khớp! File đúng bản gốc.</div>
        <div class="verify-result-sub">${source === 'server' ? 'File trên server khớp với fingerprint đã lưu.' : `"${filename}" khớp với bản gốc đã preserved.`}</div>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="verify-result no-match">
        <div class="verify-result-icon" style="color:var(--red)">✕</div>
        <div class="verify-result-title" style="color:var(--red)">Không khớp.</div>
        <div class="verify-result-sub">${source === 'server' ? 'Cảnh báo: File trên server có thể đã bị thay đổi.' : `"${filename}" khác với bản gốc đã preserved. File có thể đã bị nén, cắt, hoặc chỉnh sửa.`}</div>
        <div class="hash-box mt-2" style="text-align:left">
          <div class="hash-label">Hash của file bạn upload</div>
          <div class="hash-value">${hash}</div>
        </div>
      </div>`;
  }
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = el('btn-copy-link');
    btn.innerHTML = `<i class="ti ti-check"></i> Đã copy`;
    setTimeout(() => { btn.innerHTML = `<i class="ti ti-copy"></i> Copy link`; }, 2000);
  });
}

function openReport() {
  el('report-modal').classList.add('open');
}

function closeReport() {
  el('report-modal').classList.remove('open');
}

async function submitReport() {
  const reason = el('report-reason').value;
  const details = el('report-details').value;
  try {
    await api(`/proofs/${proofId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason, details })
    });
    closeReport();
    el('report-block').innerHTML = `<div class="text-muted text-sm">Cảm ơn. Báo cáo của bạn đã được ghi nhận.</div>`;
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
}

loadProof();
