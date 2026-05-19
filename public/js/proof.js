// ─── FileProof Proof Page ─────────────────────────────────────────────────

const PROOF_ID = new URLSearchParams(location.search).get('id');
let proofData = null;
let commentSort = 'newest';

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Media rendering ────────────────────────────────────────────────────────
function renderMedia(proof) {
  const v = el('media-viewer');
  if (!v) return;
  const url = proof.download_url;

  if (!url) {
    v.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">${fileIcon(proof.file_type)} File không có sẵn để xem</div>`;
    return;
  }

  const mt = proof.file_type || '';
  let html = '';
  if (mt.startsWith('image/')) {
    html = `<img src="${url}" alt="${escapeHtml(proof.file_name)}" style="max-width:100%;max-height:520px;display:block;margin:0 auto;border-radius:4px">`;
  } else if (mt.startsWith('video/')) {
    html = `<video controls style="max-width:100%;max-height:460px;display:block;margin:0 auto;border-radius:4px"><source src="${url}" type="${mt}">Trình duyệt không hỗ trợ video.</video>`;
  } else if (mt.startsWith('audio/')) {
    html = `<div style="padding:24px"><audio controls style="width:100%"><source src="${url}" type="${mt}">Trình duyệt không hỗ trợ audio.</audio></div>`;
  } else if (mt === 'application/pdf') {
    html = `<iframe src="${url}" style="width:100%;height:500px;border:none;display:block"></iframe>`;
  } else {
    html = `<div style="padding:40px;text-align:center;color:var(--muted)">${fileIcon(mt)}<p style="margin-top:10px;font-size:13px">Không có preview — ${mt || 'unknown'}</p><a href="${url}" class="btn btn-secondary btn-sm mt-2" download>Tải file về</a></div>`;
  }
  v.innerHTML = html;
}

// ── Community warning ──────────────────────────────────────────────────────
function renderWarning(proof) {
  const bar = el('community-warning-bar');
  if (!bar) return;
  if (proof.community_status === 'community_flagged' || proof.community_status === 'sensitive') {
    bar.innerHTML = `
      <div class="community-warning mb-2">
        <span style="font-size:18px;flex-shrink:0">⚠</span>
        <div>
          <strong style="display:block;margin-bottom:4px;color:var(--amber)">Cảnh báo cộng đồng</strong>
          <p class="text-sm">Proof này đã bị gắn cờ bởi nhiều người dùng. Fingerprint SHA-256 vẫn có thể xác minh, nhưng ngữ cảnh có thể bị tranh cãi.</p>
        </div>
      </div>`;
  }
}

// ── Verify ─────────────────────────────────────────────────────────────────
async function verifyDisplayedFile() {
  if (!proofData?.download_url) return;
  const res = el('verify-result');
  res.innerHTML = '<span class="text-muted text-sm">Đang xác minh…</span>';
  try {
    const r = await api(`/proofs/${PROOF_ID}/verify-storage`, { method: 'POST' });
    res.innerHTML = r.match
      ? `<div class="verify-result verify-success"><span class="verify-result-icon">✓</span><div><strong>Đã xác minh.</strong><p>File đang xem khớp với bản gốc đã lưu.</p><code>${r.storedHash}</code></div></div>`
      : `<div class="verify-result verify-fail"><span class="verify-result-icon">✗</span><div><strong>Không khớp.</strong><p>File được phục vụ không khớp với bản gốc.</p></div></div>`;
  } catch (e) {
    res.innerHTML = `<div class="verify-result verify-fail"><span class="verify-result-icon">✗</span><div><strong>Lỗi:</strong> ${escapeHtml(e.message)}</div></div>`;
  }
}

async function compareFile(file) {
  const res = el('verify-result');
  res.innerHTML = '<span class="text-muted text-sm">Đang tính fingerprint…</span>';
  try {
    const h = await hashFile(file);
    const match = h === proofData.sha256_hash;
    res.innerHTML = match
      ? `<div class="verify-result verify-success"><span class="verify-result-icon">✓</span><div><strong>Khớp chính xác.</strong><p>File của bạn giống hệt bản gốc đã lưu.</p><code>${h}</code></div></div>`
      : `<div class="verify-result verify-fail"><span class="verify-result-icon">✗</span><div><strong>Không khớp.</strong><p>File có thể đã bị chỉnh sửa, nén, hoặc cắt xén.</p><code>Gốc: ${proofData.sha256_hash}</code><code>File bạn: ${h}</code></div></div>`;
  } catch (e) {
    res.innerHTML = `<div class="verify-result verify-fail"><strong>Lỗi:</strong> ${escapeHtml(e.message)}</div>`;
  }
}

// ── Reactions ──────────────────────────────────────────────────────────────
async function loadReactions() {
  try {
    const data = await api(`/proofs/${PROOF_ID}/reactions/summary`);
    el('count-useful').textContent = data.useful_count || 0;
    el('count-question').textContent = data.question_count || 0;
    if (data.my_reaction === 'useful') el('btn-useful').classList.add('active');
    else el('btn-useful').classList.remove('active');
    if (data.my_reaction === 'question') el('btn-question').classList.add('active');
    else el('btn-question').classList.remove('active');
  } catch {}
}

async function react(type) {
  if (!isLoggedIn()) { window.location.href = '/login.html?next=' + encodeURIComponent(location.href); return; }
  await api(`/proofs/${PROOF_ID}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ type, reason: type === 'question' ? 'context_missing' : undefined }),
  }).catch(() => {});
  loadReactions();
}

// ── Comments ───────────────────────────────────────────────────────────────
async function loadComments() {
  try {
    const comments = await api(`/proofs/${PROOF_ID}/comments?sort=${commentSort}`);
    const list = el('comments-list');
    if (!list) return;
    if (!comments.length) {
      list.innerHTML = '<p class="text-muted text-sm">Chưa có bình luận nào. Hãy thêm ngữ cảnh đầu tiên.</p>';
      el('count-comments').textContent = '0';
      return;
    }
    el('count-comments').textContent = comments.length;
    list.innerHTML = comments.map(c => `
      <div class="comment">
        <div class="comment-header">
          <strong style="font-size:13px">${escapeHtml(c.author_name || 'Ẩn danh')}</strong>
          <span class="text-muted text-xs">${timeAgo(c.created_at)}</span>
          ${c.signature_verified ? '<span class="badge badge-green" style="font-size:10px">✓ Signed</span>' : ''}
          ${c.collapsed ? '<span class="badge badge-amber">Flagged</span>' : ''}
        </div>
        <div class="comment-body">${c.collapsed ? '<em class="text-muted">[Đã ẩn — bị cộng đồng gắn cờ]</em>' : escapeHtml(c.body)}</div>
        <div class="comment-actions">
          <button class="btn-link" onclick="usefulComment('${c.id}')">↑ Hữu ích (${c.useful_count || 0})</button>
          ${isLoggedIn() ? `<button class="btn-link danger" onclick="flagComment('${c.id}')">Gắn cờ</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch {}
}

async function submitComment() {
  if (!isLoggedIn()) { window.location.href = '/login.html?next=' + encodeURIComponent(location.href); return; }
  const inp = el('comment-input');
  const body = inp?.value?.trim();
  if (!body) return;
  try {
    await api(`/proofs/${PROOF_ID}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    inp.value = '';
    loadComments();
    toast('Đã đăng bình luận');
  } catch (e) { toast(e.message, 'error'); }
}

async function usefulComment(id) {
  if (!isLoggedIn()) { window.location.href = '/login.html'; return; }
  await api(`/proofs/${PROOF_ID}/comments/${id}/useful`, { method: 'POST' }).catch(() => {});
  loadComments();
}

async function flagComment(id) {
  if (!isLoggedIn()) return;
  await api('/flags', { method: 'POST', body: JSON.stringify({ targetType: 'comment', targetId: id, reason: 'spam' }) }).catch(() => {});
  toast('Đã gắn cờ bình luận');
}

function setSortComments(sort) {
  commentSort = sort;
  qsa('[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  loadComments();
}

// ── Flags ──────────────────────────────────────────────────────────────────
function openFlagModal() {
  if (!isLoggedIn()) { window.location.href = '/login.html?next=' + encodeURIComponent(location.href); return; }
  el('flag-modal').classList.add('open');
}
function closeFlagModal() { el('flag-modal').classList.remove('open'); }

async function submitFlag() {
  const reason = el('flag-reason').value;
  if (!reason) { toast('Vui lòng chọn lý do.', 'error'); return; }
  try {
    await api('/flags', { method: 'POST', body: JSON.stringify({ targetType: 'proof', targetId: PROOF_ID, reason }) });
    closeFlagModal();
    el('flag-thanks').style.display = 'block';
    toast('Đã gắn cờ proof');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Tech panel ─────────────────────────────────────────────────────────────
function toggleTech() {
  const d = el('tech-details');
  const btn = el('tech-toggle');
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  btn.textContent = open ? 'Hiện' : 'Ẩn';
}

function copyHash() {
  const h = proofData?.sha256_hash;
  if (h) navigator.clipboard.writeText(h).then(() => toast('Đã sao chép hash'));
}

// ── Owner actions ──────────────────────────────────────────────────────────
async function removeProof() {
  if (!confirm('Xóa proof này khỏi FileProof? File gốc vẫn được lưu trong storage.')) return;
  try {
    await api(`/proofs/${PROOF_ID}/remove-from-app`, { method: 'DELETE' });
    toast('Đã xóa proof');
    setTimeout(() => window.location.href = '/dashboard.html', 800);
  } catch (e) { toast(e.message, 'error'); }
}

function copyProofLink() {
  navigator.clipboard.writeText(window.location.href).then(() => toast('Đã sao chép link'));
}

// ── Load proof ─────────────────────────────────────────────────────────────
async function loadProof() {
  if (!PROOF_ID) {
    showError('Thiếu proof ID', '');
    return;
  }
  try {
    const proof = await api(`/proofs/${PROOF_ID}`);
    proofData = proof;

    document.title = proof.title + ' — FileProof';

    el('proof-loading').style.display = 'none';
    el('proof-content').style.display = 'block';

    // Header
    el('proof-title').textContent = proof.title;
    el('proof-meta').textContent = `Lưu trữ ${formatDateLong(proof.created_at)} · ${proof.submitter_type === 'account' ? (proof.owner_name || 'User') : proof.submitter_type === 'wallet' ? 'Wallet user' : 'Ẩn danh'}`;
    el('visibility-badge').textContent = capitalize(proof.visibility);

    // Details
    el('d-filename').textContent = proof.file_name;
    el('d-filetype').textContent = proof.file_type;
    el('d-filesize').textContent = formatBytes(proof.file_size);
    el('d-created').textContent = formatDate(proof.created_at);
    el('d-visibility').textContent = capitalize(proof.visibility);
    el('d-storage').textContent = proof.storage_provider || 'shelby';

    if (proof.location_text) {
      el('d-location-row').style.display = '';
      el('d-location').textContent = proof.location_text;
    }
    if (proof.event_date) {
      el('d-event-row').style.display = '';
      el('d-event-date').textContent = formatDate(proof.event_date);
    }
    if (proof.category) {
      el('d-category-row').style.display = '';
      el('d-category').textContent = proof.category;
    }

    // Tags
    const tags = Array.isArray(proof.tags) ? proof.tags : JSON.parse(proof.tags || '[]');
    if (tags.length) {
      el('proof-tags-row').innerHTML = tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    }

    // Tech
    el('tech-hash').textContent = proof.sha256_hash;
    el('tech-blob').textContent = proof.shelby_blob_id || '—';
    el('tech-id').textContent = proof.id;

    // Description
    if (proof.description) {
      el('proof-description-card').style.display = 'block';
      el('proof-description').textContent = proof.description;
    }

    // Download
    el('btn-download').href = `/api/proofs/${PROOF_ID}/download`;

    // Warning
    renderWarning(proof);

    // Media
    renderMedia(proof);

    // Reactions + comments
    loadReactions();
    loadComments();
    el('count-flags').textContent = proof.flag_count || 0;

    // File compare
    el('verify-file-input')?.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) compareFile(f);
    });

    // Owner controls
    const user = getUser();
    if (user && proof.owner_id === user.id) {
      el('owner-controls').style.display = 'block';
    }

  } catch (e) {
    showError('Không tìm thấy proof', e.message);
  }
}

function showError(title, msg) {
  el('proof-loading').style.display = 'none';
  el('proof-error').style.display = 'block';
  el('proof-error-title').textContent = title;
  el('proof-error-msg').textContent = msg;
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadProof();
  el('comment-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment();
  });
  // Close modal on backdrop click
  el('flag-modal')?.addEventListener('click', e => { if (e.target === el('flag-modal')) closeFlagModal(); });
});
