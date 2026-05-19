const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;
    let where = `c.visibility = 'public'`;
    const params = [];
    if (search) { where += ` AND (c.name LIKE ? OR c.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

    const cols = db.prepare(`
      SELECT c.*, u.display_name as owner_name,
        (SELECT COUNT(*) FROM collection_proofs cp WHERE cp.collection_id = c.id AND cp.status = 'approved') as proof_count
      FROM collections c LEFT JOIN users u ON c.owner_id = u.id
      WHERE ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    res.json(cols);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', authenticate, (req, res) => {
  try {
    const { name, description, visibility, category, tags, allow_submissions, require_approval } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    db.prepare(`
      INSERT INTO collections (id, owner_id, name, description, visibility, category, tags, allow_submissions, require_approval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name, description||null, visibility||'public', category||null,
           JSON.stringify(tags||[]), allow_submissions?1:0, require_approval?1:0);
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', optionalAuth, (req, res) => {
  try {
    const col = db.prepare(`
      SELECT c.*, u.display_name as owner_name,
        (SELECT COUNT(*) FROM collection_proofs cp WHERE cp.collection_id = c.id AND cp.status = 'approved') as proof_count
      FROM collections c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = ?
    `).get(req.params.id);
    if (!col) return res.status(404).json({ error: 'Not found' });
    col.tags = JSON.parse(col.tags || '[]');
    res.json(col);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/proofs', optionalAuth, (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT p.id, p.title, p.file_name, p.file_type, p.file_size, p.category,
             p.tags, p.view_count, p.created_at, p.submitter_type, cp.added_at,
             u.display_name as owner_name
      FROM collection_proofs cp
      JOIN proofs p ON cp.proof_id = p.id
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE cp.collection_id = ? AND cp.status = 'approved' AND p.status = 'active'
      ORDER BY cp.added_at DESC
    `).all(req.params.id);
    res.json(proofs.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/proofs', authenticate, (req, res) => {
  try {
    const { proof_id } = req.body;
    if (!proof_id) return res.status(400).json({ error: 'proof_id required' });
    const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    const exists = db.prepare('SELECT id FROM collection_proofs WHERE collection_id = ? AND proof_id = ?').get(req.params.id, proof_id);
    if (exists) return res.status(409).json({ error: 'Already in collection' });
    const status = col.owner_id === req.user.id || !col.require_approval ? 'approved' : 'pending';
    db.prepare('INSERT INTO collection_proofs (id, collection_id, proof_id, status, added_by_user_id) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, proof_id, status, req.user.id);
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, (req, res) => {
  try {
    const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!col || col.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { name, description, visibility, category } = req.body;
    db.prepare(`UPDATE collections SET name=COALESCE(?,name), description=COALESCE(?,description),
      visibility=COALESCE(?,visibility), category=COALESCE(?,category), updated_at=datetime('now') WHERE id=?`)
      .run(name||null, description||null, visibility||null, category||null, col.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/user/mine', authenticate, (req, res) => {
  try {
    const cols = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM collection_proofs cp WHERE cp.collection_id = c.id) as proof_count
      FROM collections c WHERE c.owner_id = ? ORDER BY c.created_at DESC
    `).all(req.user.id);
    res.json(cols.map(c => ({ ...c, tags: JSON.parse(c.tags || '[]') })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
