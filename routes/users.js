const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

router.post('/register', (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const password_hash = bcrypt.hashSync(password, 10);
    const name = display_name || email.split('@')[0];

    db.prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
      .run(id, email, name, password_hash);

    // Init reputation
    db.prepare('INSERT OR IGNORE INTO user_reputation (user_id, score) VALUES (?, 0)').run(id);
    // Init filter settings
    db.prepare('INSERT OR IGNORE INTO user_filter_settings (user_id) VALUES (?)').run(id);

    const token = jwt.sign({ id, email, display_name: name }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email, display_name: name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, display_name: user.display_name },
      process.env.JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, wallet_address, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.patch('/me', authenticate, (req, res) => {
  const { display_name, wallet_address } = req.body;
  db.prepare(`UPDATE users SET display_name = COALESCE(?, display_name), wallet_address = COALESCE(?, wallet_address), updated_at = datetime('now') WHERE id = ?`)
    .run(display_name || null, wallet_address || null, req.user.id);
  res.json({ success: true });
});

// GET /api/users/me/filters
router.get('/me/filters', authenticate, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM user_filter_settings WHERE user_id = ?').get(req.user.id);
    res.json(settings || { user_id: req.user.id, hide_community_flagged_proofs: 0, blur_sensitive_media: 1, collapse_flagged_comments: 1, prefer_wallet_signed_comments: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/users/me/filters
router.patch('/me/filters', authenticate, (req, res) => {
  try {
    const { hide_community_flagged_proofs, blur_sensitive_media, collapse_flagged_comments, prefer_wallet_signed_comments } = req.body;
    db.prepare(`
      INSERT INTO user_filter_settings (user_id, hide_community_flagged_proofs, blur_sensitive_media, collapse_flagged_comments, prefer_wallet_signed_comments)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        hide_community_flagged_proofs = COALESCE(excluded.hide_community_flagged_proofs, hide_community_flagged_proofs),
        blur_sensitive_media = COALESCE(excluded.blur_sensitive_media, blur_sensitive_media),
        collapse_flagged_comments = COALESCE(excluded.collapse_flagged_comments, collapse_flagged_comments),
        prefer_wallet_signed_comments = COALESCE(excluded.prefer_wallet_signed_comments, prefer_wallet_signed_comments),
        updated_at = datetime('now')
    `).run(
      req.user.id,
      hide_community_flagged_proofs !== undefined ? (hide_community_flagged_proofs ? 1 : 0) : null,
      blur_sensitive_media !== undefined ? (blur_sensitive_media ? 1 : 0) : null,
      collapse_flagged_comments !== undefined ? (collapse_flagged_comments ? 1 : 0) : null,
      prefer_wallet_signed_comments !== undefined ? (prefer_wallet_signed_comments ? 1 : 0) : null,
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/users/me/reputation
router.get('/me/reputation', authenticate, (req, res) => {
  try {
    const rep = db.prepare('SELECT * FROM user_reputation WHERE user_id = ?').get(req.user.id);
    res.json(rep || { user_id: req.user.id, score: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
