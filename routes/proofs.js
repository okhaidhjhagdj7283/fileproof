const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate, optionalAuth } = require('../middleware/auth');
const storage = require('../services/storage/shelbyStorage');
const config = require('../config/env');

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  'image/', 'video/', 'audio/', 'application/pdf',
  'application/zip', 'application/x-zip', 'application/gzip',
  'application/msword', 'application/vnd.openxmlformats',
  'application/vnd.ms-', 'text/plain', 'text/csv',
];

const VALID_VISIBILITY = ['public', 'unlisted', 'private'];
const VALID_SUBMITTER = ['anonymous', 'account', 'wallet'];
const VALID_SORT = { newest: 'p.created_at DESC', useful: 'p.useful_count DESC', discussed: 'p.comment_count DESC', views: 'p.view_count DESC' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateFileType(mimeType) {
  return ALLOWED_TYPES.some(t => mimeType.startsWith(t));
}

function validateSHA256(hash) {
  return /^[a-f0-9]{64}$/i.test(hash);
}

function canViewProof(user, proof) {
  if (proof.visibility === 'public' || proof.visibility === 'unlisted') return true;
  if (proof.visibility === 'private') return user && user.id === proof.owner_id;
  return false;
}

function hashStream(stream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function recalcCommunityStatus(proofId) {
  const proof = db.prepare('SELECT id, flag_count FROM proofs WHERE id = ?').get(proofId);
  if (!proof) return;
  let community_status = 'normal';
  if (proof.flag_count >= 10) community_status = 'hidden_by_filter';
  else if (proof.flag_count >= 5) community_status = 'sensitive';
  else if (proof.flag_count >= 3) community_status = 'community_flagged';
  db.prepare(`UPDATE proofs SET community_status = ? WHERE id = ?`).run(community_status, proofId);
}

// ─── LIST public proofs ───────────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, collection_id, sort = 'newest' } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
    const lim = Math.min(100, parseInt(limit) || 20);

    let where = `p.status = 'active' AND p.visibility = 'public' AND p.community_status != 'hidden_by_filter'`;
    const params = [];

    if (category) { where += ` AND p.category = ?`; params.push(category); }
    if (search) { where += ` AND (p.title LIKE ? OR p.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    if (collection_id) { where += ` AND cp.collection_id = ?`; params.push(collection_id); }

    const joinClause = collection_id ? `JOIN collection_proofs cp ON p.id = cp.proof_id` : '';
    const order = VALID_SORT[sort] || VALID_SORT.newest;

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
    `).all(...params, lim, offset);

    const total = db.prepare(`SELECT COUNT(*) as c FROM proofs p ${joinClause} WHERE ${where}`).get(...params).c;

    res.json({
      proofs: proofs.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') })),
      total,
      page: parseInt(page),
      pages: Math.ceil(total / lim),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CREATE DRAFT ─────────────────────────────────────────────────────────────
// POST /api/proofs/draft
// Body: { fileName, fileSize, fileType, sha256Hash }
router.post('/draft', optionalAuth, (req, res) => {
  try {
    const { fileName, fileSize, fileType, sha256Hash } = req.body;

    if (!fileName || !fileSize || !fileType || !sha256Hash) {
      return res.status(400).json({ error: 'fileName, fileSize, fileType, sha256Hash required' });
    }

    if (!validateSHA256(sha256Hash)) {
      return res.status(400).json({ error: 'Invalid sha256Hash — must be 64 hex characters' });
    }

    if (!validateFileType(fileType)) {
      return res.status(400).json({ error: `Unsupported file type: ${fileType}` });
    }

    if (Number(fileSize) > config.maxFileSize) {
      return res.status(400).json({ error: `File too large. Max: ${config.maxFileSize / 1024 / 1024}MB` });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO proofs (
        id, owner_id, title, file_name, file_size, file_type,
        sha256_hash, storage_provider, visibility, submitter_type,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.user?.id || null,
      'Untitled proof',
      fileName,
      Number(fileSize),
      fileType,
      sha256Hash,
      'shelby',
      'unlisted',
      req.user ? 'account' : 'anonymous',
      'draft',
      now,
      now,
    );

    res.json({ draftId: id, status: 'draft' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── COMPLETE PROOF ───────────────────────────────────────────────────────────
// POST /api/proofs/:id/complete
router.post('/:id/complete', optionalAuth, async (req, res) => {
  try {
    const draft = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'draft') return res.status(400).json({ error: 'Proof is not a draft' });

    if (draft.owner_id && draft.owner_id !== req.user?.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      title, description, category, tags, visibility,
      eventDate, location_text, locationText,
      sha256Hash, shelbyBlobId, storageUri,
      submitterType, collection_id,
      wallet_address, wallet_signature,
    } = req.body;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!VALID_VISIBILITY.includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be public, unlisted, or private' });
    }

    const subType = VALID_SUBMITTER.includes(submitterType) ? submitterType : 'anonymous';

    if (sha256Hash && sha256Hash !== draft.sha256_hash) {
      return res.status(400).json({ error: 'Hash mismatch with draft record' });
    }

    if (!shelbyBlobId) {
      return res.status(400).json({ error: 'shelbyBlobId is required — upload the file first' });
    }

    // Verify blob exists in storage
    const meta = await storage.getBlobMetadata({ shelbyBlobId });
    if (!meta.exists) {
      return res.status(400).json({ error: 'Blob not found in storage — upload may have failed' });
    }

    const normalizedTags = Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []);
    const locText = locationText || location_text || null;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE proofs SET
        title = ?,
        description = ?,
        category = ?,
        tags = ?,
        visibility = ?,
        event_date = ?,
        location_text = ?,
        shelby_blob_id = ?,
        storage_uri = ?,
        storage_provider = 'shelby',
        submitter_type = ?,
        wallet_address = ?,
        wallet_signature = ?,
        status = 'active',
        updated_at = ?
      WHERE id = ?
    `).run(
      title.trim(),
      description || null,
      category || null,
      JSON.stringify(normalizedTags),
      visibility,
      eventDate || null,
      locText,
      shelbyBlobId,
      storageUri || shelbyBlobId,
      subType,
      wallet_address || null,
      wallet_signature || null,
      now,
      draft.id,
    );

    // Add to collection if provided
    if (collection_id) {
      const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(collection_id);
      if (col) {
        const exists = db.prepare('SELECT id FROM collection_proofs WHERE collection_id = ? AND proof_id = ?').get(collection_id, draft.id);
        if (!exists) {
          const cpStatus = col.owner_id === req.user?.id || !col.require_approval ? 'approved' : 'pending';
          db.prepare(`INSERT INTO collection_proofs (id, collection_id, proof_id, status, added_by_user_id, added_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), collection_id, draft.id, cpStatus, req.user?.id || null, now);
        }
      }
    }

    // Update reputation
    if (draft.owner_id) {
      db.prepare(`
        INSERT INTO user_reputation (user_id, proof_count, updated_at) VALUES (?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET proof_count = proof_count + 1, updated_at = excluded.updated_at
      `).run(draft.owner_id, now);
    }

    res.json({
      proofId: draft.id,
      proofUrl: `/proof.html?id=${draft.id}`,
      status: 'active',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET PROOF ────────────────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const proof = db.prepare(`
      SELECT p.*, u.display_name as owner_name
      FROM proofs p LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    if (proof.status === 'draft') return res.status(403).json({ error: 'This proof has not been published yet' });
    if (proof.status === 'removed_from_app_view') return res.status(404).json({ error: 'This proof is no longer available' });

    if (!canViewProof(req.user, proof)) {
      return res.status(403).json({ error: 'This proof is private' });
    }

    db.prepare('UPDATE proofs SET view_count = view_count + 1 WHERE id = ?').run(proof.id);
    proof.tags = JSON.parse(proof.tags || '[]');

    if (req.user) {
      const reaction = db.prepare('SELECT type FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(proof.id, req.user.id);
      proof.my_reaction = reaction?.type || null;
    }

    // Attach download URL
    try {
      proof.download_url = await storage.getDownloadUrl({ shelbyBlobId: proof.shelby_blob_id });
    } catch {
      proof.download_url = null;
    }

    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── UPDATE PROOF METADATA ────────────────────────────────────────────────────
router.patch('/:id', authenticate, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { title, description, category, tags, visibility, event_date, location_text } = req.body;

    if (visibility && !VALID_VISIBILITY.includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

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
      title || null,
      description || null,
      category || null,
      tags ? JSON.stringify(Array.isArray(tags) ? tags : [tags]) : null,
      visibility || null,
      event_date || null,
      location_text || null,
      proof.id,
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REMOVE FROM APP VIEW ─────────────────────────────────────────────────────
router.post('/:id/remove-from-app-view', authenticate, (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof) return res.status(404).json({ error: 'Not found' });
    if (proof.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    db.prepare(`UPDATE proofs SET status = 'removed_from_app_view', updated_at = datetime('now') WHERE id = ?`).run(proof.id);
    res.json({ success: true, message: 'Proof removed from app view. The file remains preserved in storage.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
router.get('/:id/download', optionalAuth, async (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof || proof.status !== 'active') return res.status(404).json({ error: 'Proof not found' });
    if (!canViewProof(req.user, proof)) return res.status(403).json({ error: 'Access denied' });

    if (!proof.shelby_blob_id) return res.status(404).json({ error: 'No storage blob linked to this proof' });

    // Try redirect to signed URL first (faster for large files)
    try {
      const downloadUrl = await storage.getDownloadUrl({ shelbyBlobId: proof.shelby_blob_id });
      // If it's an internal path, serve directly; if external URL, redirect
      if (downloadUrl.startsWith('http')) {
        return res.redirect(302, downloadUrl);
      }
      // Local: stream the file
    } catch {}

    // Stream fallback
    try {
      const stream = await storage.getBlobStream({ shelbyBlobId: proof.shelby_blob_id });
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(proof.file_name)}"`);
      res.setHeader('Content-Type', proof.file_type || 'application/octet-stream');
      if (proof.file_size) res.setHeader('Content-Length', proof.file_size);
      stream.pipe(res);
    } catch (e) {
      res.status(500).json({ error: 'Could not retrieve file from storage' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── VERIFY STORAGE ───────────────────────────────────────────────────────────
// POST /api/proofs/:id/verify-storage
// Backend fetches blob from Shelby, hashes it, compares with stored SHA-256
router.post('/:id/verify-storage', optionalAuth, async (req, res) => {
  try {
    const proof = db.prepare('SELECT * FROM proofs WHERE id = ?').get(req.params.id);
    if (!proof || proof.status !== 'active') return res.status(404).json({ error: 'Proof not found' });
    if (!canViewProof(req.user, proof)) return res.status(403).json({ error: 'Access denied' });

    if (!proof.shelby_blob_id) {
      return res.status(400).json({ error: 'No storage blob linked to this proof' });
    }

    const stream = await storage.getBlobStream({ shelbyBlobId: proof.shelby_blob_id });
    const storageHash = await hashStream(stream);
    const match = storageHash === proof.sha256_hash;

    res.json({
      proofId: proof.id,
      storedHash: proof.sha256_hash,
      storageHash,
      match,
      message: match
        ? 'The file served from storage matches the original proof record.'
        : 'Warning: The file served from storage does not match the original proof record.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── USER'S OWN PROOFS ────────────────────────────────────────────────────────
router.get('/user/mine', authenticate, (req, res) => {
  try {
    const proofs = db.prepare(`
      SELECT id, title, file_name, file_type, file_size, visibility, status,
             view_count, created_at, category, tags, useful_count, question_count,
             comment_count, community_status, shelby_blob_id, storage_provider
      FROM proofs WHERE owner_id = ? AND status != 'removed_from_app_view'
      ORDER BY created_at DESC
    `).all(req.user.id);
    res.json(proofs.map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REACTIONS ────────────────────────────────────────────────────────────────
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
    if (!['useful', 'question'].includes(type)) return res.status(400).json({ error: 'type must be useful or question' });

    const proof = db.prepare('SELECT * FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Not found' });

    const existing = db.prepare('SELECT * FROM proof_reactions WHERE proof_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    const now = new Date().toISOString();

    if (existing) {
      if (existing.type === type) {
        // Toggle off
        db.prepare('DELETE FROM proof_reactions WHERE proof_id = ? AND user_id = ?').run(req.params.id, req.user.id);
        db.prepare(`UPDATE proofs SET ${type}_count = MAX(0, ${type}_count - 1) WHERE id = ?`).run(req.params.id);
        return res.json({ success: true, action: 'removed', type: null });
      } else {
        // Switch
        const oldType = existing.type;
        db.prepare('UPDATE proof_reactions SET type = ?, reason = ?, updated_at = ? WHERE proof_id = ? AND user_id = ?')
          .run(type, reason || null, now, req.params.id, req.user.id);
        db.prepare(`UPDATE proofs SET ${oldType}_count = MAX(0, ${oldType}_count - 1), ${type}_count = ${type}_count + 1 WHERE id = ?`).run(req.params.id);
        return res.json({ success: true, action: 'switched', type });
      }
    }

    db.prepare('INSERT INTO proof_reactions (id, proof_id, user_id, type, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, req.user.id, type, reason || null, now, now);
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
    const { sort = 'newest', parent_id } = req.query;
    const order = sort === 'useful' ? 'c.useful_count DESC' : 'c.created_at DESC';

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
    if (body.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 characters)' });

    const proof = db.prepare('SELECT id FROM proofs WHERE id = ? AND status = ?').get(req.params.id, 'active');
    if (!proof) return res.status(404).json({ error: 'Proof not found' });

    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO proof_comments (id, proof_id, user_id, parent_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.user.id, parent_id || null, body.trim(), now, now);

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
    const now = new Date().toISOString();
    if (existing) {
      db.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?').run(req.params.commentId, req.user.id);
      db.prepare('UPDATE proof_comments SET useful_count = MAX(0, useful_count - 1) WHERE id = ?').run(req.params.commentId);
      return res.json({ success: true, action: 'removed' });
    }
    db.prepare('INSERT INTO comment_reactions (id, comment_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.commentId, req.user.id, 'useful', now);
    db.prepare('UPDATE proof_comments SET useful_count = useful_count + 1 WHERE id = ?').run(req.params.commentId);
    res.json({ success: true, action: 'added' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
