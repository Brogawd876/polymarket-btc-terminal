import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderLifecycleService,
  QuoteService,
  RiskService,
  isAmbiguousSubmissionError,
} from '../../apps/server/src/routes/trading';

function createLifecycleDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, clientRequestId TEXT UNIQUE, remoteOrderId TEXT,
      conditionId TEXT, tokenId TEXT NOT NULL, outcome TEXT, side TEXT NOT NULL,
      dollarSpend TEXT, size TEXT NOT NULL, price TEXT NOT NULL, presetId TEXT,
      filledShares TEXT DEFAULT '0', remainingShares TEXT, averageFillPrice TEXT,
      fees TEXT DEFAULT '0', status TEXT NOT NULL, remoteState TEXT,
      executionMode TEXT, orderType TEXT, requestedPrice TEXT, submittedPrice TEXT,
      requestedShares TEXT, submissionResult TEXT, reconciliationRequired INTEGER DEFAULT 0,
      errorMessage TEXT, rowVersion INTEGER DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE reservations (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL, orderId TEXT, assetType TEXT NOT NULL,
      assetId TEXT NOT NULL, amount TEXT NOT NULL, state TEXT NOT NULL, expiresAt INTEGER,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
      UNIQUE(requestId, assetType, assetId)
    );
    CREATE TABLE order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, orderId TEXT NOT NULL, fromState TEXT,
      toState TEXT NOT NULL, source TEXT NOT NULL, payload TEXT, receiveTimestamp INTEGER NOT NULL
    );
    CREATE TABLE outbox_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, eventType TEXT NOT NULL, aggregateId TEXT,
      payload TEXT NOT NULL, createdAt INTEGER NOT NULL, publishedAt INTEGER
    );
  `);
  return db;
}

function quoteInput(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: 'condition-current', tokenId: 'token-up', outcome: 'UP' as const,
    side: 'BUY' as const, executionMode: 'MAKER' as const, referencePrice: 0.437,
    tickSize: 0.01, makerBoundary: 0.44, marketRevision: 7, bookVersion: 11,
    requestedDollars: 3, ttlMs: 2_500, ...overrides,
  };
}

function makerIntent(quoteId: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request-1', conditionId: 'condition-current', tokenId: 'token-up',
    outcome: 'UP' as const, side: 'BUY' as const, executionMode: 'MAKER' as const,
    orderType: 'GTC' as const, quoteId, marketRevision: 7, dollarSpend: '3', ...overrides,
  } as any;
}

describe('QuoteService executable quote binding', () => {
  afterEach(() => vi.useRealTimers());

  it('binds a one-use maker quote to market and book revisions', () => {
    const service = new QuoteService();
    const quote = service.create(quoteInput());
    expect(quote.displayedPrice).toBe('0.43');
    expect(quote.submittedPrice).toBe(quote.displayedPrice);
    expect(service.consume(quote.quoteId, makerIntent(quote.quoteId), { marketRevision: 7, bookVersion: 11 })).toEqual(quote);
    expect(() => service.consume(quote.quoteId, makerIntent(quote.quoteId), { marketRevision: 7, bookVersion: 11 }))
      .toThrow(/not found|already used/i);
  });

  it('rejects expired quotes and stale market or book revisions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
    const expiredService = new QuoteService();
    const expired = expiredService.create(quoteInput({ ttlMs: 100 }));
    vi.advanceTimersByTime(101);
    expect(() => expiredService.consume(expired.quoteId, makerIntent(expired.quoteId), { marketRevision: 7, bookVersion: 11 }))
      .toThrow(/expired/i);

    const staleService = new QuoteService();
    const stale = staleService.create(quoteInput());
    expect(() => staleService.consume(stale.quoteId, makerIntent(stale.quoteId), { marketRevision: 8, bookVersion: 11 }))
      .toThrow(/stale/i);
  });
});

describe('RiskService reservations', () => {
  let db: Database.Database;
  beforeEach(() => { db = createLifecycleDb(); });
  afterEach(() => db.close());

  it('subtracts active collateral reservations from spendable balance', () => {
    const now = Date.now();
    db.prepare(`INSERT INTO reservations VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('r1', 'existing-buy', null, 'COLLATERAL', 'USDC', '8', 'ACTIVE', null, now, now);
    const risk = new RiskService(db);
    expect(risk.reserved('COLLATERAL', 'USDC')).toBe(8);
    expect(() => risk.check({ side: 'BUY', tokenId: 'token-up', dollars: 3, shares: 6, balance: 10, availableShares: 0 }))
      .toThrow(/insufficient available collateral/i);
  });

  it('subtracts active share reservations from sellable inventory', () => {
    const now = Date.now();
    db.prepare(`INSERT INTO reservations VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('r2', 'existing-sell', null, 'SHARES', 'token-up', '4', 'RECONCILING', null, now, now);
    const risk = new RiskService(db);
    expect(() => risk.check({ side: 'SELL', tokenId: 'token-up', dollars: 2, shares: 7, balance: 0, availableShares: 10 }))
      .toThrow(/insufficient available shares/i);
  });
});

describe('OrderLifecycleService ambiguity and cancellation', () => {
  let db: Database.Database;
  let lifecycle: OrderLifecycleService;
  let quote: any;
  beforeEach(() => {
    db = createLifecycleDb();
    lifecycle = new OrderLifecycleService(db);
    quote = new QuoteService().create(quoteInput());
  });
  afterEach(() => db.close());

  it('keeps an ambiguous submission reserved and requiring reconciliation', () => {
    const id = lifecycle.reserve(makerIntent(quote.quoteId), quote, 3, 6.97674419);
    lifecycle.submitting(id);
    const row = lifecycle.ambiguous(id, Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }));
    expect(row.status).toBe('RECONCILING');
    expect(row.submissionResult).toBe('AMBIGUOUS');
    expect(row.reconciliationRequired).toBe(1);
    expect(db.prepare('SELECT state FROM reservations WHERE orderId=?').get(id)).toMatchObject({ state: 'RECONCILING' });
    expect(isAmbiguousSubmissionError({ status: 503 })).toBe(true);
  });

  it('replays the same local reservation for a duplicate request ID', () => {
    const firstId = lifecycle.reserve(makerIntent(quote.quoteId), quote, 3, 6.97674419);
    const replayedId = lifecycle.reserve(makerIntent(quote.quoteId), quote, 3, 6.97674419);
    expect(replayedId).toBe(firstId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE clientRequestId=?').get('request-1'))
      .toMatchObject({ count: 1 });
  });

  it('does not release inventory until cancellation is confirmed', () => {
    const sellQuote = new QuoteService().create(quoteInput({ side: 'SELL', requestedDollars: undefined, requestedShares: 5, referencePrice: 0.57, makerBoundary: 0.56 }));
    const intent = makerIntent(sellQuote.quoteId, { requestId: 'sell-1', side: 'SELL', dollarSpend: undefined, shares: '5' });
    const id = lifecycle.reserve(intent, sellQuote, 2.9, 5);
    lifecycle.markCancelPending(id);
    expect(lifecycle.get(id).status).toBe('CANCEL_PENDING');
    expect(db.prepare('SELECT state FROM reservations WHERE orderId=?').get(id)).toMatchObject({ state: 'RESERVED' });
    lifecycle.confirmCancelled(id);
    expect(lifecycle.get(id).status).toBe('CANCELLED');
    expect(db.prepare('SELECT state FROM reservations WHERE orderId=?').get(id)).toMatchObject({ state: 'RELEASED' });
  });

  it('releases a reservation in the same transaction as a terminal FAK response', () => {
    const immediateQuote = new QuoteService().create(quoteInput({ executionMode: 'IMMEDIATE', makerBoundary: undefined }));
    const intent = makerIntent(immediateQuote.quoteId, { executionMode: 'IMMEDIATE', orderType: 'FAK' });
    const id = lifecycle.reserve(intent, immediateQuote, 3, 6.97674419);
    lifecycle.submitting(id);
    lifecycle.accepted(id, { remoteOrderId: 'remote-filled', status: 'FILLED', filledShares: '6.97674419', remainingShares: '0' });
    expect(db.prepare('SELECT state FROM reservations WHERE orderId=?').get(id)).toMatchObject({ state: 'RELEASED' });
  });
});
