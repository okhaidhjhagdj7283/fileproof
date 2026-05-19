const express = require('express');
const router = express.Router();
const db = require('../database/db');
const storage = require('../services/storage/shelbyStorage');
const { optionalAuth } = require('../middleware/auth');

// GET /api/verify/hash/:hash
router.get('/hash/:hash', (req, res) => {
  try {
    const { hash } = req.params;
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      return res.status(400).json({ error: 'Invalid SHA-256 hash format' });
    }
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, sha256_hash,
             created_at, visibility, status, storage_provider, shelby_blob_id
      FROM proofs WHERE sha256_hash = ? AND status = 'active' AND visibility != 'private'
    `).all(hash);
    res.json({ match: proofs.length > 0, proofs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verify/proof/:id
router.get('/proof/:id', optionalAuth, (req, res) => {
  try {
    const proof = db.prepare(`
      SELECT id, title, sha256_hash, file_name, file_size, file_type, status,
             storage_provider, shelby_blob_id, created_at, visibility
      FROM proofs WHERE id = ?
    `).get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'active') return res.status(404).json({ error: 'Proof not available' });
    if (proof.visibility === 'private') {
      if (!req.user) return res.status(403).json({ error: 'This proof is private' });
    }
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verify/resolve-proof
// Input: { input: "https://fileproof.xyz/proof.html?id=xxx" | "proof_id_uuid" }
router.post('/resolve-proof', optionalAuth, async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'input required' });

    let proofId = input.trim();

    // Extract from URL patterns
    const urlMatch = proofId.match(/[?&]id=([0-9a-f-]{36})/i)
      || proofId.match(/\/p\/([0-9a-f-]{36})/i)
      || proofId.match(/\/proof\.html[^/]*[?&]id=([0-9a-f-]{36})/i);
    if (urlMatch) proofId = urlMatch[1];

    if (!/^[0-9a-f-]{36}$/i.test(proofId)) {
      return res.status(400).json({ error: 'Invalid proof ID or URL format' });
    }

    const proof = db.prepare(`
      SELECT id, title, sha256_hash, file_name, file_size, file_type, status,
             storage_provider, shelby_blob_id, visibility, created_at
      FROM proofs WHERE id = ?
    `).get(proofId);

    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'active') return res.status(404).json({ error: 'Proof not available' });
    if (proof.visibility === 'private') return res.status(403).json({ error: 'This proof is private' });

    let download_url = null;
    try {
      download_url = await storage.getDownloadUrl({ shelbyBlobId: proof.shelby_blob_id });
    } catch {}

    res.json({ ...proof, download_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
