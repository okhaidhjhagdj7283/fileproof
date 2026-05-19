const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'fileproof.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migration helper ─────────────────────────────────────────────────────────
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

function addColumnIfMissing(table, col, def) {
  if (!hasColumn(table, col)) {
    db.exec(`ALTER TABLE ${col === col ? table : table} ADD COLUMN ${col} ${def}`);
  }
}

// ─── Create tables ────────────────────────────────────────────────────────────
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
    sha256_hash TEXT NOT NULL,
    shelby_blob_id TEXT,
    storage_provider TEXT DEFAULT 'local',
    storage_uri TEXT,
    visibility TEXT DEFAULT 'public',
    category TEXT,
    tags TEXT DEFAULT '[]',
    event_date TEXT,
    location_text TEXT,
    latitude REAL,
    longitude REAL,
    submitter_type TEXT DEFAULT 'anonymous',
    wallet_address TEXT,
    wallet_signature TEXT,
    wallet_signature_verified INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    useful_count INTEGER DEFAULT 0,
    question_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    flag_count INTEGER DEFAULT 0,
    community_status TEXT DEFAULT 'normal',
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
    cover_image_url TEXT,
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

  CREATE TABLE IF NOT EXISTS proof_reactions (
    id TEXT PRIMARY KEY,
    proof_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
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
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (proof_id) REFERENCES proofs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'useful',
    created_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(target_type, target_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS user_filter_settings (
    user_id TEXT PRIMARY KEY,
    hide_community_flagged_proofs INTEGER DEFAULT 0,
    blur_sensitive_media INTEGER DEFAULT 1,
    collapse_flagged_comments INTEGER DEFAULT 1,
    prefer_wallet_signed_comments INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
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
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
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
  CREATE INDEX IF NOT EXISTS idx_proof_reactions ON proof_reactions(proof_id);
  CREATE INDEX IF NOT EXISTS idx_proof_comments ON proof_comments(proof_id);
  CREATE INDEX IF NOT EXISTS idx_community_flags ON community_flags(target_type, target_id);
`);

// ─── Migrate existing proofs table (add missing columns) ──────────────────────
// IMPORTANT: all ALTER TABLE must run BEFORE any UPDATE that touches those columns
const proofMigrations = [
  ['shelby_blob_id',            'TEXT'],
  ['storage_provider',          "TEXT DEFAULT 'local'"],
  ['storage_uri',               'TEXT'],
  ['latitude',                  'REAL'],
  ['longitude',                 'REAL'],
  ['wallet_signature_verified', 'INTEGER DEFAULT 0'],
  ['useful_count',              'INTEGER DEFAULT 0'],
  ['question_count',            'INTEGER DEFAULT 0'],
  ['comment_count',             'INTEGER DEFAULT 0'],
  ['flag_count',                'INTEGER DEFAULT 0'],
  ['community_status',          "TEXT DEFAULT 'normal'"],
];

for (const [col, def] of proofMigrations) {
  if (!hasColumn('proofs', col)) {
    db.exec(`ALTER TABLE proofs ADD COLUMN ${col} ${def}`);
    console.log(`  + proofs.${col} added`);
  }
}

// Now safe to run UPDATE that touches these columns
db.exec(`
  UPDATE proofs
  SET status = 'active'
  WHERE status NOT IN ('draft', 'active', 'hidden', 'flagged', 'removed_from_app')
     OR status IS NULL;

  UPDATE proofs
  SET community_status = 'normal'
  WHERE community_status IS NULL;
`);

module.exports = db;
