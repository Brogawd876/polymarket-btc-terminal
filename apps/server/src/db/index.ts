import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(__dirname, '../../data/terminal.db');

export function setupDb() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
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
  `);
  return db;
}
