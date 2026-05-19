const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'fileproof.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    wallet_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proofs (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    visibility TEXT DEFAULT 'public',
    category TEXT,
    tags TEXT DEFAULT '[]',
    event_date TEXT,
    location_text TEXT,
    submitter_type TEXT DEFAULT 'anonymous',
    wallet_address TEXT,
    wallet_signature TEXT,
    status TEXT DEFAULT 'active',
    view_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'public',
    category TEXT,
    tags TEXT DEFAULT '[]',
    allow_submissions INTEGER DEFAULT 0,
    require_approval INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collection_proofs (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    proof_id TEXT NOT NULL,
    status TEXT DEFAULT 'approved',
    added_by_user_id TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (collection_id) REFERENCES collections(id),
    FOREIGN KEY (proof_id) REFERENCES proofs(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    proof_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    reporter_ip TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (proof_id) REFERENCES proofs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_proofs_owner ON proofs(owner_id);
  CREATE INDEX IF NOT EXISTS idx_proofs_status ON proofs(status);
  CREATE INDEX IF NOT EXISTS idx_proofs_visibility ON proofs(visibility);
  CREATE INDEX IF NOT EXISTS idx_proofs_hash ON proofs(sha256_hash);
  CREATE INDEX IF NOT EXISTS idx_collection_proofs ON collection_proofs(collection_id);
`);

module.exports = db;
