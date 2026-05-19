const express = require('express');
const router = express.Router();
const db = require('../database/db');
const storage = require('../services/storage/shelbyStorage');

// GET /api/verify/hash/:hash — verify by SHA-256 hash
router.get('/hash/:hash', (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, sha256_hash,
             created_at, visibility, status, storage_provider, shelby_blob_id
      FROM proofs WHERE sha256_hash = ? AND status = 'active'
    `).all(req.params.hash);
    res.json({ match: proofs.length > 0, proofs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verify/proof/:id — get proof for verification
router.get('/proof/:id', (req, res) => {
  try {
    const proof = db.prepare(`
      SELECT id, title, sha256_hash, file_name, file_size, file_type, status,
             storage_provider, shelby_blob_id, created_at
      FROM proofs WHERE id = ?
    `).get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'active') return res.status(404).json({ error: 'Proof not active' });
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verify/resolve-proof — resolve proof from URL or ID
router.post('/resolve-proof', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'Input required' });

    // Extract proof ID from URL or use directly
    let proofId = input.trim();
    const match = proofId.match(/[?&]id=([a-f0-9-]{36})/i) || proofId.match(/\/p\/([a-f0-9-]{36})/i);
    if (match) proofId = match[1];

    // UUID-like check
    if (!/^[0-9a-f-]{36}$/i.test(proofId)) {
      return res.status(400).json({ error: 'Invalid proof ID or URL' });
    }

    const proof = db.prepare(`
      SELECT id, title, sha256_hash, file_name, file_size, file_type, status,
             storage_provider, shelby_blob_id, visibility, created_at
      FROM proofs WHERE id = ?
    `).get(proofId);

    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'active') return res.status(404).json({ error: 'Proof not available' });
    if (proof.visibility === 'private') return res.status(403).json({ error: 'This proof is private' });

    const downloadUrl = await storage.getDownloadUrl({
      shelbyBlobId: proof.shelby_blob_id || `local://${proof.file_name}`
    }).catch(() => null);

    res.json({ ...proof, download_url: downloadUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
