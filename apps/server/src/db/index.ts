import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'terminal.db');

// When running inside a pkg executable, better-sqlite3's bindings library
// cannot walk the virtual snapshot filesystem to find package.json.
// We explicitly resolve the .node binary to sit next to the executable.
function getDbOptions(): Database.Options {
  if ((process as any).pkg) {
    const nativeBinding = path.join(
      path.dirname(process.execPath),
      'better_sqlite3.node'
    );
    return { nativeBinding };
  }
  return {};
}

let _db: Database.Database | null = null;
export function setupDb() {
  if (_db) return _db;
  const db = new Database(dbPath, getDbOptions());
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      apiKey TEXT UNIQUE,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      token TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tokenId TEXT NOT NULL,
      side TEXT NOT NULL,
      size TEXT NOT NULL,
      price TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fills (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      side TEXT NOT NULL,
      price TEXT NOT NULL,
      size TEXT NOT NULL,
      fee TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(orderId) REFERENCES orders(id)
    );
    
    CREATE TABLE IF NOT EXISTS positions (
      tokenId TEXT PRIMARY KEY,
      netSize TEXT NOT NULL,
      avgPrice TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_balance (
      id TEXT PRIMARY KEY,
      balance TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency (
      requestId TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_tokenId ON orders(tokenId);
    CREATE INDEX IF NOT EXISTS idx_fills_orderId ON fills(orderId);
  `);
  _db = db;
  return db;
}

export function getDb() {
  if (!_db) throw new Error('DB not initialized');
  return _db;
}
