require('dotenv').config();

// ─── Env validation ───────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error('FATAL: JWT_SECRET is not set. Please configure .env before starting.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limits
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true }));
app.use('/api/proofs/draft', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Upload limit reached. Try again later.' } }));
app.use('/api/proofs/comments', rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Slow down. Too many comments.' } }));
app.use('/api/flags', rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Flag limit reached.' } }));

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/proofs', require('./routes/proofs'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/storage', require('./routes/storage'));
app.use('/api/flags', require('./routes/community'));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

app.get('*', (req, res) => {
  const fs = require('fs');
  const page = req.path.replace('/', '') || 'index';
  const file = path.join(__dirname, 'public', `${page}.html`);
  if (fs.existsSync(file)) res.sendFile(file);
  else res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FileProof running on http://localhost:${PORT}`));
