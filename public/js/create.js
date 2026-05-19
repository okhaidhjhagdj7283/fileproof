let selectedFile = null;
let fileHash = null;
let draftId = null;
let draftData = null;

const STEPS = ['select', 'metadata', 'submitting', 'done'];
let currentStep = 'select';

function setStep(step) {
  currentStep = step;
  STEPS.forEach(s => {
    const el = document.getElementById(`step-${s}`);
    if (el) el.style.display = s === step ? '' : 'none';
  });
}

// ─── File selection ───────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone?.addEventListener('click', () => fileInput?.click());
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput?.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  selectedFile = file;
  fileHash = null;
  draftId = null;

  // Show file info
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-size').textContent = formatBytes(file.size);
  document.getElementById('file-type-text').textContent = file.type || 'unknown';
  document.getElementById('file-info').style.display = '';
  dropZone.style.display = 'none';

  // Preview
  renderPreview(file);

  // Hash
  document.getElementById('hash-status').textContent = 'Generating fingerprint...';
  document.getElementById('hash-box').style.display = '';
  try {
    fileHash = await sha256File(file);
    document.getElementById('hash-status').textContent = 'File fingerprint generated';
    document.getElementById('hash-value').textContent = fileHash;
    document.getElementById('hash-display').style.display = '';
    document.getElementById('btn-next').disabled = false;
  } catch (e) {
    document.getElementById('hash-status').textContent = 'Failed to generate fingerprint. Try again.';
  }

  // Default title
  const titleInput = document.getElementById('title');
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }
}

function renderPreview(file) {
  const container = document.getElementById('file-preview');
  if (!container) return;
  container.innerHTML = '';
  const mime = file.type;
  if (mime.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    container.innerHTML = `<img src="${url}" style="max-width:100%;max-height:260px;border-radius:8px;object-fit:contain;">`;
  } else if (mime.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    container.innerHTML = `<video src="${url}" controls style="max-width:100%;max-height:260px;border-radius:8px;"></video>`;
  } else if (mime.startsWith('audio/')) {
    const url = URL.createObjectURL(file);
    container.innerHTML = `<audio src="${url}" controls style="width:100%;margin-top:8px;"></audio>`;
  } else {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:32px;">${fileIcon(mime)}<br><span style="font-size:13px">No preview available</span></div>`;
  }
}

function changeFile() {
  selectedFile = null;
  fileHash = null;
  draftId = null;
  document.getElementById('file-info').style.display = 'none';
  document.getElementById('file-preview').innerHTML = '';
  dropZone.style.display = '';
  document.getElementById('hash-box').style.display = 'none';
  document.getElementById('hash-display').style.display = 'none';
  document.getElementById('btn-next').disabled = true;
  if (fileInput) fileInput.value = '';
}

document.getElementById('btn-next')?.addEventListener('click', () => {
  if (!selectedFile || !fileHash) return;
  setStep('metadata');
});

document.getElementById('btn-back')?.addEventListener('click', () => {
  setStep('select');
});

// ─── Submit ───────────────────────────────────────────────────────────────────
document.getElementById('form-metadata')?.addEventListener('submit', async e => {
  e.preventDefault();
  await submitProof();
});

async function submitProof() {
  if (!selectedFile || !fileHash) return;

  setStep('submitting');
  const steps = [
    'Generating fingerprint...',
    'Creating proof draft...',
    'Uploading original file to storage...',
    'Saving proof record...',
    'Done.',
  ];

  const statusEl = document.getElementById('submit-status');
  const progressFill = document.getElementById('submit-progress');
  const errorEl = document.getElementById('submit-error');

  function setStatus(i, total) {
    if (statusEl) statusEl.textContent = steps[i];
    if (progressFill) progressFill.style.width = `${Math.round((i / (total - 1)) * 100)}%`;
  }

  errorEl.style.display = 'none';
  setStatus(0, steps.length);

  try {
    // Step 1: Build form data with file + hash
    setStatus(1, steps.length);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('client_hash', fileHash);

    // Step 2: Upload file (creates draft)
    setStatus(2, steps.length);
    const token = localStorage.getItem('fp_token');
    const uploadRes = await fetch('/api/proofs/draft', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
    draftData = await uploadRes.json();
    draftId = draftData.draftId;

    // Step 3: Complete proof with metadata
    setStatus(3, steps.length);
    const title = document.getElementById('title')?.value?.trim();
    const description = document.getElementById('description')?.value?.trim();
    const category = document.getElementById('category')?.value?.trim();
    const tagsRaw = document.getElementById('tags')?.value?.trim();
    const visibility = document.getElementById('visibility')?.value || 'public';
    const event_date = document.getElementById('event-date')?.value || '';
    const location_text = document.getElementById('location')?.value?.trim() || '';
    const collection_id = document.getElementById('collection-id')?.value?.trim() || '';
    const submitter_type = getUser() ? 'account' : 'anonymous';

    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    const complete = await api(`/proofs/${draftId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        title, description, category, tags, visibility,
        event_date: event_date || undefined,
        location_text: location_text || undefined,
        collection_id: collection_id || undefined,
        submitter_type,
        sha256Hash: fileHash,
        shelbyBlobId: draftData.shelbyBlobId,
      }),
    });

    setStatus(4, steps.length);

    // Done
    document.getElementById('done-proof-link').href = complete.proofUrl;
    document.getElementById('done-proof-link').textContent = window.location.origin + complete.proofUrl;
    document.getElementById('done-proof-id').textContent = complete.proofId;
    setStep('done');

  } catch (err) {
    setStep('submitting');
    errorEl.style.display = '';

    // Recovery UI if draft was created but complete failed
    if (draftId) {
      errorEl.innerHTML = `
        <strong>Upload succeeded, but the proof record could not be saved.</strong><br>
        Your file was uploaded. Please retry completing the proof.<br>
        Recovery code: <code style="font-family:monospace">${draftId}</code>
        <br><br>
        <button class="btn btn-primary btn-sm" onclick="retryComplete()">Retry</button>
      `;
    } else {
      errorEl.textContent = err.message;
    }
  }
}

async function retryComplete() {
  if (!draftId) return;
  // Just re-call submit flow from metadata step
  document.getElementById('submit-error').style.display = 'none';
  await submitProof();
}

function copyProofLink() {
  const link = document.getElementById('done-proof-link')?.href;
  if (link) {
    navigator.clipboard.writeText(link).then(() => {
      const btn = document.querySelector('[onclick="copyProofLink()"]');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy link', 2000); }
    });
  }
}

// Load user's collections for the selector
async function loadCollections() {
  const user = getUser();
  const sel = document.getElementById('collection-id');
  if (!sel || !user) return;
  try {
    const cols = await api('/collections/user/mine');
    if (cols.length === 0) return;
    sel.innerHTML = '<option value="">No collection</option>' +
      cols.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    document.getElementById('collection-group').style.display = '';
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  setStep('select');
  document.getElementById('btn-next').disabled = true;
  document.getElementById('hash-box').style.display = 'none';
  document.getElementById('hash-display').style.display = 'none';
  document.getElementById('file-info').style.display = 'none';
  loadCollections();
});
