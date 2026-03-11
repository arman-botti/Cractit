const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure data directory exists
const dataDir = path.join('/tmp');
const dbPath = path.join(dataDir, 'crackit.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    youtube_id  TEXT NOT NULL UNIQUE,
    category    TEXT DEFAULT 'General',
    label       TEXT DEFAULT '',
    chapter     TEXT DEFAULT '',
    thumbnail   TEXT,
    duration    TEXT DEFAULT '0:00',
    views       INTEGER DEFAULT 0,
    likes       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    token      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrations
try { db.exec("ALTER TABLE videos ADD COLUMN chapter TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE videos ADD COLUMN likes INTEGER DEFAULT 0"); } catch(e) {}

module.exports = db;
