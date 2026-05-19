const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const config = require('../config/env');

const dbDir = path.dirname(path.resolve(config.databasePath));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(config.databasePath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migration helper ─────────────────────────────────────────────────────────
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// ─── Create tables ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    wallet_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proofs (
    id TEXT PRIMARY KEY,
    owner_id TEXT,

    title TEXT NOT NULL,
    description TEXT,

    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT NOT NULL,

    sha256_hash TEXT NOT NULL,
    shelby_blob_id TEXT,
    storage_provider TEXT NOT NULL DEFAULT 'shelby',
    storage_uri TEXT,

    visibility TEXT NOT NULL DEFAULT 'public',

    category TEXT,
    tags TEXT DEFAULT '[]',

    event_date TEXT,
    location_text TEXT,
    latitude REAL,
    longitude REAL,

    submitter_type TEXT NOT NULL DEFAULT 'anonymous',
    wallet_address TEXT,
    wallet_signature TEXT,
    wallet_signature_verified INTEGER DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'draft',

    useful_count INTEGER DEFAULT 0,
    question_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    flag_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    community_status TEXT DEFAULT 'normal',

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    slug TEXT UNIQUE,
    cover_image_url TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    category TEXT,
    tags TEXT DEFAULT '[]',
    allow_submissions INTEGER DEFAULT 0,
    require_approval INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collection_proofs (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    proof_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved',
    added_by_user_id TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(collection_id, proof_id),
    FOREIGN KEY (collection_id) REFERENCES collections(id),
    FOREIGN KEY (proof_id) REFERENCES proofs(id)
  );

  CREATE TABLE IF NOT EXISTS proof_reactions (
    id TEXT PRIMARY KEY,
    proof_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (proof_id) REFERENCES proofs(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(proof_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS proof_comments (
    id TEXT PRIMARY KEY,
    proof_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    parent_id TEXT,
    body TEXT NOT NULL,
    wallet_address TEXT,
    wallet_signature TEXT,
    signature_verified INTEGER DEFAULT 0,
    useful_count INTEGER DEFAULT 0,
    flag_count INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (proof_id) REFERENCES proofs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'useful',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (comment_id) REFERENCES proof_comments(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(comment_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS community_flags (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(target_type, target_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_filter_settings (
    user_id TEXT PRIMARY KEY,
    hide_community_flagged_proofs INTEGER DEFAULT 1,
    blur_sensitive_media INTEGER DEFAULT 1,
    collapse_flagged_comments INTEGER DEFAULT 1,
    prefer_wallet_signed_comments INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_reputation (
    user_id TEXT PRIMARY KEY,
    score INTEGER DEFAULT 0,
    email_verified INTEGER DEFAULT 0,
    wallet_connected INTEGER DEFAULT 0,
    proof_count INTEGER DEFAULT 0,
    useful_comment_count INTEGER DEFAULT 0,
    flag_received_count INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_proofs_owner ON proofs(owner_id);
  CREATE INDEX IF NOT EXISTS idx_proofs_status ON proofs(status);
  CREATE INDEX IF NOT EXISTS idx_proofs_visibility ON proofs(visibility);
  CREATE INDEX IF NOT EXISTS idx_proofs_hash ON proofs(sha256_hash);
  CREATE INDEX IF NOT EXISTS idx_collection_proofs_col ON collection_proofs(collection_id);
  CREATE INDEX IF NOT EXISTS idx_proof_reactions ON proof_reactions(proof_id);
  CREATE INDEX IF NOT EXISTS idx_proof_comments ON proof_comments(proof_id);
  CREATE INDEX IF NOT EXISTS idx_community_flags ON community_flags(target_type, target_id);
`);

// ─── Migrate existing DB — add missing columns ────────────────────────────────
const proofMigrations = [
  ['shelby_blob_id',            'TEXT'],
  ['storage_provider',          "TEXT NOT NULL DEFAULT 'shelby'"],
  ['storage_uri',               'TEXT'],
  ['latitude',                  'REAL'],
  ['longitude',                 'REAL'],
  ['wallet_signature_verified', 'INTEGER DEFAULT 0'],
  ['useful_count',              'INTEGER DEFAULT 0'],
  ['question_count',            'INTEGER DEFAULT 0'],
  ['comment_count',             'INTEGER DEFAULT 0'],
  ['flag_count',                'INTEGER DEFAULT 0'],
  ['community_status',          "TEXT DEFAULT 'normal'"],
  ['view_count',                'INTEGER DEFAULT 0'],
];

for (const [col, def] of proofMigrations) {
  if (!hasColumn('proofs', col)) {
    db.exec(`ALTER TABLE proofs ADD COLUMN ${col} ${def}`);
    console.log(`  DB migration: proofs.${col} added`);
  }
}

// Normalize legacy status values
db.exec(`
  UPDATE proofs
  SET status = 'active'
  WHERE status NOT IN ('draft', 'active', 'flagged_by_community', 'removed_from_app_view')
     OR status IS NULL;

  UPDATE proofs
  SET community_status = 'normal'
  WHERE community_status IS NULL;

  UPDATE proofs
  SET storage_provider = 'shelby'
  WHERE storage_provider IS NULL;
`);

module.exports = db;
