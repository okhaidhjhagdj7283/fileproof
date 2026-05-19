let proof = null;
const proofId = new URLSearchParams(location.search).get('id');

async function loadProof() {
  if (!proofId) { document.getElementById('proof-error').style.display = ''; return; }
  try {
    proof = await api(`/proofs/${proofId}`);
    renderProof();
    loadComments();
  } catch (e) {
    document.getElementById('proof-error').style.display = '';
    document.getElementById('proof-error').textContent = e.message || 'Proof not found.';
    document.getElementById('proof-loading').style.display = 'none';
  }
}

function renderProof() {
  document.getElementById('proof-loading').style.display = 'none';
  document.getElementById('proof-content').style.display = '';

  // Title & header
  document.getElementById('proof-title').textContent = proof.title;
  document.title = `${proof.title} — FileProof`;

  const tags = Array.isArray(proof.tags) ? proof.tags : JSON.parse(proof.tags || '[]');

  // Community warning
  const warningEl = document.getElementById('community-warning');
  if (warningEl) warningEl.innerHTML = renderCommunityWarning(proof.community_status);

  // Submitter
  let submitterHtml = '';
  if (proof.submitter_type === 'wallet' && proof.wallet_address) {
    const addr = proof.wallet_address;
    const short = addr.slice(0, 6) + '…' + addr.slice(-4);
    const verified = proof.wallet_signature_verified ? '<span class="badge badge-green" style="margin-left:6px">Wallet Verified</span>' : '';
    submitterHtml = `Submitted by <strong>${short}</strong>${verified}`;
  } else if (proof.owner_name) {
    submitterHtml = `Submitted by <strong>${escapeHtml(proof.owner_name)}</strong>`;
  } else {
    submitterHtml = `Submitted anonymously`;
  }

  document.getElementById('proof-submitter').innerHTML = submitterHtml;
  document.getElementById('proof-date').textContent = `Preserved on ${formatDate(proof.created_at)}`;

  // File verification status badge
  const statusBadge = document.getElementById('proof-status-badge');
  if (statusBadge) {
    statusBadge.className = 'badge badge-green';
    statusBadge.innerHTML = '<span class="badge-pip"></span> File preserved';
  }

  // Media viewer
  renderMedia();

  // Proof details
  document.getElementById('detail-filename').textContent = proof.file_name;
  document.getElementById('detail-filetype').textContent = proof.file_type;
  document.getElementById('detail-filesize').textContent = formatBytes(proof.file_size);
  document.getElementById('detail-created').textContent = formatDateTime(proof.created_at);
  document.getElementById('detail-visibility').textContent = capitalize(proof.visibility);
  document.getElementById('detail-storage').textContent = proof.storage_provider === 'shelby' ? 'Shelby' : 'Local storage';

  if (proof.location_text) {
    document.getElementById('detail-location-row').style.display = '';
    document.getElementById('detail-location').textContent = proof.location_text;
  }
  if (proof.event_date) {
    document.getElementById('detail-event-row').style.display = '';
    document.getElementById('detail-event-date').textContent = formatDate(proof.event_date);
  }
  if (proof.category) {
    document.getElementById('detail-category-row').style.display = '';
    document.getElementById('detail-category').textContent = proof.category;
  }

  // Tags
  if (tags.length) {
    document.getElementById('proof-tags').innerHTML = tags.map(t =>
      `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }

  // Technical details
  document.getElementById('tech-hash').textContent = proof.sha256_hash;
  document.getElementById('tech-blob-id').textContent = proof.shelby_blob_id || 'N/A';
  document.getElementById('tech-record-id').textContent = proof.id;

  // Community counts
  renderCounts();

  // Own proof controls
  const user = getUser();
  if (user && proof.owner_id === user.id) {
    document.getElementById('owner-controls').style.display = '';
  }
}

function renderMedia() {
  const container = document.getElementById('media-viewer');
  if (!container || !proof) return;
  const mime = proof.file_type;
  const src = proof.download_url || `/api/proofs/${proof.id}/download`;

  if (mime.startsWith('image/')) {
    container.innerHTML = `<img src="${src}" alt="${escapeHtml(proof.file_name)}" style="max-width:100%;max-height:480px;object-fit:contain;border-radius:8px;">`;
  } else if (mime.startsWith('video/')) {
    container.innerHTML = `<video src="${src}" controls style="width:100%;max-height:480px;border-radius:8px;background:#000;"></video>`;
  } else if (mime.startsWith('audio/')) {
    container.innerHTML = `<div style="padding:24px 0;"><audio src="${src}" controls style="width:100%;"></audio></div>`;
  } else if (mime === 'application/pdf') {
    container.innerHTML = `<iframe src="${src}" style="width:100%;height:480px;border:none;border-radius:8px;"></iframe>`;
  } else {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--muted);">
        <div style="font-size:48px;">${fileIcon(mime)}</div>
        <p style="margin-top:12px;">No preview available for this file type.</p>
        <a href="${src}" download class="btn btn-secondary btn-sm" style="margin-top:12px;">Download to view</a>
      </div>`;
  }
}

function renderCounts() {
  if (!proof) return;
  document.getElementById('count-useful').textContent = proof.useful_count || 0;
  document.getElementById('count-question').textContent = proof.question_count || 0;
  document.getElementById('count-comments').textContent = proof.comment_count || 0;
  document.getElementById('count-flags').textContent = proof.flag_count || 0;

  const user = getUser();
  if (user) {
    const usefulBtn = document.getElementById('btn-useful');
    const questionBtn = document.getElementById('btn-question');
    if (usefulBtn) usefulBtn.classList.toggle('active', proof.my_reaction === 'useful');
    if (questionBtn) questionBtn.classList.toggle('active', proof.my_reaction === 'question');
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────
async function react(type) {
  if (!getUser()) return (location.href = '/login.html');
  try {
    const result = await api(`/proofs/${proofId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    });

    // Refresh counts
    const summary = await api(`/proofs/${proofId}/reactions/summary`);
    proof.useful_count = summary.useful_count;
    proof.question_count = summary.question_count;
    proof.my_reaction = summary.my_reaction;
    renderCounts();
  } catch (e) {
    console.error(e);
  }
}

// ─── Flag ─────────────────────────────────────────────────────────────────────
function openFlagModal() {
  if (!getUser()) return (location.href = '/login.html');
  document.getElementById('flag-modal').style.display = 'flex';
}

function closeFlagModal() {
  document.getElementById('flag-modal').style.display = 'none';
}

async function submitFlag() {
  const reason = document.getElementById('flag-reason')?.value;
  if (!reason) return;
  try {
    await api('/flags', {
      method: 'POST',
      body: JSON.stringify({ targetType: 'proof', targetId: proofId, reason }),
    });
    closeFlagModal();
    document.getElementById('flag-thanks').style.display = '';
  } catch (e) {
    alert(e.message);
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────
async function verifyDisplayedFile() {
  if (!proof) return;
  const resultEl = document.getElementById('verify-result');
  resultEl.innerHTML = '<span style="color:var(--muted)">Fetching file from storage and computing hash…</span>';

  try {
    const downloadUrl = proof.download_url || `/api/proofs/${proofId}/download`;
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('Could not fetch file from storage');

    const blob = await response.blob();
    const file = new File([blob], proof.file_name, { type: proof.file_type });
    const hash = await sha256File(file);

    if (hash === proof.sha256_hash) {
      resultEl.innerHTML = `
        <div class="verify-result verify-success">
          <div class="verify-result-icon">✓</div>
          <div>
            <strong>Verified.</strong>
            <p>The file served from storage matches the original proof record.</p>
            <p class="mono" style="font-size:11px;margin-top:6px;word-break:break-all;">${hash}</p>
          </div>
        </div>`;
    } else {
      resultEl.innerHTML = `
        <div class="verify-result verify-fail">
          <div class="verify-result-icon">✕</div>
          <div>
            <strong>Warning.</strong>
            <p>The file served from storage does not match the original proof record.</p>
          </div>
        </div>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<div class="verify-result verify-fail"><span>Error: ${escapeHtml(e.message)}</span></div>`;
  }
}

document.getElementById('verify-file-input')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !proof) return;
  const resultEl = document.getElementById('verify-result');
  resultEl.innerHTML = '<span style="color:var(--muted)">Computing file fingerprint…</span>';
  try {
    const hash = await sha256File(file);
    if (hash === proof.sha256_hash) {
      resultEl.innerHTML = `
        <div class="verify-result verify-success">
          <div class="verify-result-icon">✓</div>
          <div>
            <strong>Match.</strong>
            <p>Your file is identical to the preserved original.</p>
            <p class="mono" style="font-size:11px;margin-top:6px;word-break:break-all;">${hash}</p>
          </div>
        </div>`;
    } else {
      resultEl.innerHTML = `
        <div class="verify-result verify-fail">
          <div class="verify-result-icon">✕</div>
          <div>
            <strong>Not a match.</strong>
            <p>Your file may have been edited, compressed, cropped, or replaced.</p>
          </div>
        </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="verify-result verify-fail"><span>Error computing hash: ${escapeHtml(err.message)}</span></div>`;
  }
});

// ─── Comments ─────────────────────────────────────────────────────────────────
let commentSort = 'newest';

async function loadComments() {
  try {
    const comments = await api(`/proofs/${proofId}/comments?sort=${commentSort}`);
    renderComments(comments);
  } catch {}
}

function renderComments(comments) {
  const container = document.getElementById('comments-list');
  if (!container) return;
  if (!comments.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:14px;">No comments yet. Be the first to add context.</p>';
    return;
  }
  container.innerHTML = comments.map(renderComment).join('');
}

function renderComment(c) {
  const collapsed = c.collapsed;
  const body = collapsed
    ? `<div class="comment-collapsed">This comment is hidden by community filters. <button class="btn-link" onclick="showComment('${c.id}')">Show anyway</button></div>`
    : `<div class="comment-body">${escapeHtml(c.body)}</div>`;

  const user = getUser();
  const isOwn = user && c.author_id === user.id;
  const walletBadge = c.wallet_address ? `<span class="badge badge-gray" style="margin-left:6px">Wallet</span>` : '';

  return `
    <div class="comment" id="comment-${c.id}">
      <div class="comment-header">
        <strong>${escapeHtml(c.author_name || 'Anonymous')}</strong>${walletBadge}
        <span class="comment-time" style="margin-left:8px;font-size:12px;color:var(--muted)">${timeAgo(c.created_at)}</span>
        ${isOwn ? `<button class="btn-link danger" onclick="deleteComment('${c.id}')" style="margin-left:auto">Delete</button>` : `<button class="btn-link" onclick="flagComment('${c.id}')" style="margin-left:auto;font-size:12px;color:var(--muted)">Flag</button>`}
      </div>
      ${body}
      <div class="comment-actions">
        <button class="btn-link ${c.my_reaction === 'useful' ? 'active' : ''}" onclick="likeComment('${c.id}')">
          ↑ Useful ${c.useful_count > 0 ? `(${c.useful_count})` : ''}
        </button>
        <button class="btn-link" onclick="toggleReply('${c.id}')">Reply</button>
      </div>
      <div id="reply-box-${c.id}" style="display:none;margin-top:8px;"></div>
    </div>
  `;
}

function showComment(commentId) {
  const el = document.querySelector(`#comment-${commentId} .comment-collapsed`);
  if (el) el.innerHTML = ''; // Let content show
}

async function submitComment() {
  const user = getUser();
  if (!user) return (location.href = '/login.html');
  const textarea = document.getElementById('comment-input');
  const body = textarea?.value?.trim();
  if (!body) return;
  try {
    await api(`/proofs/${proofId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    textarea.value = '';
    proof.comment_count = (proof.comment_count || 0) + 1;
    document.getElementById('count-comments').textContent = proof.comment_count;
    loadComments();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteComment(commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    await api(`/proofs/comments/${commentId}`, { method: 'DELETE' });
    loadComments();
  } catch (e) { alert(e.message); }
}

async function likeComment(commentId) {
  if (!getUser()) return (location.href = '/login.html');
  try {
    await api(`/proofs/comments/${commentId}/reactions`, { method: 'POST', body: JSON.stringify({ type: 'useful' }) });
    loadComments();
  } catch {}
}

async function flagComment(commentId) {
  if (!getUser()) return (location.href = '/login.html');
  const reason = prompt('Flag this comment as:\nspam / personal_info / harassment / other');
  if (!reason) return;
  try {
    await api('/flags', { method: 'POST', body: JSON.stringify({ targetType: 'comment', targetId: commentId, reason }) });
    loadComments();
  } catch (e) { alert(e.message); }
}

function toggleReply(commentId) {
  const box = document.getElementById(`reply-box-${commentId}`);
  if (!box) return;
  if (box.style.display === 'none') {
    box.style.display = '';
    box.innerHTML = `
      <textarea placeholder="Write a reply…" id="reply-input-${commentId}" style="width:100%;min-height:60px;resize:vertical;font-size:13px;padding:8px;border:1px solid var(--border-md);border-radius:6px;font-family:inherit;"></textarea>
      <div style="margin-top:6px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="submitReply('${commentId}')">Reply</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('reply-box-${commentId}').style.display='none'">Cancel</button>
      </div>`;
    document.getElementById(`reply-input-${commentId}`)?.focus();
  } else {
    box.style.display = 'none';
  }
}

async function submitReply(parentId) {
  if (!getUser()) return (location.href = '/login.html');
  const input = document.getElementById(`reply-input-${parentId}`);
  const body = input?.value?.trim();
  if (!body) return;
  try {
    await api(`/proofs/${proofId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, parent_id: parentId }),
    });
    loadComments();
  } catch (e) { alert(e.message); }
}

function setSortComments(sort) {
  commentSort = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  loadComments();
}

// ─── Misc ─────────────────────────────────────────────────────────────────────
function copyProofLink() {
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.querySelector('[onclick="copyProofLink()"]');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy link', 2000); }
  });
}

function toggleTechDetails() {
  const el = document.getElementById('tech-details');
  const btn = document.getElementById('tech-toggle');
  if (el.style.display === 'none') {
    el.style.display = '';
    if (btn) btn.textContent = 'Hide technical details';
  } else {
    el.style.display = 'none';
    if (btn) btn.textContent = 'Show technical details';
  }
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

document.addEventListener('DOMContentLoaded', loadProof);
