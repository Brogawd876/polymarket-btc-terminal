import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, setupDb } from '../../apps/server/src/db';

function createLegacyDatabase(databasePath: string, duplicateRemoteId = false) {
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, clientRequestId TEXT UNIQUE, remoteOrderId TEXT, conditionId TEXT,
      tokenId TEXT NOT NULL, outcome TEXT, side TEXT NOT NULL, dollarSpend TEXT, size TEXT NOT NULL,
      price TEXT NOT NULL, presetId TEXT, filledShares TEXT DEFAULT '0', remainingShares TEXT,
      averageFillPrice TEXT, fees TEXT DEFAULT '0', status TEXT NOT NULL, remoteState TEXT,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE fills (
      id TEXT PRIMARY KEY, orderId TEXT NOT NULL, tokenId TEXT NOT NULL, outcome TEXT,
      side TEXT NOT NULL, price TEXT NOT NULL, size TEXT NOT NULL, fee TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE positions (
      tokenId TEXT PRIMARY KEY, conditionId TEXT, outcome TEXT, netSize TEXT NOT NULL,
      avgPrice TEXT NOT NULL, fees TEXT DEFAULT '0', realizedPnl REAL DEFAULT 0, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, apiKey TEXT UNIQUE, createdAt INTEGER NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, userId TEXT NOT NULL, token TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE idempotency (requestId TEXT PRIMARY KEY, status TEXT NOT NULL, response TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE anchors (conditionId TEXT PRIMARY KEY, windowStart INTEGER NOT NULL, value TEXT NOT NULL, sourceTimestamp INTEGER NOT NULL, validated INTEGER NOT NULL);
  `);
  const insertOrder = legacy.prepare(`INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertOrder.run('order-1', 'request-1', 'remote-1', 'condition-1', 'token-up', 'Up', 'BUY', '3', '10',
    '0.3', null, '4', null, null, '0', 'PARTIALLY_FILLED', 'MATCHED', 100, 200);
  if (duplicateRemoteId) {
    insertOrder.run('order-2', 'request-2', 'remote-1', 'condition-1', 'token-down', 'Down', 'BUY', '3', '10',
      '0.3', null, '0', null, null, '0', 'OPEN', 'LIVE', 110, 210);
  }
  legacy.prepare(`INSERT INTO fills VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'fill-1', 'order-1', 'token-up', null, 'BUY', '0.3', '4', '0', 150,
  );
  legacy.prepare(`INSERT INTO positions VALUES (?,?,?,?,?,?,?,?)`).run(
    'token-up', 'condition-1', 'Up', '4', '0.3', '0', 0, 200,
  );
  legacy.close();
}

describe('SQLite migration preservation and legacy backfill', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    closeDb();
    delete process.env.POLYMARKET_DB_PATH;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates a copied legacy fixture without touching the real database', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-migration-'));
    const legacyPath = path.join(tempDir, 'legacy.db');
    createLegacyDatabase(legacyPath);

    process.env.POLYMARKET_DB_PATH = legacyPath;
    const migrated = setupDb();
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM orders').get()).toMatchObject({ count: 1 });
    expect(migrated.prepare('SELECT outcome, remainingShares FROM orders WHERE id=?').get('order-1'))
      .toMatchObject({ outcome: 'UP', remainingShares: '6.0' });
    expect(migrated.prepare('SELECT conditionId, outcome FROM fills WHERE id=?').get('fill-1'))
      .toMatchObject({ conditionId: 'condition-1', outcome: 'UP' });
    expect(migrated.prepare('SELECT outcome, availableShares, feesKnown FROM positions WHERE tokenId=?').get('token-up'))
      .toMatchObject({ outcome: 'UP', availableShares: '4.0', feesKnown: 0 });
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toMatchObject({ count: 7 });
    expect(migrated.prepare(`
      SELECT entityType, reasonCode, state FROM reconciliation_discrepancies
      WHERE entityId = 'token-up'
    `).get()).toMatchObject({ entityType: 'POSITION', reasonCode: 'UNKNOWN_LEGACY_FEES', state: 'QUARANTINED' });
    expect(fs.readdirSync(path.join(tempDir, 'backups')).some(name => name.endsWith('.db'))).toBe(true);
  });

  it('preserves and quarantines duplicate legacy remote order IDs', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-migration-'));
    const legacyPath = path.join(tempDir, 'legacy-duplicates.db');
    createLegacyDatabase(legacyPath, true);
    process.env.POLYMARKET_DB_PATH = legacyPath;

    const migrated = setupDb();
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM orders').get()).toMatchObject({ count: 2 });
    expect(migrated.prepare(`
      SELECT COUNT(*) AS count FROM reconciliation_discrepancies
      WHERE reasonCode = 'DUPLICATE_REMOTE_ORDER_ID' AND state = 'QUARANTINED'
    `).get()).toMatchObject({ count: 2 });
  });
});
