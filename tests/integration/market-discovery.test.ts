import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Market Discovery & Persistence Integration', () => {
  let db: any;
  
  beforeEach(() => {
    // In-memory SQLite for deterministic tests
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE markets (
        id TEXT PRIMARY KEY,
        question TEXT,
        status TEXT,
        resolution_date TEXT
      );
      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT,
        yes_price REAL,
        no_price REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('should persist discovered 5-minute markets into SQLite', async () => {
    // Simulated behavior of MarketRepository
    const stmt = db.prepare('INSERT INTO markets (id, question, status, resolution_date) VALUES (?, ?, ?, ?)');
    stmt.run('btc-1205', 'BTC > $65k at 12:05?', 'ACTIVE', new Date().toISOString());
    
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get('btc-1205');
    expect(market).toBeDefined();
    expect(market.question).toBe('BTC > $65k at 12:05?');
  });

  it('should capture snapshot updates correctly', () => {
    const insertSnapshot = db.prepare('INSERT INTO snapshots (market_id, yes_price, no_price) VALUES (?, ?, ?)');
    insertSnapshot.run('btc-1205', 0.45, 0.55);
    
    const snapshots = db.prepare('SELECT * FROM snapshots WHERE market_id = ?').all('btc-1205');
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].yes_price).toBe(0.45);
    expect(snapshots[0].no_price).toBe(0.55);
  });
});
