// ─── FileProof Verify Page ─────────────────────────────────────────────────

let resolvedProof = null;
let selectedVerifyFile = null;

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function showResolveResult(type, html) {
  const box = el('resolve-result');
  if (!box) return;
  box.className = type === 'error' ? 'alert alert-error mt-1' : type === 'info' ? 'alert alert-warning mt-1' : '';
  box.innerHTML = html;
  box.style.display = html ? 'block' : 'none';
}

function showCompareResult(type, html) {
  const box = el('compare-result');
  if (!box) return;
  box.innerHTML = `<div class="verify-result ${type === 'success' ? 'verify-success' : type === 'fail' ? 'verify-fail' : ''}">
    <span class="verify-result-icon">${type === 'success' ? '✓' : type === 'fail' ? '✗' : '⏳'}</span>
    <div>${html}</div>
  </div>`;
  box.style.display = 'block';
}

async function resolveProof() {
  const input = el('proof-input')?.value?.trim();
  if (!input) { showResolveResult('error', 'Vui lòng nhập proof link hoặc ID.'); return; }

  const btn = el('resolve-btn');
  btn.disabled = true;
  btn.textContent = 'Đang tìm…';
  showResolveResult('', '');

  try {
    const data = await api('/verify/resolve-proof', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    resolvedProof = data;

    // Show proof card
    const card = el('proof-card');
    card.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="font-weight:500;margin-bottom:3px;word-break:break-word">${escapeHtml(data.title)}</div>
            <div class="text-muted text-sm">${escapeHtml(data.file_name)} · ${formatBytes(data.file_size)}</div>
            ${data.category ? `<span class="badge badge-gray mt-1" style="font-size:10px">${escapeHtml(data.category)}</span>` : ''}
          </div>
          <a href="/proof.html?id=${data.id}" class="btn btn-secondary btn-sm" target="_blank" style="flex-shrink:0">Xem proof</a>
        </div>
        <div class="hash-box">
          <div class="hash-label">SHA-256 fingerprint đã lưu</div>
          <div class="hash-value">${data.sha256_hash}</div>
        </div>
      </div>
    `;
    card.style.display = 'block';

    el('compare-section').style.display = 'block';
    showResolveResult('', `<div class="alert alert-success"><span>✓</span><span>Tìm thấy proof. Upload file của bạn để so sánh.</span></div>`);

  } catch (e) {
    resolvedProof = null;
    showResolveResult('error', `<span>✕</span><span>${escapeHtml(e.message || 'Không tìm thấy proof')}</span>`);
    el('proof-card').style.display = 'none';
    el('compare-section').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tìm kiếm';
  }
}

function handleVerifyFile(file) {
  if (!file) return;
  selectedVerifyFile = file;
  const label = el('vfy-file-label');
  if (label) label.textContent = file.name + ' · ' + formatBytes(file.size);
  el('vfy-verify-btn').style.display = 'block';
}

async function doVerify() {
  if (!resolvedProof) { toast('Tìm proof trước.', 'error'); return; }
  if (!selectedVerifyFile) { toast('Chọn file để so sánh.', 'error'); return; }

  const btn = el('vfy-verify-btn');
  btn.disabled = true;
  btn.textContent = 'Đang tính fingerprint…';
  showCompareResult('progress', 'Đang tính SHA-256 fingerprint của file bạn…');

  try {
    const hash = await hashFile(selectedVerifyFile);
    if (hash === resolvedProof.sha256_hash) {
      showCompareResult('success', `
        <strong>Khớp chính xác.</strong>
        <p>File của bạn giống hệt bản gốc đã lưu.</p>
        <code>${hash}</code>
      `);
    } else {
      showCompareResult('fail', `
        <strong>Không khớp.</strong>
        <p>File có thể đã bị chỉnh sửa, nén, cắt xén, hoặc bị thay thế.</p>
        <code>Gốc: ${resolvedProof.sha256_hash}</code>
        <code>File bạn: ${hash}</code>
      `);
    }
  } catch (e) {
    showCompareResult('fail', `<strong>Lỗi:</strong> ${escapeHtml(e.message)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'So sánh fingerprint';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = el('verify-upload');
  const dropZone = el('vfy-dropzone');

  fileInput?.addEventListener('change', e => handleVerifyFile(e.target.files[0]));

  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleVerifyFile(e.dataTransfer.files[0]);
  });
  dropZone?.addEventListener('click', () => fileInput?.click());

  el('proof-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') resolveProof(); });
});
