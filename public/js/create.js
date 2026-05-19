let selectedFile = null;
let fileHash = null;
let currentStep = 1;

const dropZone = el('drop-zone');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
el('file-input').addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  selectedFile = file;
  fileHash = null;
  el('btn-next-1').disabled = true;

  el('drop-zone').style.display = 'none';
  el('file-preview').style.display = 'block';
  el('side-empty').style.display = 'none';
  el('side-info').style.display = 'block';

  el('preview-icon').textContent = fileIcon(file.type);
  el('preview-name').textContent = file.name;
  el('preview-meta').textContent = `${file.type || 'unknown'} · ${formatBytes(file.size)}`;
  el('side-filename').textContent = file.name;
  el('side-filesize').textContent = formatBytes(file.size);
  el('side-hash').textContent = 'đang tính...';

  if (file.type.startsWith('image/')) {
    el('img-preview-wrap').style.display = 'block';
    el('img-preview').src = URL.createObjectURL(file);
  } else {
    el('img-preview-wrap').style.display = 'none';
  }

  el('hash-status').textContent = 'Đang tính SHA-256 fingerprint...';
  el('hash-progress').style.width = '30%';
  el('hash-box').style.display = 'none';
  el('hash-pct').textContent = '';

  try {
    const hash = await sha256File(file);
    fileHash = hash;
    el('hash-progress').style.width = '100%';
    el('hash-status').textContent = 'Fingerprint đã sẵn sàng';
    el('hash-pct').textContent = '✓';
    el('hash-value').textContent = hash;
    el('hash-box').style.display = 'block';
    el('side-hash').textContent = hash.slice(0, 16) + '...';
    el('btn-next-1').disabled = false;
  } catch (e) {
    el('hash-status').textContent = 'Lỗi khi tính hash: ' + e.message;
    el('hash-progress').style.width = '100%';
    el('hash-progress').style.background = 'var(--red)';
  }
}

function clearFile() {
  selectedFile = null;
  fileHash = null;
  el('file-input').value = '';
  el('drop-zone').style.display = 'block';
  el('file-preview').style.display = 'none';
  el('side-empty').style.display = 'block';
  el('side-info').style.display = 'none';
  el('btn-next-1').disabled = true;
  el('img-preview-wrap').style.display = 'none';
  el('hash-progress').style.background = 'var(--accent)';
}

function goStep(n) {
  if (n === 2 && !selectedFile) return;
  if (n === 3) {
    const title = el('f-title').value.trim();
    if (!title) {
      showAlert(el('alert-box'), 'Vui lòng nhập tiêu đề cho proof.', 'error');
      return;
    }
    el('alert-box').innerHTML = '';
    fillConfirm();
  }

  currentStep = n;
  [1,2,3].forEach(i => {
    el(`step-${i}`).style.display = i === n ? 'block' : 'none';
    const tab = el(`tab-${i}`);
    tab.className = 'step-tab' + (i === n ? ' active' : i < n ? ' done' : '');
  });
}

function fillConfirm() {
  el('confirm-icon').textContent = fileIcon(selectedFile.type);
  el('confirm-title').textContent = el('f-title').value;
  el('confirm-meta').textContent = `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
  el('confirm-hash').textContent = fileHash;
  el('c-title').textContent = el('f-title').value;
  el('c-category').textContent = el('f-category').value || '—';
  el('c-visibility').textContent = el('f-visibility').value;
  el('c-submitter').textContent = el('f-submitter').value;
  el('c-location').textContent = el('f-location').value || '—';
}

async function submitProof() {
  if (!selectedFile || !fileHash) return;
  const title = el('f-title').value.trim();
  if (!title) return;

  el('btn-submit').disabled = true;
  el('upload-progress').style.display = 'block';
  el('upload-status').textContent = 'Đang tải file lên...';
  el('upload-bar').style.width = '20%';

  const tags = el('f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const fd = new FormData();
  fd.append('file', selectedFile);
  fd.append('title', title);
  fd.append('description', el('f-desc').value);
  fd.append('category', el('f-category').value);
  fd.append('visibility', el('f-visibility').value);
  fd.append('tags', JSON.stringify(tags));
  fd.append('event_date', el('f-event-date').value);
  fd.append('location_text', el('f-location').value);
  fd.append('submitter_type', el('f-submitter').value);
  fd.append('client_hash', fileHash);
  if (el('f-collection').value) fd.append('collection_id', el('f-collection').value);

  try {
    el('upload-bar').style.width = '60%';
    el('upload-status').textContent = 'Đang lưu proof record...';
    const data = await apiForm('/proofs', fd);
    el('upload-bar').style.width = '100%';
    el('upload-status').textContent = 'Hoàn tất!';
    setTimeout(() => { window.location.href = `/proof.html?id=${data.id}`; }, 600);
  } catch (e) {
    el('btn-submit').disabled = false;
    el('upload-progress').style.display = 'none';
    showAlert(el('alert-box'), 'Lỗi: ' + e.message, 'error');
    goStep(3);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (user) {
    const opt = el('f-submitter');
    opt.querySelector('[value="account"]').textContent = `Tài khoản: ${user.display_name || user.email}`;
    api('/collections/user/mine').then(cols => {
      const sel = el('f-collection');
      cols.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      });
    }).catch(() => {});
  }
});
