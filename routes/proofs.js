const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate, optionalAuth } = require('../middleware/auth');
const storage = require('../services/storage/shelbyStorage');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_MB) || 200) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/', 'video/', 'audio/', 'application/pdf',
      'application/zip', 'application/x-zip', 'application/gzip',
      'application/msword', 'application/vnd.openxmlformats',
      'application/vnd.ms-', 'text/plain', 'text/csv',
    ];
    const ok = allowed.some(t => file.mimetype.startsWith(t));
    cb(ok ? null : new Error('File type not supported'), ok);
  }
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

function updateCommunityCounts(proofId) {
  const proof = db.prepare('SELECT id, flag_count FROM proofs WHERE id = ?').get(proofId);
  if (!proof) return;
  let community_status = 'normal';
  if (proof.flag_count >= 10) community_status = 'hidden_by_filter';
  else if (proof.flag_count >= 5) community_status = 'sensitive';
  else if (proof.flag_count >= 3) community_status = 'community_flagged';
  db.prepare(`UPDATE proofs SET community_status = ? WHERE id = ?`).run(community_status, proofId);
}

// ─── LIST public proofs ──────────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, collection_id, sort = 'newest' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = `p.status = 'active' AND p.visibility = 'public' AND p.community_status != 'hidden_by_filter'`;
    const params = [];

    if (category) { where += ` AND p.category = ?`; params.push(category); }
    if (search) { where += ` AND (p.title LIKE ? OR p.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    if (collection_id) { where += ` AND cp.collection_id = ?`; params.push(collection_id); }

    const joinClause = collection_id ? `JOIN collection_proofs cp ON p.id = cp.proof_id` : '';
    const orderMap = { newest: 'p.created_at DESC', useful: 'p.useful_count DESC', discussed: 'p.comment_count DESC', views: 'p.view_count DESC' };
    const order = orderMap[sort] || 'p.created_at DESC';

    const proofs = db.prepare(`
      SELECT p.id, p.title, p.file_name, p.file_type, p.file_size, p.category,
             p.tags, p.visibility, p.view_count, p.created_at, p.submitter_type,
             p.useful_count, p.question_count, p.comment_count, p.community_status,
             p.shelby_blob_id, p.storage_provider,
             u.display_name as owner_name
      FROM proofs p
      LEFT JOIN users u ON p.owner_id = u.id
      ${joinClause}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    const total = db.prepare(`SELECT COUNT(*) as c FROM proofs p ${joinClause} WHERE ${where}`).get(...params).c;
    res.json({ proofs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CREATE DRAFT ────────────────────────────────────────────────────────────
router.post('/draft', optionalAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { client_hash } = req.body;
    const sha256_hash = await hashFile(req.file.path);

    if (client_hash && client_hash !== sha256_hash) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File hash mismatch — upload may be corrupted' });
    }

    // Register with storage layer
    const { shelbyBlobId, storageProvider, storageUri } = await storage.registerUpload({
      localFilePath: req.file.path,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    });

    const id = uuidv4();
    const owner_id = req.user?.id || null;

    db.prepare(`
      INSERT INTO proofs (
        id, owner_id, title, file_name, file_size, file_type,
        sha256_hash, shelby_blob_id, storage_provider, storage_uri,
        status, submitter_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(
      id, owner_id,
      req.file.originalname, // temp title = filename
      req.file.originalname,
      req.file.size,
      req.file.mimetype,
      sha256_hash,
      shelbyBlobId,
      storageProvider,
      storageUri || null,
      owner_id ? 'account' : 'anonymous'
    );

    res.json({
      draftId: id,
      sha256Hash: sha256_hash,
      shelbyBlobId,
      storageProvider,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
    });
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

// ─── COMPLETE PROOF ──────────────────────────────────────────────────────────
router.post('/:id/complete', optionalAuth, async (req, res) => {
  try {
    const draft = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'draft');
    if (!draft) return res.status(404).json({ error: 'Draft not found or already completed' });

    if (draft.owner_id && req.user?.id !== draft.owner_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      title, description, category, tags, visibility,
      event_date, location_text, latitude, longitude,
      submitter_type, wallet_address, wallet_signature,
      collection_id,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const validVisibility = ['public', 'unlisted', 'private'];
    const vis = validVisibility.includes(visibility) ? visibility : 'public';

    const validSubmitterType = ['anonymous', 'account', 'wallet'];
    const subType = validSubmitterType.includes(submitter_type) ? submitter_type : 'anonymous';

    db.prepare(`
      UPDATE proofs SET
        title = ?,
        description = ?,
        category = ?,
        tags = ?,
        visibility = ?,
        event_date = ?,
        location_text = ?,
        latitude = ?,
        longitude = ?,
        submitter_type = ?,
        wallet_address = ?,
        wallet_signature = ?,
        status = 'active',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title,
      description || null,
      category || null,
      JSON.stringify(Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : [])),
      vis,
      event_date || null,
      location_text || null,
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
      subType,
      wallet_address || null,
      wallet_signature || null,
      draft.id
    );

    if (collection_id) {
      const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(collection_id);
      if (col) {
        const exists = db.prepare('SELECT id FROM collection_proofs WHERE collection_id = ? AND proof_id = ?').get(collection_id, draft.id);
        if (!exists) {
          const status = col.owner_id === req.user?.id || !col.require_approval ? 'approved' : 'pending';
          db.prepare('INSERT INTO collection_proofs (id, collection_id, proof_id, status, added_by_user_id) VALUES (?, ?, ?, ?, ?)')
            .run(uuidv4(), collection_id, draft.id, status, req.user?.id || null);
        }
      }
    }

    // Update owner's reputation proof count
    if (draft.owner_id) {
      db.prepare(`
        INSERT INTO user_reputation (user_id, proof_count) VALUES (?, 1)
        ON CONFLICT(user_id) DO UPDATE SET proof_count = proof_count + 1, updated_at = datetime('now')
      `).run(draft.owner_id);
    }

    res.json({ proofId: draft.id, proofUrl: `/proof.html?id=${draft.id}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET PROOF ───────────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const proof = db.prepare(`
      SELECT p.*, u.display_name as owner_name, u.email as owner_email
      FROM proofs p LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status === 'draft') return res.status(403).json({ error: 'This proof is not yet published' });
    if (proof.status === 'removed_from_app') return res.status(404).json({ error: 'This proof is no longer available' });
    if (proof.visibility === 'private') {
      if (!req.user || req.user.id !== proof.owner_id)
        return res.status(403).json({ error: 'This proof is private' });
    }

    db.prepare('UPDATE proofs SET view_count = view_count + 1 WHERE id = ?').run(proof.id);
    proof.tags = JSON.parse(proof.tags || '[]');

    // Include user reaction if logged in
    if (req.user) {
      const reaction = db.prepare('SELECT type FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(proof.id, req.user.id);
      proof.my_reaction = reaction?.type || null;
    }

    // Get download URL from storage layer
    storage.getDownloadUrl({ shelbyBlobId: proof.shelby_blob_id || `local://${proof.file_path}` })
      .then(url => {
        proof.download_url = url;
        delete proof.file_path;
        res.json(proof);
      })
      .catch(() => {
        delete proof.file_path;
        res.json(proof);
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── UPDATE PROOF ────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { title, description, category, tags, visibility, event_date, location_text } = req.body;
    db.prepare(`
      UPDATE proofs SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        tags = COALESCE(?, tags),
        visibility = COALESCE(?, visibility),
        event_date = COALESCE(?, event_date),
        location_text = COALESCE(?, location_text),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title || null, description || null, category || null,
      tags ? JSON.stringify(Array.isArray(tags) ? tags : [tags]) : null,
      visibility || null, event_date || null, location_text || null,
      proof.id
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REMOVE FROM APP ─────────────────────────────────────────────────────────
router.delete('/:id/remove-from-app', authenticate, (req, res) => {
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

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────
router.get('/:id/download', optionalAuth, async (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.visibility === 'private' && (!req.user || req.user.id !== proof.owner_id))
      return res.status(403).json({ error: 'Private' });

    const blobId = proof.shelby_blob_id || `local://${proof.file_path}`;
    const stream = await storage.getBlobStream({ shelbyBlobId: blobId });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(proof.file_name)}"`);
    res.setHeader('Content-Type', proof.file_type);
    if (proof.file_size) res.setHeader('Content-Length', proof.file_size);

    if (stream.pipe) {
      stream.pipe(res);
    } else {
      // Web ReadableStream (Shelby response)
      const { Readable } = require('stream');
      Readable.fromWeb(stream).pipe(res);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SERVE BLOB (local storage) ───────────────────────────────────────────────
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

// ─── REACTIONS (useful / question) ───────────────────────────────────────────
router.get('/:id/reactions/summary', optionalAuth, (req, res) => {
  try {
    const proof = db.prepare('SELECT id, useful_count, question_count FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    let my_reaction = null;
    if (req.user) {
      const r = db.prepare('SELECT type FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(req.params.id, req.user.id);
      my_reaction = r?.type || null;
    }
    res.json({ useful_count: proof.useful_count, question_count: proof.question_count, my_reaction });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reactions', authenticate, (req, res) => {
  try {
    const { type, reason } = req.body;
    if (!['useful', 'question'].includes(type)) return res.status(400).json({ error: 'Invalid reaction type' });

    const proof = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Not found' });

    const existing = db.prepare('SELECT * FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (existing) {
      if (existing.type === type) {
        // Toggle off
        db.prepare('DELETE FROM proof_reactions WHERE proof_id = ? AND user_id = ?').run(req.params.id, req.user.id);
        db.prepare(`UPDATE proofs SET ${type}_count = MAX(0, ${type}_count - 1) WHERE id = ?`).run(req.params.id);
        return res.json({ success: true, action: 'removed', type: null });
      } else {
        // Switch reaction
        const oldType = existing.type;
        db.prepare('UPDATE proof_reactions SET type = ?, reason = ?, updated_at = datetime("now") WHERE proof_id = ? AND user_id = ?')
          .run(type, reason || null, req.params.id, req.user.id);
        db.prepare(`UPDATE proofs SET ${oldType}_count = MAX(0, ${oldType}_count - 1), ${type}_count = ${type}_count + 1 WHERE id = ?`).run(req.params.id);
        return res.json({ success: true, action: 'switched', type });
      }
    }

    db.prepare('INSERT INTO proof_reactions (id, proof_id, user_id, type, reason) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, req.user.id, type, reason || null);
    db.prepare(`UPDATE proofs SET ${type}_count = ${type}_count + 1 WHERE id = ?`).run(req.params.id);
    res.json({ success: true, action: 'added', type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/reactions/me', authenticate, (req, res) => {
  try {
    const r = db.prepare('SELECT type FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!r) return res.json({ success: true });
    db.prepare('DELETE FROM proof_reactions WHERE proof_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    db.prepare(`UPDATE proofs SET ${r.type}_count = MAX(0, ${r.type}_count - 1) WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── COMMENTS ────────────────────────────────────────────────────────────────
router.get('/:id/comments', optionalAuth, (req, res) => {
  try {
    const { sort = 'newest', parent_id = null } = req.query;
    const orderMap = { newest: 'c.created_at DESC', useful: 'c.useful_count DESC' };
    const order = orderMap[sort] || 'c.created_at DESC';

    const comments = db.prepare(`
      SELECT c.id, c.proof_id, c.parent_id, c.body, c.status,
             c.useful_count, c.flag_count, c.created_at, c.wallet_address, c.signature_verified,
             u.display_name as author_name, u.id as author_id
      FROM proof_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.proof_id = ?
        AND c.parent_id IS ${parent_id ? '?' : 'NULL'}
        AND c.status IN ('active', 'flagged')
      ORDER BY ${order}
    `).all(...(parent_id ? [req.params.id, parent_id] : [req.params.id]));

    const result = comments.map(c => {
      const col = { ...c };
      col.collapsed = c.status === 'flagged' && c.flag_count >= 3;
      if (req.user) {
        const r = db.prepare('SELECT type FROM comment_reactions WHERE comment_id = ? AND user_id = ?').get(c.id, req.user.id);
        col.my_reaction = r?.type || null;
      }
      return col;
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/comments', authenticate, (req, res) => {
  try {
    const { body, parent_id } = req.body;
    if (!body || body.trim().length < 1) return res.status(400).json({ error: 'Comment body required' });
    if (body.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 chars)' });

    const proof = db.prepare('SELECT id FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Proof not found' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO proof_comments (id, proof_id, user_id, parent_id, body)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.user.id, parent_id || null, body.trim());

    db.prepare('UPDATE proofs SET comment_count = comment_count + 1 WHERE id = ?').run(req.params.id);

    const comment = db.prepare(`
      SELECT c.*, u.display_name as author_name
      FROM proof_comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ?
    `).get(id);
    res.json(comment);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/comments/:commentId', authenticate, (req, res) => {
  try {
    const comment = db.prepare('SELECT * FROM proof_comments WHERE id = ?').get(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Not found' });
    if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db.prepare(`UPDATE proof_comments SET status = 'deleted_by_author', body = '[deleted]', updated_at = datetime('now') WHERE id = ?`).run(comment.id);
    db.prepare('UPDATE proofs SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').run(comment.proof_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Comment reactions
router.post('/comments/:commentId/reactions', authenticate, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ?').get(req.params.commentId, req.user.id);
    if (existing) {
      db.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?').run(req.params.commentId, req.user.id);
      db.prepare('UPDATE proof_comments SET useful_count = MAX(0, useful_count - 1) WHERE id = ?').run(req.params.commentId);
      return res.json({ success: true, action: 'removed' });
    }
    db.prepare('INSERT INTO comment_reactions (id, comment_id, user_id, type) VALUES (?, ?, ?, ?)').run(uuidv4(), req.params.commentId, req.user.id, 'useful');
    db.prepare('UPDATE proof_comments SET useful_count = useful_count + 1 WHERE id = ?').run(req.params.commentId);
    res.json({ success: true, action: 'added' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── COMMUNITY FLAGS ──────────────────────────────────────────────────────────
router.get('/:id/community-status', (req, res) => {
  try {
    const proof = db.prepare('SELECT id, community_status, flag_count, useful_count, question_count, comment_count FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REPORT / FLAG ────────────────────────────────────────────────────────────
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

// ─── VERIFY STORAGE ───────────────────────────────────────────────────────────
router.post('/:id/verify-storage', optionalAuth, async (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Not found' });

    const blobId = proof.shelby_blob_id || `local://${proof.file_path}`;
    const meta = await storage.getBlobMetadata({ shelbyBlobId: blobId });
    res.json({ available: meta.exists, storageProvider: proof.storage_provider, shelbyBlobId: proof.shelby_blob_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── USER'S OWN PROOFS ────────────────────────────────────────────────────────
router.get('/user/mine', authenticate, (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, visibility, status,
             view_count, created_at, category, tags, useful_count, question_count, comment_count, community_status
      FROM proofs WHERE owner_id = ? AND status != 'removed_from_app'
      ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(proofs.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
