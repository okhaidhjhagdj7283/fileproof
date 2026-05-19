// ─── FileProof Create Flow ─────────────────────────────────────────────────

const MAX_SIZE = 100 * 1024 * 1024;
const ALLOWED = ['image/','video/','audio/','application/pdf','application/zip','application/x-zip','application/gzip','application/msword','application/vnd.openxmlformats','application/vnd.ms-','text/plain','text/csv'];

let selectedFile = null;
let sha256Cache = null;
let doneProofUrl = null;

// ── Utils ──────────────────────────────────────────────────────────────────
function isAllowed(mime) { return ALLOWED.some(t => mime.startsWith(t)); }

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Steps navigation ───────────────────────────────────────────────────────
function goToStep(n) {
  [1,2,3].forEach(i => {
    const panel = el('step-' + i);
    if (panel) panel.style.display = i === n ? 'block' : 'none';
    const tab = el('step-tab-' + i);
    if (tab) {
      tab.className = 'step-tab' + (i < n ? ' done' : i === n ? ' active' : '');
      if (i < n) tab.querySelector('.step-num').textContent = '✓';
      else tab.querySelector('.step-num').textContent = String(i);
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 3) submitProof();
}

// ── File handling ──────────────────────────────────────────────────────────
function resetFile() {
  selectedFile = null;
  sha256Cache = null;
  el('file-info').style.display = 'none';
  el('drop-zone').style.display = '';
  el('btn-to-step2').disabled = true;
  const fi = el('file-input');
  if (fi) fi.value = '';
}

function handleFile(file) {
  if (!file) return;
  if (!isAllowed(file.type || '')) {
    toast('Định dạng file không được hỗ trợ: ' + (file.type || 'unknown'), 'error'); return;
  }
  if (file.size > MAX_SIZE) {
    toast('File quá lớn: ' + formatBytes(file.size) + '. Tối đa 100 MB.', 'error'); return;
  }

  selectedFile = file;
  sha256Cache = null;

  el('drop-zone').style.display = 'none';
  el('file-info').style.display = 'block';
  el('file-icon-disp').textContent = fileIcon(file.type);
  el('file-name-disp').textContent = file.name;
  el('file-size-disp').textContent = formatBytes(file.size);
  el('file-type-disp').textContent = file.type || 'unknown';

  // Auto-fill title
  const titleInp = el('inp-title');
  if (titleInp && !titleInp.value) {
    titleInp.value = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  }

  // Preview
  renderPreview(file);

  // Hash
  el('hash-section').style.display = 'block';
  el('hash-status').style.display = 'flex';
  el('hash-value').style.display = 'none';

  hashFile(file).then(h => {
    sha256Cache = h;
    el('hash-status').style.display = 'none';
    el('hash-value').style.display = 'block';
    el('hash-value').textContent = h;
    el('btn-to-step2').disabled = false;
  }).catch(() => {
    el('hash-status').innerHTML = '<span class="text-red">Không thể tính fingerprint.</span>';
  });
}

function renderPreview(file) {
  const container = el('file-preview');
  if (!container) return;
  container.innerHTML = '';
  const url = URL.createObjectURL(file);
  let el2;
  if (file.type.startsWith('image/')) {
    el2 = document.createElement('img');
    el2.src = url;
    el2.style.cssText = 'max-width:100%;max-height:240px;border-radius:6px;display:block';
  } else if (file.type.startsWith('video/')) {
    el2 = document.createElement('video');
    el2.src = url; el2.controls = true;
    el2.style.cssText = 'max-width:100%;max-height:240px;border-radius:6px;display:block';
  } else if (file.type.startsWith('audio/')) {
    el2 = document.createElement('audio');
    el2.src = url; el2.controls = true; el2.style.width = '100%';
  } else if (file.type === 'application/pdf') {
    el2 = document.createElement('iframe');
    el2.src = url;
    el2.style.cssText = 'width:100%;height:220px;border:none;border-radius:6px';
  } else {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);background:var(--surface);border-radius:var(--radius);font-size:13px">${fileIcon(file.type)} No preview — ${file.type || 'unknown type'}</div>`;
    return;
  }
  container.appendChild(el2);
}

// ── Load user collections ──────────────────────────────────────────────────
async function loadCollections() {
  if (!isLoggedIn()) return;
  try {
    const cols = await api('/collections/user/mine');
    if (!cols.length) return;
    const group = el('collection-group');
    const sel = el('inp-collection');
    if (!group || !sel) return;
    cols.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      sel.appendChild(opt);
    });
    group.style.display = 'block';
  } catch {}
}

// ── Submit proof ───────────────────────────────────────────────────────────
async function submitProof() {
  if (!selectedFile || !sha256Cache) {
    goToStep(1); return;
  }

  const title = el('inp-title')?.value?.trim() || selectedFile.name;
  if (!title) { goToStep(2); toast('Vui lòng nhập tiêu đề.', 'error'); return; }

  const formData = {
    title,
    description: el('inp-description')?.value?.trim() || '',
    category: el('inp-category')?.value || '',
    tags: (el('inp-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean),
    visibility: el('inp-visibility')?.value || 'public',
    eventDate: el('inp-event-date')?.value || '',
    locationText: el('inp-location')?.value?.trim() || '',
    submitterType: isLoggedIn() ? 'account' : 'anonymous',
    collectionId: el('inp-collection')?.value || '',
  };

  showState('submitting');
  setStatus('Đang tạo proof draft…', 10);

  let draftId = null;
  try {
    // Step 1: Draft
    const draft = await api('/proofs/draft', {
      method: 'POST',
      body: JSON.stringify({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type || 'application/octet-stream',
        sha256Hash: sha256Cache,
      }),
    });
    draftId = draft.draftId;

    // Step 2: Upload session
    setStatus('Chuẩn bị upload…', 25);
    const session = await api('/storage/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type || 'application/octet-stream',
        sha256Hash: sha256Cache,
      }),
    });

    // Step 3: Upload file
    setStatus('Đang upload file…', 40);
    const uploadUrl = session.uploadUrl.startsWith('http')
      ? session.uploadUrl
      : window.location.origin + session.uploadUrl;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' },
      body: selectedFile,
    });
    if (!uploadRes.ok) throw new Error('Upload file thất bại');

    setStatus('Xác nhận upload…', 65);

    // Step 4: Confirm
    let shelbyBlobId, storageProvider, storageUri;
    if (session.storageProvider === 'local') {
      const upData = await uploadRes.json().catch(() => null);
      shelbyBlobId = upData?.shelbyBlobId || `local://${session._localTempName}`;
      storageProvider = 'local';
      storageUri = shelbyBlobId;
    } else {
      const confirmed = await api('/storage/confirm-upload', {
        method: 'POST',
        body: JSON.stringify({
          uploadSessionId: session.uploadSessionId,
          localTempName: session._localTempName,
        }),
      });
      shelbyBlobId = confirmed.shelbyBlobId;
      storageProvider = confirmed.storageProvider;
      storageUri = confirmed.storageUri;
    }

    // Step 5: Complete
    setStatus('Đang lưu thông tin proof…', 80);
    const complete = await api(`/proofs/${draftId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        title: formData.title,
        description: formData.description || null,
        category: formData.category || null,
        tags: formData.tags,
        visibility: formData.visibility,
        eventDate: formData.eventDate || null,
        locationText: formData.locationText || null,
        submitterType: formData.submitterType,
        sha256Hash: sha256Cache,
        shelbyBlobId,
        storageUri: storageUri || shelbyBlobId,
        collection_id: formData.collectionId || null,
      }),
    });

    setStatus('Hoàn tất!', 100);

    doneProofUrl = complete.proofUrl || `/proof.html?id=${complete.proofId || draftId}`;
    el('done-link').href = doneProofUrl;
    el('done-link').textContent = window.location.origin + doneProofUrl;
    el('done-view-btn').href = doneProofUrl;
    if (el('done-proof-id')) el('done-proof-id').textContent = 'Proof ID: ' + (complete.proofId || draftId);

    setTimeout(() => showState('done'), 400);

  } catch (err) {
    showState('error');
    el('error-msg').innerHTML = `<span>${escapeHtml(err.message || 'Đã có lỗi xảy ra')}</span>`;
    if (draftId) {
      el('recovery-box').style.display = 'block';
      el('recovery-box').innerHTML = `<div class="alert alert-warning"><span>Recovery code: <code class="mono">${draftId}</code></span></div>`;
    }
  }
}

function showState(s) {
  ['submitting','error','done'].forEach(n => {
    const d = el('state-' + n);
    if (d) d.style.display = n === s ? 'block' : 'none';
  });
}

function setStatus(msg, pct) {
  const st = el('submit-status');
  const pr = el('submit-progress');
  if (st) st.textContent = msg;
  if (pr) pr.style.width = pct + '%';
}

function copyDoneLink() {
  if (!doneProofUrl) return;
  navigator.clipboard.writeText(window.location.origin + doneProofUrl).then(() => toast('Đã sao chép link!'));
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = el('file-input');
  const dropZone = el('drop-zone');

  fileInput?.addEventListener('change', e => handleFile(e.target.files[0]));

  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
  dropZone?.addEventListener('click', () => fileInput?.click());

  loadCollections();
});
