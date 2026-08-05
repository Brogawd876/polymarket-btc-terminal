import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'terminal.db');

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
      clientRequestId TEXT UNIQUE,
      remoteOrderId TEXT,
      conditionId TEXT,
      tokenId TEXT NOT NULL,
      outcome TEXT,
      side TEXT NOT NULL,
      dollarSpend TEXT,
      size TEXT NOT NULL,
      price TEXT NOT NULL,
      presetId TEXT,
      filledShares TEXT DEFAULT '0',
      remainingShares TEXT,
      averageFillPrice TEXT,
      fees TEXT DEFAULT '0',
      status TEXT NOT NULL,
      remoteState TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fills (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      tokenId TEXT NOT NULL,
      outcome TEXT,
      side TEXT NOT NULL,
      price TEXT NOT NULL,
      size TEXT NOT NULL,
      fee TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(orderId) REFERENCES orders(id)
    );
    
    CREATE TABLE IF NOT EXISTS positions (
      tokenId TEXT PRIMARY KEY,
      conditionId TEXT,
      outcome TEXT,
      netSize TEXT NOT NULL,
      avgPrice TEXT NOT NULL,
      fees TEXT DEFAULT '0',
      realizedPnl REAL DEFAULT 0,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency (
      requestId TEXT PRIMARY KEY,
      status TEXT NOT NULL, -- RESERVED, SUBMITTING, COMPLETED, FAILED, RECONCILING
      response TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anchors (
      conditionId TEXT PRIMARY KEY,
      windowStart INTEGER NOT NULL,
      value TEXT NOT NULL,
      sourceTimestamp INTEGER NOT NULL,
      validated INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_tokenId ON orders(tokenId);
    CREATE INDEX IF NOT EXISTS idx_orders_clientRequestId ON orders(clientRequestId);
    CREATE INDEX IF NOT EXISTS idx_fills_orderId ON fills(orderId);
  `);
  _db = db;
  return db;
}

export function getDb() {
  if (!_db) throw new Error('DB not initialized');
  return _db;
}
