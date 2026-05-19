require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true }));
app.use('/api/proofs', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'Upload limit reached' } }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/users', require('./routes/users'));
app.use('/api/proofs', require('./routes/proofs'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/verify', require('./routes/verify'));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

app.get('*', (req, res) => {
  const page = req.path.replace('/', '') || 'index';
  const file = path.join(__dirname, 'public', `${page}.html`);
  const fs = require('fs');
  if (fs.existsSync(file)) res.sendFile(file);
  else res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FileProof running on http://localhost:${PORT}`));
