// ─── FileProof Create Proof Flow ──────────────────────────────────────────────
// Implements: hash → draft → upload-session → PUT to Shelby/local → complete

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB, mirror server config

const ALLOWED_TYPES = [
  'image/', 'video/', 'audio/', 'application/pdf',
  'application/zip', 'application/x-zip', 'application/gzip',
  'application/msword', 'application/vnd.openxmlformats',
  'application/vnd.ms-', 'text/plain', 'text/csv',
];

// ─── Utils ────────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function isAllowedType(mimeType) {
  return ALLOWED_TYPES.some(t => mimeType.startsWith(t));
}

async function hashFileSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function authHeaders() {
  const token = localStorage.getItem('fp_token');
  return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStep(msg, type = 'progress') {
  const el = document.getElementById('fp-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `fp-status fp-status--${type}`;
  el.style.display = 'block';
}

function setError(msg) {
  setStep(msg, 'error');
  setProgress(0);
  document.getElementById('fp-submit-btn').disabled = false;
  document.getElementById('fp-submit-btn').textContent = 'Create Proof';
}

function setProgress(pct) {
  const bar = document.getElementById('fp-progress-bar');
  if (!bar) return;
  bar.style.width = pct + '%';
  bar.parentElement.style.display = pct > 0 ? 'block' : 'none';
}

function showRecovery(draftId) {
  const el = document.getElementById('fp-recovery');
  if (!el) return;
  el.innerHTML = `
    <div class="fp-recovery-box">
      <strong>Your file was uploaded, but the proof record could not be completed.</strong><br>
      Please retry completing the proof.<br><br>
      Recovery code: <code>${draftId}</code>
    </div>
  `;
  el.style.display = 'block';
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function renderPreview(file) {
  const container = document.getElementById('fp-preview');
  if (!container) return;
  container.innerHTML = '';

  const url = URL.createObjectURL(file);
  let el;

  if (file.type.startsWith('image/')) {
    el = document.createElement('img');
    el.src = url;
    el.style.cssText = 'max-width:100%;max-height:280px;border-radius:6px;display:block';
  } else if (file.type.startsWith('video/')) {
    el = document.createElement('video');
    el.src = url;
    el.controls = true;
    el.style.cssText = 'max-width:100%;max-height:280px;border-radius:6px;display:block';
  } else if (file.type.startsWith('audio/')) {
    el = document.createElement('audio');
    el.src = url;
    el.controls = true;
    el.style.cssText = 'width:100%';
  } else if (file.type === 'application/pdf') {
    el = document.createElement('iframe');
    el.src = url;
    el.style.cssText = 'width:100%;height:260px;border:none;border-radius:6px';
  } else {
    container.innerHTML = `<div class="fp-no-preview"><i class="ti ti-file"></i><p>No preview available</p><p class="text-muted text-sm">${file.type || 'Unknown type'}</p></div>`;
    return;
  }
  container.appendChild(el);
}

// ─── Main flow ────────────────────────────────────────────────────────────────

async function createProofFlow(file, form) {
  let draftId = null;

  try {
    // Step 1: Hash
    setStep('Generating file fingerprint...', 'progress');
    setProgress(10);
    const sha256Hash = await hashFileSHA256(file);

    document.getElementById('fp-hash-display')
      && (document.getElementById('fp-hash-display').textContent = sha256Hash);

    // Step 2: Create draft
    setStep('Creating proof draft...', 'progress');
    setProgress(20);

    const draftRes = await fetch('/api/proofs/draft', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        sha256Hash,
      }),
    });

    if (!draftRes.ok) {
      const e = await draftRes.json().catch(() => ({}));
      throw new Error(e.error || 'Draft creation failed');
    }

    const draft = await draftRes.json();
    draftId = draft.draftId;

    // Step 3: Get upload session
    setStep('Preparing upload...', 'progress');
    setProgress(30);

    const sessionRes = await fetch('/api/storage/upload-session', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        draftId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
        sha256Hash,
      }),
    });

    if (!sessionRes.ok) {
      const e = await sessionRes.json().catch(() => ({}));
      throw new Error(e.error || 'Could not prepare upload session');
    }

    const session = await sessionRes.json();

    // Step 4: Upload file to Shelby or local endpoint
    setStep('Uploading file to storage...', 'progress');
    setProgress(40);

    const uploadUrl = session.uploadUrl.startsWith('http')
      ? session.uploadUrl
      : window.location.origin + session.uploadUrl;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error('File upload to storage failed');
    }

    setProgress(65);

    // Step 5: Confirm upload, get blob ID
    setStep('Confirming upload...', 'progress');

    let shelbyBlobId, storageProvider, storageUri;

    if (session.storageProvider === 'local') {
      // Local upload endpoint returns blob info directly
      const uploadData = await uploadRes.json().catch(() => null);
      if (uploadData && uploadData.shelbyBlobId) {
        shelbyBlobId = uploadData.shelbyBlobId;
        storageProvider = uploadData.storageProvider;
        storageUri = uploadData.storageUri;
      } else {
        shelbyBlobId = `local://${session._localTempName}`;
        storageProvider = 'local';
        storageUri = shelbyBlobId;
      }
    } else {
      // Shelby: confirm session
      const confirmRes = await fetch('/api/storage/confirm-upload', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          uploadSessionId: session.uploadSessionId,
          localTempName: session._localTempName,
        }),
      });

      if (!confirmRes.ok) {
        const e = await confirmRes.json().catch(() => ({}));
        throw new Error(e.error || 'Upload confirmation failed');
      }

      const confirmed = await confirmRes.json();
      shelbyBlobId = confirmed.shelbyBlobId;
      storageProvider = confirmed.storageProvider;
      storageUri = confirmed.storageUri;
    }

    setProgress(75);

    // Step 6: Complete proof
    setStep('Saving proof record...', 'progress');

    const completeRes = await fetch(`/api/proofs/${draftId}/complete`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: form.title,
        description: form.description || null,
        category: form.category || null,
        tags: form.tags || [],
        visibility: form.visibility || 'public',
        eventDate: form.eventDate || null,
        locationText: form.locationText || null,
        submitterType: form.submitterType || 'anonymous',
        sha256Hash,
        shelbyBlobId,
        storageUri: storageUri || shelbyBlobId,
        collection_id: form.collectionId || null,
      }),
    });

    if (!completeRes.ok) {
      const e = await completeRes.json().catch(() => ({}));
      showRecovery(draftId);
      throw new Error(e.error || 'Metadata save failed');
    }

    setProgress(100);
    setStep('Proof created!', 'success');

    const complete = await completeRes.json();
    setTimeout(() => {
      window.location.href = complete.proofUrl;
    }, 600);

  } catch (err) {
    console.error('createProofFlow error:', err);
    setError(err.message || 'Something went wrong');
    if (draftId) showRecovery(draftId);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fp-file-input');
  const dropZone = document.getElementById('fp-dropzone');
  const form = document.getElementById('fp-create-form');

  let selectedFile = null;
  let sha256Cache = null;

  function handleFile(file) {
    if (!file) return;

    if (!isAllowedType(file.type)) {
      setError(`Unsupported file type: ${file.type}`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large: ${formatBytes(file.size)}. Max is ${formatBytes(MAX_FILE_SIZE)}.`);
      return;
    }

    selectedFile = file;
    sha256Cache = null;

    // Show file info
    const info = document.getElementById('fp-file-info');
    if (info) {
      info.innerHTML = `
        <div class="fp-file-meta">
          <span class="fp-file-name">${file.name}</span>
          <span class="fp-file-size text-muted">${formatBytes(file.size)}</span>
          <span class="fp-file-type text-muted">${file.type || 'unknown'}</span>
        </div>
      `;
      info.style.display = 'block';
    }

    renderPreview(file);

    // Auto-fill title from filename
    const titleInput = document.getElementById('fp-title');
    if (titleInput && !titleInput.value) {
      titleInput.value = file.name.replace(/\.[^/.]+$/, '');
    }

    // Start hashing in background
    setStep('Generating file fingerprint...', 'progress');
    hashFileSHA256(file).then(hash => {
      sha256Cache = hash;
      const el = document.getElementById('fp-hash-display');
      if (el) {
        el.textContent = hash;
        el.parentElement.style.display = 'block';
      }
      setStep('File fingerprint generated. Fill in details and create proof.', 'success');
    }).catch(() => {
      setStep('Could not generate fingerprint. Please try again.', 'error');
    });
  }

  // File input change
  fileInput?.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
  });

  // Drag & drop
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    handleFile(e.dataTransfer.files[0]);
  });
  dropZone?.addEventListener('click', () => fileInput?.click());

  // Form submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) { setError('Please select a file first'); return; }

    const btn = document.getElementById('fp-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const tagsRaw = document.getElementById('fp-tags')?.value || '';
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    const formData = {
      title: document.getElementById('fp-title')?.value?.trim() || selectedFile.name,
      description: document.getElementById('fp-description')?.value?.trim() || '',
      category: document.getElementById('fp-category')?.value || '',
      tags,
      visibility: document.getElementById('fp-visibility')?.value || 'public',
      eventDate: document.getElementById('fp-event-date')?.value || '',
      locationText: document.getElementById('fp-location')?.value?.trim() || '',
      submitterType: localStorage.getItem('fp_token') ? 'account' : 'anonymous',
      collectionId: document.getElementById('fp-collection')?.value || '',
    };

    await createProofFlow(selectedFile, formData);
  });
});
