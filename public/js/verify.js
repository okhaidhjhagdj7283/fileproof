let resolvedProof = null;

async function resolveProof() {
  const input = document.getElementById('proof-input')?.value?.trim();
  if (!input) return;

  const resultEl = document.getElementById('resolve-result');
  resultEl.innerHTML = '<span style="color:var(--muted)">Looking up proof…</span>';
  document.getElementById('compare-section').style.display = 'none';

  try {
    resolvedProof = await api('/verify/resolve-proof', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });

    resultEl.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:22px;">${fileIcon(resolvedProof.file_type)}</span>
          <div>
            <strong>${escapeHtml(resolvedProof.title)}</strong>
            <div style="font-size:13px;color:var(--muted)">Preserved ${formatDate(resolvedProof.created_at)}</div>
          </div>
        </div>
        <div class="hash-box" style="margin-top:8px;">
          <div class="hash-label">SHA-256 fingerprint</div>
          <div class="hash-value">${resolvedProof.sha256_hash}</div>
        </div>
        <a href="/proof.html?id=${resolvedProof.id}" class="btn btn-secondary btn-sm" style="margin-top:10px;">View proof page</a>
      </div>`;

    document.getElementById('compare-section').style.display = '';
  } catch (e) {
    const msgs = {
      'Proof not found': 'No proof found with this ID or link.',
      'This proof is private': 'This proof is private and cannot be verified publicly.',
    };
    resultEl.innerHTML = `<div class="alert alert-error"><span>✕</span><span>${msgs[e.message] || e.message}</span></div>`;
  }
}

document.getElementById('verify-upload')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !resolvedProof) return;

  const resultEl = document.getElementById('compare-result');
  resultEl.innerHTML = '<span style="color:var(--muted)">Computing file fingerprint…</span>';
  resultEl.style.display = '';

  try {
    const hash = await sha256File(file);
    if (hash === resolvedProof.sha256_hash) {
      resultEl.innerHTML = `
        <div class="verify-result verify-success">
          <div class="verify-result-icon">✓</div>
          <div>
            <strong>Match.</strong>
            <p>Your file is identical to the preserved original.</p>
            <div class="hash-box" style="margin-top:10px;">
              <div class="hash-label">Computed SHA-256</div>
              <div class="hash-value">${hash}</div>
            </div>
          </div>
        </div>`;
    } else {
      resultEl.innerHTML = `
        <div class="verify-result verify-fail">
          <div class="verify-result-icon">✕</div>
          <div>
            <strong>Not a match.</strong>
            <p>Your file may have been edited, compressed, cropped, or replaced.</p>
            <div style="margin-top:8px;font-size:13px;color:var(--muted);">
              <div>Your file: <span class="mono">${hash.slice(0,16)}…</span></div>
              <div>Original: <span class="mono">${resolvedProof.sha256_hash.slice(0,16)}…</span></div>
            </div>
          </div>
        </div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-error"><span>✕</span><span>Error: ${escapeHtml(err.message)}</span></div>`;
  }
});

// Allow pressing Enter in input
document.getElementById('proof-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') resolveProof();
});
