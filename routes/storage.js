const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { optionalAuth } = require('../middleware/auth');
const storage = require('../services/storage/shelbyStorage');

const uploadDir = path.join(__dirname, '../uploads');

// POST /api/storage/upload-session
router.post('/upload-session', optionalAuth, async (req, res) => {
  try {
    const { fileName, fileType, fileSize, sha256Hash } = req.body;
    if (!fileName || !fileType || !fileSize) return res.status(400).json({ error: 'fileName, fileType, fileSize required' });

    const session = await storage.createUploadSession({
      fileName, fileType, fileSize: parseInt(fileSize),
      userId: req.user?.id
    });
    res.json({ ...session, sha256Hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/storage/blob/:filename — serve local blobs
router.get('/blob/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/storage/blob/:shelbyBlobId/download-url
router.get('/blob/:shelbyBlobId/download-url', async (req, res) => {
  try {
    const url = await storage.getDownloadUrl({ shelbyBlobId: req.params.shelbyBlobId });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
