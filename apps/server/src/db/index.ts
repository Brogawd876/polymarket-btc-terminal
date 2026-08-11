import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type SqliteDb = Database.Database;

type Migration = {
  id: number;
  name: string;
  up: (db: SqliteDb) => void;
};

function findServerRoot(): string {
  const starts = [__dirname, process.cwd()];
  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      const packagePath = path.join(current, 'package.json');
      if (fs.existsSync(packagePath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
          if (pkg.name === '@polymarket-btc/server') return current;
        } catch {
          // Continue walking; malformed package metadata is reported by normal startup checks.
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return path.resolve(process.cwd(), 'apps', 'server');
}

export function getDatabasePath(): string {
  if (process.env.POLYMARKET_DB_PATH) return path.resolve(process.env.POLYMARKET_DB_PATH);
  const dataDir = process.env.POLYMARKET_DATA_DIR
    ? path.resolve(process.env.POLYMARKET_DATA_DIR)
    : path.join(findServerRoot(), 'data');
  return path.join(dataDir, 'terminal.db');
}

function getDbOptions(): Database.Options {
  if ((process as any).pkg) {
    return { nativeBinding: path.join(path.dirname(process.execPath), 'better_sqlite3.node') };
  }
  return {};
}

function hasColumn(db: SqliteDb, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumn(db: SqliteDb, table: string, definition: string): void {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'baseline_tables',
    up: (db) => db.exec(`
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
      CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency (
        requestId TEXT PRIMARY KEY,
        status TEXT NOT NULL,
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
    `),
  },
  {
    id: 2,
    name: 'authoritative_order_and_position_columns',
    up: (db) => {
      for (const definition of [
        "executionMode TEXT",
        "orderType TEXT",
        "requestedPrice TEXT",
        "submittedPrice TEXT",
        "requestedShares TEXT",
        "submissionResult TEXT",
        "reconciliationRequired INTEGER NOT NULL DEFAULT 0",
        "errorCode TEXT",
        "errorMessage TEXT",
        "tradingSessionId TEXT",
        "rowVersion INTEGER NOT NULL DEFAULT 0",
      ]) addColumn(db, 'orders', definition);

      for (const definition of [
        "conditionId TEXT",
        "remoteEventId TEXT",
        "remoteTradeState TEXT",
        "confirmed INTEGER NOT NULL DEFAULT 0",
        "tradeTimestamp INTEGER",
        "receiveTimestamp INTEGER",
      ]) addColumn(db, 'fills', definition);

      for (const definition of [
        "reservedShares TEXT NOT NULL DEFAULT '0'",
        "availableShares TEXT NOT NULL DEFAULT '0'",
        "grossRealizedPnl REAL NOT NULL DEFAULT 0",
        "netRealizedPnl REAL NOT NULL DEFAULT 0",
        "unrealizedPnl REAL NOT NULL DEFAULT 0",
        "feesKnown INTEGER NOT NULL DEFAULT 1",
        "resolutionState TEXT NOT NULL DEFAULT 'OPEN'",
      ]) addColumn(db, 'positions', definition);

      for (const definition of [
        "source TEXT",
        "observedAt INTEGER",
        "validationMethod TEXT",
        "validationEvidence TEXT",
      ]) addColumn(db, 'anchors', definition);
    },
  },
  {
    id: 3,
    name: 'lifecycle_recovery_and_audit_tables',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId TEXT NOT NULL,
        fromState TEXT,
        toState TEXT NOT NULL,
        source TEXT NOT NULL,
        remoteEventId TEXT,
        payload TEXT,
        exchangeTimestamp INTEGER,
        receiveTimestamp INTEGER NOT NULL,
        FOREIGN KEY(orderId) REFERENCES orders(id),
        UNIQUE(remoteEventId, orderId)
      );
      CREATE TABLE IF NOT EXISTS remote_trades (
        tradeId TEXT PRIMARY KEY,
        orderId TEXT,
        tokenId TEXT NOT NULL,
        conditionId TEXT,
        outcome TEXT,
        side TEXT NOT NULL,
        price TEXT NOT NULL,
        size TEXT NOT NULL,
        fee TEXT,
        state TEXT NOT NULL,
        exchangeTimestamp INTEGER,
        receiveTimestamp INTEGER NOT NULL,
        payload TEXT
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        requestId TEXT NOT NULL,
        orderId TEXT,
        assetType TEXT NOT NULL,
        assetId TEXT NOT NULL,
        amount TEXT NOT NULL,
        state TEXT NOT NULL,
        expiresAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(requestId, assetType, assetId)
      );
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        completedAt INTEGER,
        remoteOpenCount INTEGER NOT NULL DEFAULT 0,
        localOpenCount INTEGER NOT NULL DEFAULT 0,
        unresolvedCount INTEGER NOT NULL DEFAULT 0,
        errorMessage TEXT
      );
      CREATE TABLE IF NOT EXISTS trading_sessions (
        id TEXT PRIMARY KEY,
        startedAt INTEGER NOT NULL,
        endedAt INTEGER,
        startingBalance TEXT,
        endingBalance TEXT,
        grossPnl TEXT NOT NULL DEFAULT '0',
        fees TEXT NOT NULL DEFAULT '0',
        netPnl TEXT NOT NULL DEFAULT '0',
        maximumExposure TEXT NOT NULL DEFAULT '0',
        largestPosition TEXT NOT NULL DEFAULT '0',
        buys INTEGER NOT NULL DEFAULT 0,
        sells INTEGER NOT NULL DEFAULT 0,
        rejections INTEGER NOT NULL DEFAULT 0,
        cancellations INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventType TEXT NOT NULL,
        aggregateId TEXT,
        payload TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        publishedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS connection_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subsystem TEXT NOT NULL,
        state TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        requestId TEXT,
        orderId TEXT,
        conditionId TEXT,
        tokenId TEXT,
        payload TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS markets (
        conditionId TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT,
        startTime INTEGER NOT NULL,
        endTime INTEGER NOT NULL,
        status TEXT NOT NULL,
        tickSize TEXT,
        minimumOrderSize TEXT,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_tokens (
        conditionId TEXT NOT NULL,
        outcome TEXT NOT NULL,
        tokenId TEXT NOT NULL UNIQUE,
        PRIMARY KEY(conditionId, outcome),
        FOREIGN KEY(conditionId) REFERENCES markets(conditionId)
      );
      CREATE TABLE IF NOT EXISTS risk_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `),
  },
  {
    id: 4,
    name: 'legacy_data_backfill',
    up: (db) => {
      db.exec(`
        UPDATE positions SET outcome = UPPER(outcome) WHERE outcome IN ('Up', 'Down');
        UPDATE orders SET outcome = UPPER(outcome) WHERE outcome IN ('Up', 'Down');
        UPDATE fills
          SET outcome = (SELECT orders.outcome FROM orders WHERE orders.id = fills.orderId)
          WHERE outcome IS NULL;
        UPDATE fills
          SET conditionId = (SELECT orders.conditionId FROM orders WHERE orders.id = fills.orderId)
          WHERE conditionId IS NULL;
        UPDATE orders
          SET remainingShares = CAST(MAX(0, CAST(size AS REAL) - CAST(COALESCE(filledShares, '0') AS REAL)) AS TEXT)
          WHERE remainingShares IS NULL;
        UPDATE positions
          SET availableShares = CAST(MAX(0, CAST(netSize AS REAL) - CAST(reservedShares AS REAL)) AS TEXT),
              feesKnown = 0;
      `);
    },
  },
  {
    id: 5,
    name: 'authoritative_indexes',
    up: (db) => db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_remoteOrderId ON orders(remoteOrderId) WHERE remoteOrderId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_orders_tokenId ON orders(tokenId);
      CREATE INDEX IF NOT EXISTS idx_orders_condition_status ON orders(conditionId, status);
      CREATE INDEX IF NOT EXISTS idx_orders_clientRequestId ON orders(clientRequestId);
      CREATE INDEX IF NOT EXISTS idx_order_events_orderId ON order_events(orderId, receiveTimestamp);
      CREATE INDEX IF NOT EXISTS idx_fills_orderId ON fills(orderId);
      CREATE INDEX IF NOT EXISTS idx_fills_token_time ON fills(tokenId, COALESCE(tradeTimestamp, createdAt), createdAt);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fills_remoteEventId ON fills(remoteEventId) WHERE remoteEventId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_reservations_asset_state ON reservations(assetType, assetId, state);
      CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(publishedAt, id);
    `),
  },
  {
    id: 6,
    name: 'legacy_reconciliation_discrepancies',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        reasonCode TEXT NOT NULL,
        detail TEXT,
        state TEXT NOT NULL DEFAULT 'QUARANTINED',
        detectedAt INTEGER NOT NULL,
        resolvedAt INTEGER,
        UNIQUE(entityType, entityId, reasonCode)
      );
      INSERT OR IGNORE INTO reconciliation_discrepancies (entityType, entityId, reasonCode, detail, detectedAt)
        SELECT 'ORDER', orders.id, 'DUPLICATE_REMOTE_ORDER_ID', json_object('remoteOrderId', orders.remoteOrderId),
          CAST(strftime('%s','now') AS INTEGER) * 1000
        FROM orders
        WHERE remoteOrderId IN (SELECT remoteOrderId FROM orders WHERE remoteOrderId IS NOT NULL GROUP BY remoteOrderId HAVING COUNT(*) > 1);
      UPDATE orders SET remoteOrderId = NULL, reconciliationRequired = 1, status = 'RECONCILING', remoteState = 'DUPLICATE_REMOTE_ID'
        WHERE remoteOrderId IN (SELECT remoteOrderId FROM orders WHERE remoteOrderId IS NOT NULL GROUP BY remoteOrderId HAVING COUNT(*) > 1);
      DROP INDEX IF EXISTS idx_orders_remoteOrderId;
      CREATE UNIQUE INDEX idx_orders_remoteOrderId ON orders(remoteOrderId) WHERE remoteOrderId IS NOT NULL;
      INSERT OR IGNORE INTO reconciliation_discrepancies (entityType, entityId, reasonCode, detail, detectedAt)
        SELECT 'ORDER', id, 'MISSING_MARKET_BINDING',
          json_object('conditionId', conditionId, 'tokenId', tokenId, 'outcome', outcome),
          CAST(strftime('%s','now') AS INTEGER) * 1000
        FROM orders WHERE conditionId IS NULL OR conditionId = '' OR tokenId = '' OR outcome NOT IN ('UP','DOWN');
      INSERT OR IGNORE INTO reconciliation_discrepancies (entityType, entityId, reasonCode, detail, detectedAt)
        SELECT 'FILL', fills.id, 'MISSING_LOCAL_ORDER', json_object('orderId', fills.orderId),
          CAST(strftime('%s','now') AS INTEGER) * 1000
        FROM fills LEFT JOIN orders ON orders.id = fills.orderId WHERE orders.id IS NULL;
      INSERT OR IGNORE INTO reconciliation_discrepancies (entityType, entityId, reasonCode, detail, detectedAt)
        SELECT 'POSITION', tokenId, 'UNKNOWN_LEGACY_FEES', json_object('fees', fees),
          CAST(strftime('%s','now') AS INTEGER) * 1000
        FROM positions WHERE feesKnown = 0;
      CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_state
        ON reconciliation_discrepancies(state, entityType, detectedAt);
    `),
  },
  {
    id: 7,
    name: 'authenticated_extension_sessions',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS extension_sessions (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        protocolVersion INTEGER NOT NULL,
        authenticatedAt INTEGER NOT NULL,
        lastSeenAt INTEGER NOT NULL,
        closedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_extension_sessions_open ON extension_sessions(closedAt, lastSeenAt);
    `),
  },
];

function migrationChecksum(migration: Migration): string {
  return crypto.createHash('sha256').update(`${migration.id}:${migration.name}:${migration.up.toString()}`).digest('hex');
}

function createMigrationBackup(db: SqliteDb, databasePath: string): string | null {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return null;
  const backupDir = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `terminal-before-migration-${stamp}.db`);
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return backupPath;
}

function runMigrations(db: SqliteDb, databasePath: string): void {
  const hasMigrationTable = Boolean(db.prepare(`
    SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get());
  const applied = hasMigrationTable
    ? new Map((db.prepare('SELECT id, checksum FROM schema_migrations').all() as Array<{ id: number; checksum: string }>).map((row) => [row.id, row.checksum]))
    : new Map<number, string>();
  const pending = migrations.filter((migration) => !applied.has(migration.id));
  if (pending.length === 0) return;

  const backupPath = createMigrationBackup(db, databasePath);
  if (backupPath) console.log(`SQLite migration backup created at ${backupPath}`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      appliedAt INTEGER NOT NULL
    );
  `);

  for (const migration of migrations) {
    const expectedChecksum = migrationChecksum(migration);
    const currentChecksum = applied.get(migration.id);
    if (currentChecksum && currentChecksum !== expectedChecksum) {
      throw new Error(`Migration checksum mismatch for ${migration.id} (${migration.name})`);
    }
    if (currentChecksum) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name, checksum, appliedAt) VALUES (?, ?, ?, ?)')
        .run(migration.id, migration.name, expectedChecksum, Date.now());
      db.pragma(`user_version = ${migration.id}`);
    })();
  }
}

let _db: SqliteDb | null = null;
let _databasePath: string | null = null;

export function setupDb(): SqliteDb {
  if (_db) return _db;
  const databasePath = getDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  let db: SqliteDb;
  try {
    db = new Database(databasePath, getDbOptions());
    const quickCheck = db.pragma('quick_check') as Array<{ quick_check?: string }>;
    const result = String(quickCheck[0]?.quick_check || 'ok').toLowerCase();
    if (result !== 'ok') throw new Error(`SQLite quick_check failed: ${result}`);
  } catch (error: any) {
    throw new Error(`Unable to open SQLite database at ${databasePath}. The database was not reset. ${error?.message || error}`);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  runMigrations(db, databasePath);

  _db = db;
  _databasePath = databasePath;
  return db;
}

export function getDb(): SqliteDb {
  if (!_db) throw new Error('DB not initialized');
  return _db;
}

export function closeDb(): void {
  if (!_db) return;
  _db.pragma('wal_checkpoint(TRUNCATE)');
  _db.close();
  _db = null;
  _databasePath = null;
}

export function getOpenDatabasePath(): string | null {
  return _databasePath;
}
