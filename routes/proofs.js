const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate, optionalAuth } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_MB) || 200) * 1024 * 1024 }
});

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

router.get('/', optionalAuth, (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, collection_id } = req.query;
    const offset = (page - 1) * limit;
    let where = `p.status = 'active' AND p.visibility = 'public'`;
    const params = [];

    if (category) { where += ` AND p.category = ?`; params.push(category); }
    if (search) { where += ` AND (p.title LIKE ? OR p.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    if (collection_id) {
      where += ` AND cp.collection_id = ?`;
      params.push(collection_id);
    }

    const joinClause = collection_id ? `JOIN collection_proofs cp ON p.id = cp.proof_id` : '';
    const proofs = db.prepare(`
      SELECT p.id, p.title, p.file_name, p.file_type, p.file_size, p.category,
             p.tags, p.visibility, p.view_count, p.created_at, p.submitter_type,
             u.display_name as owner_name
      FROM proofs p
      LEFT JOIN users u ON p.owner_id = u.id
      ${joinClause}
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    const total = db.prepare(`SELECT COUNT(*) as c FROM proofs p ${joinClause} WHERE ${where}`).get(...params).c;
    res.json({ proofs, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', optionalAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { title, description, category, tags, visibility, event_date, location_text,
            submitter_type, wallet_address, wallet_signature, collection_id, client_hash } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const sha256_hash = await hashFile(req.file.path);

    if (client_hash && client_hash !== sha256_hash) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File hash mismatch — upload may be corrupted' });
    }

    const id = uuidv4();
    const owner_id = req.user?.id || null;

    db.prepare(`
      INSERT INTO proofs (id, owner_id, title, description, file_name, file_size, file_type,
        file_path, sha256_hash, visibility, category, tags, event_date, location_text,
        submitter_type, wallet_address, wallet_signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, owner_id, title, description || null,
      req.file.originalname, req.file.size, req.file.mimetype,
      req.file.filename, sha256_hash,
      visibility || 'public', category || null,
      tags || '[]', event_date || null, location_text || null,
      submitter_type || 'anonymous', wallet_address || null, wallet_signature || null
    );

    if (collection_id) {
      db.prepare(`INSERT INTO collection_proofs (id, collection_id, proof_id, added_by_user_id) VALUES (?, ?, ?, ?)`)
        .run(uuidv4(), collection_id, id, owner_id);
    }

    res.json({ id, url: `/proof.html?id=${id}` });
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', optionalAuth, (req, res) => {
  try {
    const proof = db.prepare(`
      SELECT p.*, u.display_name as owner_name, u.email as owner_email
      FROM proofs p LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status !== 'active') return res.status(404).json({ error: 'This proof is no longer available' });
    if (proof.visibility === 'private') {
      if (!req.user || req.user.id !== proof.owner_id)
        return res.status(403).json({ error: 'This proof is private' });
    }

    db.prepare('UPDATE proofs SET view_count = view_count + 1 WHERE id = ?').run(proof.id);
    proof.tags = JSON.parse(proof.tags || '[]');
    delete proof.file_path;
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { title, description, category, tags, visibility, event_date, location_text } = req.body;
    db.prepare(`
      UPDATE proofs SET title = COALESCE(?, title), description = COALESCE(?, description),
      category = COALESCE(?, category), tags = COALESCE(?, tags), visibility = COALESCE(?, visibility),
      event_date = COALESCE(?, event_date), location_text = COALESCE(?, location_text),
      updated_at = datetime('now') WHERE id = ?
    `).run(title||null, description||null, category||null, tags||null, visibility||null,
           event_date||null, location_text||null, proof.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db.prepare(`UPDATE proofs SET status = 'removed_from_app', updated_at = datetime('now') WHERE id = ?`).run(proof.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/download', optionalAuth, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.visibility === 'private' && (!req.user || req.user.id !== proof.owner_id))
      return res.status(403).json({ error: 'Private' });

    const filePath = path.join(uploadDir, proof.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.download(filePath, proof.file_name);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/report', (req, res) => {
  try {
    const { reason, details } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    db.prepare('INSERT INTO reports (id, proof_id, reason, details, reporter_ip) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, reason, details || null, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/user/mine', authenticate, (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, visibility, status, view_count, created_at, category, tags
      FROM proofs WHERE owner_id = ? AND status != 'removed_from_app'
      ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(proofs.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
