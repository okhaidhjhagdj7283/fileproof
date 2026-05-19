const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

const FLAG_THRESHOLDS = { warn: 3, sensitive: 5, hide: 10 };

const VALID_REASONS = [
  'spam', 'personal_info', 'illegal_content', 'harassment',
  'copyright', 'misleading_metadata', 'sensitive_content', 'other',
];

function recalcCommunityStatus(targetType, targetId) {
  if (targetType === 'proof') {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM community_flags WHERE target_type = ? AND target_id = ?'
    ).get('proof', targetId).c;

    let community_status = 'normal';
    if (count >= FLAG_THRESHOLDS.hide) community_status = 'hidden_by_filter';
    else if (count >= FLAG_THRESHOLDS.sensitive) community_status = 'sensitive';
    else if (count >= FLAG_THRESHOLDS.warn) community_status = 'community_flagged';

    db.prepare(`
      UPDATE proofs SET flag_count = ?, community_status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(count, community_status, targetId);

  } else if (targetType === 'comment') {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM community_flags WHERE target_type = ? AND target_id = ?'
    ).get('comment', targetId).c;

    const status = count >= 3 ? 'flagged' : 'active';
    db.prepare(`
      UPDATE proof_comments SET flag_count = ?, status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(count, status, targetId);
  }
}

// POST /api/flags
router.post('/', authenticate, (req, res) => {
  try {
    const { targetType, targetId, reason } = req.body;

    if (!['proof', 'comment'].includes(targetType)) {
      return res.status(400).json({ error: 'targetType must be proof or comment' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }
    if (!targetId) {
      return res.status(400).json({ error: 'targetId required' });
    }

    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO community_flags (id, target_type, target_id, user_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), targetType, targetId, req.user.id, reason, now);
    } catch (e) {
      if (e.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'You have already flagged this' });
      }
      throw e;
    }

    recalcCommunityStatus(targetType, targetId);

    res.json({
      success: true,
      message: 'Your flag was recorded as a community signal.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/flags/proof/:proofId — get community status
router.get('/proof/:proofId', (req, res) => {
  try {
    const proof = db.prepare(
      'SELECT id, community_status, flag_count, useful_count, question_count, comment_count FROM proofs WHERE id = ?'
    ).get(req.params.proofId);
    if (!proof) return res.status(404).json({ error: 'Proof not found' });
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
