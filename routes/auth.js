const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');
const config = require('../config/env');

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const password_hash = bcrypt.hashSync(password, 10);
    const name = (display_name || email.split('@')[0]).trim();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase().trim(), name, password_hash, now, now);

    db.prepare(`INSERT OR IGNORE INTO user_reputation (user_id, updated_at) VALUES (?, ?)`).run(id, now);
    db.prepare(`INSERT OR IGNORE INTO user_filter_settings (user_id, created_at, updated_at) VALUES (?, ?, ?)`).run(id, now, now);

    const token = jwt.sign({ id, email: email.toLowerCase().trim(), display_name: name }, config.jwtSecret, { expiresIn: '30d' });
    res.json({ token, user: { id, email: email.toLowerCase().trim(), display_name: name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, display_name: user.display_name },
      config.jwtSecret,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, display_name, wallet_address, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/auth/me
router.patch('/me', authenticate, (req, res) => {
  try {
    const { display_name, wallet_address } = req.body;
    db.prepare(`
      UPDATE users SET
        display_name = COALESCE(?, display_name),
        wallet_address = COALESCE(?, wallet_address),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(display_name || null, wallet_address || null, req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me/filters
router.get('/me/filters', authenticate, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM user_filter_settings WHERE user_id = ?').get(req.user.id);
    res.json(settings || {
      user_id: req.user.id,
      hide_community_flagged_proofs: 1,
      blur_sensitive_media: 1,
      collapse_flagged_comments: 1,
      prefer_wallet_signed_comments: 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/auth/me/filters
router.patch('/me/filters', authenticate, (req, res) => {
  try {
    const { hide_community_flagged_proofs, blur_sensitive_media, collapse_flagged_comments, prefer_wallet_signed_comments } = req.body;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_filter_settings (user_id, hide_community_flagged_proofs, blur_sensitive_media, collapse_flagged_comments, prefer_wallet_signed_comments, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        hide_community_flagged_proofs = COALESCE(excluded.hide_community_flagged_proofs, hide_community_flagged_proofs),
        blur_sensitive_media = COALESCE(excluded.blur_sensitive_media, blur_sensitive_media),
        collapse_flagged_comments = COALESCE(excluded.collapse_flagged_comments, collapse_flagged_comments),
        prefer_wallet_signed_comments = COALESCE(excluded.prefer_wallet_signed_comments, prefer_wallet_signed_comments),
        updated_at = excluded.updated_at
    `).run(
      req.user.id,
      hide_community_flagged_proofs !== undefined ? (hide_community_flagged_proofs ? 1 : 0) : null,
      blur_sensitive_media !== undefined ? (blur_sensitive_media ? 1 : 0) : null,
      collapse_flagged_comments !== undefined ? (collapse_flagged_comments ? 1 : 0) : null,
      prefer_wallet_signed_comments !== undefined ? (prefer_wallet_signed_comments ? 1 : 0) : null,
      now, now,
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me/reputation
router.get('/me/reputation', authenticate, (req, res) => {
  try {
    const rep = db.prepare('SELECT * FROM user_reputation WHERE user_id = ?').get(req.user.id);
    res.json(rep || { user_id: req.user.id, score: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
