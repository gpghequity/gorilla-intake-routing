const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'gorilla.db');

// Ensure db directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('buyer','seller','agent')),
      status TEXT NOT NULL DEFAULT 'new',
      payload TEXT NOT NULL,
      listed_flag INTEGER NOT NULL DEFAULT 0,
      storage_flag INTEGER NOT NULL DEFAULT 0,
      assigned_agent_id TEXT,
      broker_notes TEXT,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_at TEXT,
      closed_at TEXT,
      FOREIGN KEY (assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at ON submissions(submitted_at DESC);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_assigned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(active);
    CREATE INDEX IF NOT EXISTS idx_agents_last_assigned ON agents(last_assigned_at);

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mimetype TEXT,
      size INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_uploads_submission ON uploads(submission_id);
  `);
}

init();

module.exports = db;
