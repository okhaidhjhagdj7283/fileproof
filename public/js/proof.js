// ─── FileProof Proof Page ─────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const PROOF_ID = params.get('id');

async function hashFileSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function shortHash(h) {
  return h ? h.slice(0, 16) + '...' + h.slice(-8) : '—';
}

function authHeaders() {
  const token = localStorage.getItem('fp_token');
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ─── Media viewer ─────────────────────────────────────────────────────────────

function renderMedia(proof) {
  const container = document.getElementById('fp-media-viewer');
  if (!container || !proof.download_url) return;

  const url = proof.download_url;
  let html = '';

  if (proof.file_type?.startsWith('image/')) {
    html = `<img src="${url}" alt="${proof.file_name}" style="max-width:100%;max-height:480px;border-radius:8px;display:block;margin:0 auto">`;
  } else if (proof.file_type?.startsWith('video/')) {
    html = `<video controls style="max-width:100%;max-height:480px;border-radius:8px;display:block;margin:0 auto"><source src="${url}" type="${proof.file_type}">Your browser doesn't support video.</video>`;
  } else if (proof.file_type?.startsWith('audio/')) {
    html = `<audio controls style="width:100%"><source src="${url}" type="${proof.file_type}">Your browser doesn't support audio.</audio>`;
  } else if (proof.file_type === 'application/pdf') {
    html = `<iframe src="${url}" style="width:100%;height:480px;border:none;border-radius:8px"></iframe>`;
  } else {
    html = `<div class="fp-no-preview"><i class="ti ti-file" style="font-size:48px;color:var(--muted)"></i><p style="margin-top:12px;color:var(--muted)">No preview available for this file type</p><p class="text-muted text-sm">${proof.file_type || 'unknown type'}</p></div>`;
  }

  container.innerHTML = html;
}

// ─── Community warning ────────────────────────────────────────────────────────

function renderCommunityWarning(proof) {
  const el = document.getElementById('fp-community-warning');
  if (!el) return;

  if (proof.community_status === 'community_flagged' || proof.community_status === 'sensitive') {
    el.innerHTML = `
      <div class="community-warning">
        <strong>Community warning</strong>
        <p>This proof has been flagged by multiple users. The file fingerprint is still verifiable, but the metadata or context may be disputed.</p>
        <div style="display:flex;gap:16px;margin-top:8px">
          <span>File verification: <strong id="fp-verify-badge">Available</strong></span>
          <span>Community status: <strong>${proof.community_status === 'sensitive' ? 'Questioned' : 'Flagged'}</strong></span>
        </div>
      </div>
    `;
    el.style.display = 'block';
  }
}

// ─── Verify displayed file (backend hash) ─────────────────────────────────────

async function verifyStorage() {
  const btn = document.getElementById('fp-verify-storage-btn');
  const result = document.getElementById('fp-verify-result');
  if (btn) btn.disabled = true;
  if (result) result.innerHTML = '<span class="text-muted">Verifying...</span>';

  try {
    const res = await fetch(`/api/proofs/${PROOF_ID}/verify-storage`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();

    if (data.match) {
      result.innerHTML = `
        <div class="verify-result verify-result--success">
          <i class="ti ti-circle-check"></i>
          <strong>Verified.</strong>
          <p>The file served from storage matches the original proof record.</p>
          <div class="hash-compare">
            <div><span class="text-muted">Stored hash:</span> <code>${data.storedHash}</code></div>
            <div><span class="text-muted">Storage hash:</span> <code>${data.storageHash}</code></div>
          </div>
        </div>
      `;
    } else {
      result.innerHTML = `
        <div class="verify-result verify-result--fail">
          <i class="ti ti-alert-triangle"></i>
          <strong>Warning.</strong>
          <p>The file served from storage does not match the original proof record.</p>
        </div>
      `;
    }
  } catch (e) {
    result.innerHTML = `<div class="verify-result verify-result--fail"><strong>Error:</strong> ${e.message}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Upload file to compare (client-side hash) ────────────────────────────────

async function compareFile(file, proofHash) {
  const result = document.getElementById('fp-compare-result');
  if (result) result.innerHTML = '<span class="text-muted">Hashing your file...</span>';

  try {
    const hash = await hashFileSHA256(file);
    if (hash === proofHash) {
      result.innerHTML = `
        <div class="verify-result verify-result--success">
          <i class="ti ti-circle-check"></i>
          <strong>Match.</strong>
          <p>Your file is identical to the preserved original.</p>
          <code style="font-size:11px;word-break:break-all">${hash}</code>
        </div>
      `;
    } else {
      result.innerHTML = `
        <div class="verify-result verify-result--fail">
          <i class="ti ti-alert-triangle"></i>
          <strong>Not a match.</strong>
          <p>Your file may have been edited, compressed, cropped, or replaced.</p>
          <div class="hash-compare">
            <div><span class="text-muted">Original:</span> <code>${proofHash}</code></div>
            <div><span class="text-muted">Your file:</span> <code>${hash}</code></div>
          </div>
        </div>
      `;
    }
  } catch (e) {
    result.innerHTML = `<div class="verify-result verify-result--fail"><strong>Error hashing file:</strong> ${e.message}</div>`;
  }
}

// ─── Load proof ───────────────────────────────────────────────────────────────

async function loadProof() {
  if (!PROOF_ID) {
    document.getElementById('fp-proof-container').innerHTML = '<p class="text-muted">No proof ID specified.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/proofs/${PROOF_ID}`, { headers: authHeaders() });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      document.getElementById('fp-proof-container').innerHTML = `<p class="text-muted">${e.error || 'Proof not found'}</p>`;
      return;
    }

    const proof = await res.json();

    document.title = `${proof.title} — FileProof`;

    // Header
    document.getElementById('fp-proof-title').textContent = proof.title;
    document.getElementById('fp-proof-date').textContent = `Preserved on ${new Date(proof.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
    document.getElementById('fp-proof-submitter').textContent = `Submitted by ${proof.submitter_type === 'account' ? (proof.owner_name || 'Account user') : proof.submitter_type === 'wallet' ? (proof.wallet_address ? proof.wallet_address.slice(0,6)+'...'+proof.wallet_address.slice(-4) : 'Wallet user') : 'Anonymous'}`;

    // Proof details
    document.getElementById('fp-file-name').textContent = proof.file_name;
    document.getElementById('fp-file-type').textContent = proof.file_type;
    document.getElementById('fp-file-size').textContent = formatBytes(proof.file_size);
    document.getElementById('fp-storage-provider').textContent = proof.storage_provider || 'shelby';
    document.getElementById('fp-created-at').textContent = formatDate(proof.created_at);
    document.getElementById('fp-visibility').textContent = proof.visibility;

    // Technical details
    document.getElementById('fp-sha256').textContent = proof.sha256_hash;
    document.getElementById('fp-blob-id').textContent = proof.shelby_blob_id || '—';
    document.getElementById('fp-proof-id').textContent = proof.id;

    // Tags
    if (proof.tags?.length) {
      document.getElementById('fp-tags').innerHTML = proof.tags.map(t => `<span class="tag">${t}</span>`).join('');
    }

    // Community warning
    renderCommunityWarning(proof);

    // Media viewer
    renderMedia(proof);

    // Download button
    const dlBtn = document.getElementById('fp-download-btn');
    if (dlBtn) dlBtn.href = `/api/proofs/${PROOF_ID}/download`;

    // Copy link
    document.getElementById('fp-copy-link-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href);
      const btn = document.getElementById('fp-copy-link-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy link', 1500);
    });

    // Verify storage button
    document.getElementById('fp-verify-storage-btn')?.addEventListener('click', verifyStorage);

    // Compare file input
    const compareInput = document.getElementById('fp-compare-input');
    compareInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) compareFile(file, proof.sha256_hash);
    });

    // Reactions
    loadReactions(proof);

    // Flag button
    document.getElementById('fp-flag-btn')?.addEventListener('click', () => {
      const reason = prompt('Flag reason:\nspam | personal_info | illegal_content | harassment | copyright | misleading_metadata | sensitive_content | other');
      if (!reason) return;
      flagProof(PROOF_ID, reason);
    });

    // Comments
    loadComments(proof.id);

  } catch (e) {
    document.getElementById('fp-proof-container').innerHTML = `<p class="text-muted">Error loading proof: ${e.message}</p>`;
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────

async function loadReactions(proof) {
  const res = await fetch(`/api/proofs/${PROOF_ID}/reactions/summary`, { headers: authHeaders() });
  if (!res.ok) return;
  const data = await res.json();

  const usefulBtn = document.getElementById('fp-useful-btn');
  const questionBtn = document.getElementById('fp-question-btn');

  if (usefulBtn) {
    usefulBtn.textContent = `Useful (${data.useful_count})`;
    if (data.my_reaction === 'useful') usefulBtn.classList.add('active');
    usefulBtn.addEventListener('click', async () => {
      if (!FP.isLoggedIn()) { window.location.href = '/login.html'; return; }
      await fetch(`/api/proofs/${PROOF_ID}/reactions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: 'useful' }),
      });
      loadReactions(proof);
    });
  }

  if (questionBtn) {
    questionBtn.textContent = `Question (${data.question_count})`;
    if (data.my_reaction === 'question') questionBtn.classList.add('active');
    questionBtn.addEventListener('click', async () => {
      if (!FP.isLoggedIn()) { window.location.href = '/login.html'; return; }
      await fetch(`/api/proofs/${PROOF_ID}/reactions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: 'question', reason: 'context_missing' }),
      });
      loadReactions(proof);
    });
  }
}

// ─── Comments ────────────────────────────────────────────────────────────────

async function loadComments(proofId) {
  const res = await fetch(`/api/proofs/${proofId}/comments`);
  if (!res.ok) return;
  const comments = await res.json();

  const list = document.getElementById('fp-comments-list');
  if (!list) return;

  if (!comments.length) {
    list.innerHTML = '<p class="text-muted text-sm">No comments yet. Be the first to add context.</p>';
    return;
  }

  list.innerHTML = comments.map(c => `
    <div class="comment ${c.collapsed ? 'comment--collapsed' : ''}">
      <div class="comment-header">
        <strong>${c.author_name || 'Anonymous'}</strong>
        <span class="text-muted text-sm">${new Date(c.created_at).toLocaleDateString()}</span>
        ${c.collapsed ? '<span class="badge badge-warn">Community flagged</span>' : ''}
      </div>
      <div class="comment-body">${c.collapsed ? '[Collapsed — flagged by community]' : c.body}</div>
    </div>
  `).join('');
}

async function postComment() {
  if (!FP.isLoggedIn()) { window.location.href = '/login.html'; return; }
  const input = document.getElementById('fp-comment-input');
  const body = input?.value?.trim();
  if (!body) return;

  const res = await fetch(`/api/proofs/${PROOF_ID}/comments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  });

  if (res.ok) {
    input.value = '';
    loadComments(PROOF_ID);
  }
}

async function flagProof(proofId, reason) {
  if (!FP.isLoggedIn()) { window.location.href = '/login.html'; return; }
  const validReasons = ['spam','personal_info','illegal_content','harassment','copyright','misleading_metadata','sensitive_content','other'];
  if (!validReasons.includes(reason)) { alert('Invalid reason'); return; }

  const res = await fetch('/api/flags', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ targetType: 'proof', targetId: proofId, reason }),
  });
  const data = await res.json();
  alert(data.message || 'Flagged.');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadProof();

  document.getElementById('fp-post-comment-btn')?.addEventListener('click', postComment);

  document.getElementById('fp-comment-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment();
  });
});
