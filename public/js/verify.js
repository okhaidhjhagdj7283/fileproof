let foundProof = null;
let uploadedHash = null;

async function lookupProof() {
  const raw = el('proof-link').value.trim();
  if (!raw) return;

  let proofId = raw;
  try {
    const url = new URL(raw.includes('://') ? raw : 'https://x.com/' + raw);
    proofId = url.searchParams.get('id') || raw;
  } catch {}

  el('proof-found').style.display = 'none';
  el('proof-lookup-error').style.display = 'none';

  try {
    const data = await api(`/verify/proof/${proofId}`);
    foundProof = data;
    el('pf-title').textContent = data.title;
    el('pf-meta').textContent = `${data.file_name} · ${formatBytes(data.file_size)}`;
    el('pf-hash').textContent = data.sha256_hash;
    el('proof-found').style.display = 'block';
    checkReady();
  } catch (e) {
    el('proof-lookup-error').style.display = 'block';
    el('proof-lookup-error').textContent = 'Không tìm thấy proof: ' + e.message;
  }
}

const drop = el('verify-drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag-over'); handleVerifyFile(e.dataTransfer.files[0]); });
el('verify-file').addEventListener('change', e => { if (e.target.files[0]) handleVerifyFile(e.target.files[0]); });

async function handleVerifyFile(file) {
  uploadedHash = null;
  el('verify-file-info').style.display = 'block';
  el('vf-icon').textContent = fileIcon(file.type);
  el('vf-name').textContent = file.name;
  el('vf-size').textContent = formatBytes(file.size);
  el('vf-hash-box').style.display = 'none';
  el('btn-verify').disabled = true;

  const hash = await sha256File(file);
  uploadedHash = hash;
  el('vf-hash').textContent = hash;
  el('vf-hash-box').style.display = 'block';
  checkReady();
}

function checkReady() {
  el('btn-verify').disabled = !(foundProof && uploadedHash);
}

function doVerify() {
  if (!foundProof || !uploadedHash) return;
  const match = uploadedHash === foundProof.sha256_hash;
  const box = el('verify-final');
  if (match) {
    box.innerHTML = `
      <div class="verify-result match">
        <div class="verify-result-icon">✓</div>
        <div class="verify-result-title" style="color:var(--accent)">Khớp! Đây là bản gốc.</div>
        <div class="verify-result-sub">File của bạn có SHA-256 giống hệt bản gốc đã preserved.</div>
        <div style="margin-top:12px">
          <a href="/proof.html?id=${foundProof.id}" class="btn btn-accent btn-sm">Xem proof page →</a>
        </div>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="verify-result no-match">
        <div class="verify-result-icon" style="color:var(--red)">✕</div>
        <div class="verify-result-title" style="color:var(--red)">Không khớp.</div>
        <div class="verify-result-sub">File của bạn khác với bản gốc đã preserved. File có thể đã bị nén, cắt, chỉnh sửa, hoặc là bản sao khác.</div>
        <div class="hash-box mt-2" style="text-align:left">
          <div class="hash-label">Hash file của bạn</div>
          <div class="hash-value">${uploadedHash}</div>
        </div>
        <div class="hash-box mt-1" style="text-align:left">
          <div class="hash-label">Hash bản gốc</div>
          <div class="hash-value">${foundProof.sha256_hash}</div>
        </div>
      </div>`;
  }
}

el('proof-link').addEventListener('keydown', e => { if (e.key === 'Enter') lookupProof(); });

const rawId = new URLSearchParams(location.search).get('id');
if (rawId) { el('proof-link').value = rawId; lookupProof(); }
