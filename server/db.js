import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'platform.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      updated_at TEXT NOT NULL, updated_by TEXT,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL, expires_at TEXT, locked INTEGER NOT NULL DEFAULT 0,
      max_devices INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS devices (
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL, info TEXT, ip TEXT,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      PRIMARY KEY (code_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS login_log (
      at TEXT NOT NULL, ip TEXT, ok INTEGER NOT NULL, code_id TEXT, reason TEXT
    );
  `);
  return db;
}
