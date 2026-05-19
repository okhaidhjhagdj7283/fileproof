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
  db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), wallet_address = COALESCE(?, wallet_address), updated_at = datetime("now") WHERE id = ?')
    .run(display_name || null, wallet_address || null, req.user.id);
  res.json({ success: true });
});

module.exports = router;
