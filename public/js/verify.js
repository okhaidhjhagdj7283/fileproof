// ─── FileProof Verify Page ────────────────────────────────────────────────────

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

let resolvedProof = null;

document.addEventListener('DOMContentLoaded', () => {
  const proofInput = document.getElementById('vfy-proof-input');
  const resolveBtn = document.getElementById('vfy-resolve-btn');
  const fileInput = document.getElementById('vfy-file-input');
  const verifyBtn = document.getElementById('vfy-verify-btn');
  const resultBox = document.getElementById('vfy-result');
  const proofCard = document.getElementById('vfy-proof-card');

  // Step 1: Resolve proof
  async function resolveProof() {
    const input = proofInput?.value?.trim();
    if (!input) { showResult('error', 'Please enter a proof link or ID.'); return; }

    resolveBtn.disabled = true;
    resolveBtn.textContent = 'Looking up...';

    try {
      const res = await fetch('/api/verify/resolve-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();

      if (!res.ok) {
        showResult('error', data.error || 'Could not find proof');
        return;
      }

      resolvedProof = data;

      // Show proof card
      if (proofCard) {
        proofCard.innerHTML = `
          <div class="card" style="margin-top:16px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
              <div>
                <div style="font-weight:600;margin-bottom:4px">${data.title}</div>
                <div class="text-muted text-sm">${data.file_name} · ${formatBytes(data.file_size)}</div>
              </div>
              <a href="/proof.html?id=${data.id}" class="btn btn-secondary btn-sm" target="_blank">View proof</a>
            </div>
            <div class="hash-box">
              <div class="hash-label">SHA-256 fingerprint</div>
              <div class="hash-value mono">${data.sha256_hash}</div>
            </div>
          </div>
        `;
        proofCard.style.display = 'block';
      }

      // Enable file compare
      if (fileInput) fileInput.parentElement.style.display = 'block';
      if (verifyBtn) verifyBtn.style.display = 'block';

      showResult('info', 'Proof found. Now upload your file to compare.');

    } catch (e) {
      showResult('error', e.message || 'Network error');
    } finally {
      resolveBtn.disabled = false;
      resolveBtn.textContent = 'Find Proof';
    }
  }

  // Step 2: Compare file
  async function verifyFile() {
    if (!resolvedProof) { showResult('error', 'Resolve a proof first.'); return; }
    const file = fileInput?.files[0];
    if (!file) { showResult('error', 'Please select a file to compare.'); return; }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Hashing...';
    showResult('progress', 'Generating fingerprint of your file...');

    try {
      const hash = await hashFileSHA256(file);

      if (hash === resolvedProof.sha256_hash) {
        showResult('success', `
          <strong>Match.</strong>
          Your file is identical to the preserved original.
          <div class="hash-compare" style="margin-top:8px">
            <code style="font-size:11px;word-break:break-all">${hash}</code>
          </div>
        `);
      } else {
        showResult('fail', `
          <strong>Not a match.</strong>
          Your file may have been edited, compressed, cropped, or replaced.
          <div class="hash-compare" style="margin-top:8px">
            <div class="text-muted text-sm">Original: <code>${resolvedProof.sha256_hash}</code></div>
            <div class="text-muted text-sm">Your file: <code>${hash}</code></div>
          </div>
        `);
      }
    } catch (e) {
      showResult('error', 'Could not hash file: ' + e.message);
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Compare File';
    }
  }

  function showResult(type, html) {
    if (!resultBox) return;
    resultBox.className = `vfy-result vfy-result--${type}`;
    resultBox.innerHTML = html;
    resultBox.style.display = 'block';
  }

  resolveBtn?.addEventListener('click', resolveProof);
  verifyBtn?.addEventListener('click', verifyFile);

  proofInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') resolveProof();
  });

  // Show file name when selected
  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    const label = document.getElementById('vfy-file-label');
    if (label && f) label.textContent = `${f.name} (${formatBytes(f.size)})`;
  });
});
