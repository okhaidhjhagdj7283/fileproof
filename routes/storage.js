const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { optionalAuth } = require('../middleware/auth');
const storage = require('../services/storage/shelbyStorage');
const db = require('../database/db');

// ─── Local upload handler (dev fallback only) ─────────────────────────────────
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storage.LOCAL_DIR),
  filename: (req, file, cb) => cb(null, req.params.tempName),
});
const localUpload = multer({ storage: multerStorage });

// PUT /api/storage/local-upload/:tempName
// Used when Shelby is not configured (dev mode).
// Client PUTs file body here, we save to LOCAL_DIR.
router.put('/local-upload/:tempName', (req, res) => {
  const tempName = path.basename(req.params.tempName);
  const destPath = path.join(storage.LOCAL_DIR, tempName);

  const writeStream = fs.createWriteStream(destPath);
  req.pipe(writeStream);

  writeStream.on('finish', () => {
    res.json({
      shelbyBlobId: `local://${tempName}`,
      storageProvider: 'local',
      storageUri: `local://${tempName}`,
    });
  });
  writeStream.on('error', (e) => {
    res.status(500).json({ error: e.message });
  });
});

// POST /api/storage/upload-session
router.post('/upload-session', optionalAuth, async (req, res) => {
  try {
    const { draftId, fileName, fileType, fileSize, sha256Hash } = req.body;

    if (!draftId || !fileName || !fileType || !fileSize || !sha256Hash) {
      return res.status(400).json({ error: 'draftId, fileName, fileType, fileSize, sha256Hash required' });
    }

    // Validate SHA-256 format
    if (!/^[a-f0-9]{64}$/i.test(sha256Hash)) {
      return res.status(400).json({ error: 'Invalid sha256Hash format' });
    }

    const draft = db.prepare('SELECT * FROM proofs WHERE id = ?').get(draftId);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'draft') return res.status(400).json({ error: 'Proof is not a draft' });

    if (draft.owner_id && draft.owner_id !== req.user?.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (draft.sha256_hash !== sha256Hash) {
      return res.status(400).json({ error: 'Hash mismatch with draft record' });
    }

    if (
      draft.file_name !== fileName ||
      draft.file_type !== fileType ||
      Number(draft.file_size) !== Number(fileSize)
    ) {
      return res.status(400).json({ error: 'File metadata mismatch with draft record' });
    }

    const session = await storage.createUploadSession({
      fileName,
      fileType,
      fileSize: Number(fileSize),
      sha256Hash,
      userId: req.user?.id || null,
    });

    res.json({
      uploadSessionId: session.uploadSessionId,
      uploadUrl: session.uploadUrl,
      storageProvider: session.storageProvider,
      _localTempName: session._localTempName || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/storage/confirm-upload
// After client finishes uploading to Shelby/local, call this to get blob ID.
router.post('/confirm-upload', optionalAuth, async (req, res) => {
  try {
    const { uploadSessionId, localTempName } = req.body;
    if (!uploadSessionId) return res.status(400).json({ error: 'uploadSessionId required' });

    const result = await storage.confirmUpload({ uploadSessionId, localTempName });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/storage/blob/:filename — serve local blobs
router.get('/blob/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(storage.LOCAL_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/storage/download-url?blobId=shelby://...
router.get('/download-url', optionalAuth, async (req, res) => {
  try {
    const { blobId } = req.query;
    if (!blobId) return res.status(400).json({ error: 'blobId required' });
    const url = await storage.getDownloadUrl({ shelbyBlobId: blobId });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
