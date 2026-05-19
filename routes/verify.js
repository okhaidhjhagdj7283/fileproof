const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/hash/:hash', (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, sha256_hash, created_at, visibility, status
      FROM proofs WHERE sha256_hash = ? AND status = 'active'
    `).all(req.params.hash);
    res.json({ match: proofs.length > 0, proofs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/proof/:id', (req, res) => {
  try {
    const proof = db.prepare(`SELECT id, title, sha256_hash, file_name, file_size, file_type, status FROM proofs WHERE id = ?`).get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
