import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'terminal.db');

let _db: Database.Database | null = null;
export function setupDb() {
  if (_db) return _db;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      marketId TEXT NOT NULL,
      side TEXT NOT NULL,
      size TEXT NOT NULL,
      price TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_marketId ON orders(marketId);
  `);
  _db = db;
  return db;
}

export function getDb() {
  if (!_db) throw new Error('DB not initialized');
  return _db;
}
