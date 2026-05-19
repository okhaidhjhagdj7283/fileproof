// Load env first
require('dotenv').config();

// Validate env — will throw early if required vars missing
const config = require('./config/env');

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate limits ──────────────────────────────────────────────────────────────
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use('/api/proofs/draft', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Upload limit reached. Try again later.' } }));
app.use('/api/proofs/comments', rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Slow down. Too many comments.' } }));
app.use('/api/flags', rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Flag limit reached.' } }));

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/auth'));       // legacy compat
app.use('/api/proofs', require('./routes/proofs'));
app.use('/api/storage', require('./routes/storage'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/flags', require('./routes/community'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// ─── SPA fallback ─────────────────────────────────────────────────────────────
const fs = require('fs');
app.get('*', (req, res) => {
  const page = req.path.replace(/^\//, '') || 'index';
  const file = path.join(__dirname, 'public', `${page}.html`);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = config.port;
app.listen(PORT, () => {
  const mode = config.shelbyApiKey ? 'Shelby storage' : 'LOCAL storage (dev fallback)';
  console.log(`FileProof running on http://localhost:${PORT}`);
  console.log(`Storage mode: ${mode}`);
  console.log(`Environment: ${config.nodeEnv}`);
});
