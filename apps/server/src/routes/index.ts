import { FastifyInstance } from 'fastify';
import nodeCrypto from 'crypto';
import { adapter, getLocalAuthToken } from '../index';
import { getDb } from '../db/index';
import { z } from 'zod';
import { SocketStream } from '@fastify/websocket';
import { getRtdsMetrics, setActiveMarketAnchor, getMarketAnchor } from '../integrations/polymarket/rtds';
import {
  ClientCommandEnvelopeSchema,
  LiveReadiness,
  OperationalState,
  OrderIntentSchema,
  PROTOCOL_VERSION,
  WsEventSchema,
} from '@polymarket-btc/shared';
import { getAllowedExtensionOrigin, loadConfig } from '../config';
import { ExecutionService, PresetEngine } from './trading';

const CancelOrderSchema = z.object({
  orderId: z.string().min(1)
});

const SubscribeMarketSchema = z.object({
  conditionId: z.string().min(1),
  yesTokenId: z.string().optional(),
  noTokenId: z.string().optional(),
  upTokenId: z.string().optional(),
  downTokenId: z.string().optional(),
});

const PageAnchorSchema = z.object({
  slug: z.string().min(1),
  priceToBeat: z.string().refine(v => {
    const parsed = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0;
  }),
});

let liveArmedState = false;
let armTimeout: NodeJS.Timeout | null = null;
// Start each process above any prior in-memory revision so connected extension
// tabs can replace a cached snapshot immediately after a backend restart.
let snapshotRevision = Date.now();
let executionService: ExecutionService | null = null;
let lastAccountState: any = null;
let lastAccountStateAt = 0;
let activeTradingSessionId: string | null = null;
const PANEL_ORDER_RECENCY_MS = 2 * 60 * 60 * 1000;
const ACTIVE_ORDER_STATUS_SQL = "'PENDING','OPEN','NEW','LIVE','SUBMITTING','ACCEPTED','PARTIALLY_FILLED','CANCEL_PENDING','RECONCILING'";
const POSITION_EPSILON = 0.000001;

async function refreshAccountState(): Promise<void> {
  if (!adapter?.getIsConnected()) return;
  const account = await adapter.getAccountState();
  lastAccountState = account;
  lastAccountStateAt = Date.now();
}

function normalizeOrderRow(row: any): any {
  if (!row) return row;
  const normalized = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
  return {
    ...normalized,
    reconciliationRequired: Boolean(row.reconciliationRequired),
    timestamp: row.createdAt || row.updatedAt || Date.now(),
  };
}

function getPanelOrders(db: any): any[] {
  return (db.prepare(`
    SELECT * FROM orders
    WHERE status IN (${ACTIVE_ORDER_STATUS_SQL})
       OR createdAt >= ?
    ORDER BY createdAt DESC
    LIMIT 100
  `).all(Date.now() - PANEL_ORDER_RECENCY_MS) as any[]).map(normalizeOrderRow);
}

function getPanelPresets(db: any): any[] {
  return (db.prepare('SELECT * FROM presets').all() as any[]).flatMap(row => {
    try {
      return [{ id: row.id, name: row.name, ...JSON.parse(row.config) }];
    } catch {
      return [];
    }
  });
}

function getPanelSettings(db: any): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

function persistPlacedOrder(db: any, values: {
  order: any;
  requestId: string;
  currentMarket: any;
  tokenId: string;
  outcome?: 'UP' | 'DOWN';
  side: 'BUY' | 'SELL';
  dollarSpend?: string;
  presetId?: string;
}) {
  const now = Date.now();
  const order = values.order;
  const conditionId = order.conditionId || values.currentMarket?.conditionId || '';
  const dollarSpend = order.dollarSpend || values.dollarSpend || '0';
  const filledShares = order.filledShares || '0';
  const averageFillPrice = order.averageFillPrice || null;
  const fees = order.fees || '0';
  const status = order.status || 'ACCEPTED';
  const remoteState = order.state || order.remoteState || status;

  db.prepare(`
    INSERT INTO orders (
      id, clientRequestId, remoteOrderId, conditionId, tokenId, outcome, side,
      dollarSpend, size, price, presetId, filledShares, averageFillPrice, fees,
      status, remoteState, createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      clientRequestId = COALESCE(excluded.clientRequestId, orders.clientRequestId),
      remoteOrderId = COALESCE(excluded.remoteOrderId, orders.remoteOrderId),
      conditionId = COALESCE(NULLIF(excluded.conditionId, ''), orders.conditionId),
      tokenId = excluded.tokenId,
      outcome = COALESCE(excluded.outcome, orders.outcome),
      side = excluded.side,
      dollarSpend = CASE WHEN excluded.dollarSpend != '0' THEN excluded.dollarSpend ELSE orders.dollarSpend END,
      size = CASE WHEN orders.status = 'FILLED' THEN orders.size ELSE excluded.size END,
      price = CASE WHEN orders.status = 'FILLED' THEN orders.price ELSE excluded.price END,
      presetId = COALESCE(NULLIF(excluded.presetId, ''), orders.presetId),
      filledShares = CASE WHEN orders.status IN ('FILLED', 'PARTIALLY_FILLED') THEN orders.filledShares ELSE excluded.filledShares END,
      averageFillPrice = COALESCE(orders.averageFillPrice, excluded.averageFillPrice),
      fees = CASE WHEN orders.status IN ('FILLED', 'PARTIALLY_FILLED') THEN orders.fees ELSE excluded.fees END,
      status = CASE WHEN orders.status IN ('FILLED', 'PARTIALLY_FILLED') THEN orders.status ELSE excluded.status END,
      remoteState = CASE WHEN orders.status IN ('FILLED', 'PARTIALLY_FILLED') THEN orders.remoteState ELSE excluded.remoteState END,
      updatedAt = excluded.updatedAt
  `).run(
    order.id,
    values.requestId,
    order.remoteOrderId || order.id,
    conditionId,
    values.tokenId,
    order.outcome || values.outcome || 'UP',
    values.side,
    dollarSpend,
    order.size || '0',
    order.price || '0',
    values.presetId || order.presetId || '',
    filledShares,
    averageFillPrice,
    fees,
    status,
    remoteState,
    order.createdAt || now,
    now
  );

  return normalizeOrderRow(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id));
}

function subscribeAdapterToMarket(market: any) {
  if (!market || !adapter) return;
  const upToken = market.upTokenId || market.yesTokenId;
  const downToken = market.downTokenId || market.noTokenId;
  if (market.conditionId && upToken && downToken) {
    adapter.subscribeToMarket(market.conditionId, upToken, downToken);
  }
}

let authoritativeMarketState: any = null;
let authoritativeMarketConditionId: string | null = null;
let authoritativeMarketRefreshedAt = 0;
let authoritativeMarketRefresh: Promise<any> | null = null;

async function getAuthoritativeMarket(force = false): Promise<any> {
  if (authoritativeMarketRefresh) return authoritativeMarketRefresh;
  if (!force && authoritativeMarketState && Date.now() - authoritativeMarketRefreshedAt < 200) {
    return authoritativeMarketState;
  }

  authoritativeMarketRefresh = (async () => {
    const discovery = (globalThis as any).discoveryService;
    const discovered = discovery?.getCurrentMarket?.() || null;
    if (!discovered?.conditionId || !adapter) {
      authoritativeMarketState = null;
      authoritativeMarketConditionId = null;
      authoritativeMarketRefreshedAt = Date.now();
      return null;
    }

    const changed = authoritativeMarketConditionId !== discovered.conditionId;
    if (changed) {
      disarmLive('MARKET_ROLLOVER');
      subscribeAdapterToMarket(discovered);
      setActiveMarketAnchor(discovered.conditionId, discovered.startTime || 0);
    }

    const bookState = await adapter.getMarketState(discovered.conditionId);
    const merged = { ...discovered, ...(bookState || {}) };
    const anchor = getMarketAnchor(merged.conditionId);
    const timeRemaining = merged.targetTime ? merged.targetTime - Date.now() : 0;
    merged.transitionPhase = timeRemaining <= loadConfig().MIN_TIME_REMAINING_MS
      ? 'CUTOFF'
      : (!merged.upBook || !merged.downBook || merged.stale)
        ? 'WAITING_FOR_BOOKS'
        : (!anchor?.validated ? 'VALIDATING_ANCHOR' : 'STEADY');
    if (merged.transitionPhase !== 'STEADY') disarmLive(`MARKET_${merged.transitionPhase}`);

    if (changed) {
      try {
        getDb().prepare(`INSERT INTO audit_events (category,action,payload,timestamp) VALUES ('MARKET','ROLLOVER',?,?)`)
          .run(JSON.stringify({ from: authoritativeMarketConditionId, to: merged.conditionId, phase: merged.transitionPhase }), Date.now());
      } catch {}
    }
    authoritativeMarketConditionId = merged.conditionId;
    authoritativeMarketState = merged;
    authoritativeMarketRefreshedAt = Date.now();
    return merged;
  })();

  try {
    return await authoritativeMarketRefresh;
  } finally {
    authoritativeMarketRefresh = null;
  }
}

async function getAvailableShares(db: any, tokenId: string): Promise<number> {
  const position = db.prepare(`SELECT netSize FROM positions WHERE tokenId = ?`).get(tokenId) as { netSize?: string } | undefined;
  const localShares = parseFloat(position?.netSize || '0');

  if (adapter) {
    const remoteShares = await adapter.getTokenBalance(tokenId);
    return Number.isFinite(remoteShares) ? Math.max(0, remoteShares) : 0;
  }

  return Number.isFinite(localShares) ? Math.max(0, localShares) : 0;
}

async function getPanelPositions(db: any, market?: any): Promise<any[]> {
  const rows = (db.prepare(`SELECT * FROM positions WHERE CAST(netSize AS REAL) > 0`).all() as any[]).map(row => ({
    ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
    feesKnown: Boolean(row.feesKnown),
  })) as any[];
  const byToken = new Map<string, any>(rows.map(position => [position.tokenId, position]));
  const marketTokens = [
    { tokenId: market?.upTokenId || market?.yesTokenId, outcome: 'UP' },
    { tokenId: market?.downTokenId || market?.noTokenId, outcome: 'DOWN' },
  ].filter(token => token.tokenId);

  for (const marketToken of marketTokens) {
    const remoteShares = adapter ? await adapter.getTokenBalance(marketToken.tokenId) : 0;
    if (!Number.isFinite(remoteShares) || remoteShares <= POSITION_EPSILON) {
      byToken.delete(marketToken.tokenId);
      continue;
    }

    const existing = byToken.get(marketToken.tokenId);
    const reservedShares = Number((db.prepare(`SELECT COALESCE(SUM(CAST(amount AS REAL)),0) amount FROM reservations
      WHERE assetType='SHARES' AND assetId=? AND state IN ('RESERVED','SUBMITTING','ACTIVE','RECONCILING')`)
      .get(marketToken.tokenId) as any)?.amount || 0);
    byToken.set(marketToken.tokenId, {
      ...(existing || {}),
      tokenId: marketToken.tokenId,
      conditionId: market?.conditionId || existing?.conditionId || '',
      outcome: existing?.outcome || marketToken.outcome,
      netSize: String(remoteShares),
      netShares: String(remoteShares),
      reservedShares: String(reservedShares),
      availableShares: String(Math.max(0, remoteShares - reservedShares)),
      avgPrice: existing?.avgPrice || '0',
      fees: existing?.fees || '0',
      unrealizedPnl: existing?.unrealizedPnl || 0,
      realizedPnl: existing?.realizedPnl || 0,
      updatedAt: Date.now(),
    });
  }

  return [...byToken.values()].filter(position => parseFloat(position.netSize || '0') > POSITION_EPSILON);
}

function armLive(durationMs: number = 300000) {
  liveArmedState = true;
  try {
    const db = getDb();
    if (activeTradingSessionId) {
      db.prepare('UPDATE trading_sessions SET endedAt=?,endingBalance=? WHERE id=? AND endedAt IS NULL')
        .run(Date.now(), String(lastAccountState?.collateralBalance ?? ''), activeTradingSessionId);
    }
    activeTradingSessionId = crypto.randomUUID();
    db.prepare(`INSERT INTO trading_sessions (id,startedAt,startingBalance) VALUES (?,?,?)`)
      .run(activeTradingSessionId, Date.now(), String(lastAccountState?.collateralBalance ?? ''));
    db.prepare(`INSERT INTO audit_events (category,action,payload,timestamp) VALUES ('EXECUTION','ARM',?,?)`)
      .run(JSON.stringify({ durationMs, sessionId: activeTradingSessionId }), Date.now());
  } catch {}
  if (armTimeout) clearTimeout(armTimeout);
  armTimeout = setTimeout(() => {
    disarmLive();
  }, durationMs);
}

export function disarmLive(_reason: string = 'OPERATOR') {
  liveArmedState = false;
  if (armTimeout) clearTimeout(armTimeout);
  armTimeout = null;
  try {
    const db = getDb();
    if (activeTradingSessionId) {
      db.prepare('UPDATE trading_sessions SET endedAt=?,endingBalance=? WHERE id=? AND endedAt IS NULL')
        .run(Date.now(), String(lastAccountState?.collateralBalance ?? ''), activeTradingSessionId);
      activeTradingSessionId = null;
    }
    db.prepare(`INSERT INTO audit_events (category,action,payload,timestamp) VALUES ('EXECUTION','DISARM',?,?)`)
      .run(JSON.stringify({ reason: _reason }), Date.now());
  } catch {}
}

function authenticatedHttp(request: any, reply: any, done: () => void) {
  const bearer = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (request.headers.origin !== getAllowedExtensionOrigin() || bearer !== getLocalAuthToken()) {
    reply.code(401).send({ error: 'Authenticated extension access required' });
    return;
  }
  done();
}

export function evaluateReadiness(activeMarket: any): LiveReadiness {
  const blockingReasons: string[] = [];
  const checks: any[] = [];
  const rtds = getRtdsMetrics();
  const enableLive = process.env.ENABLE_LIVE_TRADING === 'true';

  const backendConnected = true;
  const publicMarketConnected = !!activeMarket;
  const referenceConnected = rtds.connected;
  const selectedMarketValid = !!activeMarket && !!activeMarket.conditionId;
  const currentWindowValid = !!activeMarket
    && (activeMarket.startTime ? activeMarket.startTime <= Date.now() : true)
    && (activeMarket.targetTime ? activeMarket.targetTime > Date.now() : true);
  const accountConfigured = enableLive && !!process.env.PRIVATE_KEY;
  const accountAuthenticated = adapter ? adapter.getIsConnected() : false;
  const userStreamConnected = adapter ? adapter.getUserStreamConnected() : false;
  const balanceLoaded = !!lastAccountState && lastAccountState.balanceStale !== true && Date.now() - lastAccountStateAt < 10000;
  const allowanceValid = balanceLoaded && lastAccountState.allowanceValid === true;
  const reconciliationComplete = adapter ? adapter.getLastReconciliationTime() > 0 : false;
  const upBid = parseFloat(activeMarket?.upBid || '0');
  const upAsk = parseFloat(activeMarket?.upAsk || '0');
  const downBid = parseFloat(activeMarket?.downBid || '0');
  const downAsk = parseFloat(activeMarket?.downAsk || '0');
  const booksCoherent = upBid > 0 && upAsk > 0 && upBid <= upAsk && downBid > 0 && downAsk > 0 && downBid <= downAsk;
  const bookAgeMs = activeMarket?.lastUpdated ? Math.max(0, Date.now() - activeMarket.lastUpdated) : Number.MAX_SAFE_INTEGER;
  const marketDataFresh = publicMarketConnected && booksCoherent && !activeMarket?.stale
    && bookAgeMs < loadConfig().MAX_MARKET_DATA_AGE_MS;
  const referenceDataFresh = !rtds.stale;
  
  const minTimeRemainingMs = Number(process.env.MIN_TIME_REMAINING_MS || 10000);
  const timeLeft = activeMarket?.targetTime ? activeMarket.targetTime - Date.now() : 999999;
  const minimumTimeRemainingSatisfied = timeLeft > minTimeRemainingMs;

  if (!publicMarketConnected) blockingReasons.push('PUBLIC MARKET DISCOVERY DISCONNECTED');
  if (!referenceConnected) blockingReasons.push('CHAINLINK REFERENCE STREAM DISCONNECTED');
  if (!selectedMarketValid) blockingReasons.push('SELECTED MARKET INVALID OR UNRESOLVED');
  if (!currentWindowValid) blockingReasons.push('CURRENT 5-MINUTE WINDOW EXPIRED');
  if (!accountConfigured) blockingReasons.push('READ ONLY: LIVE CREDENTIALS NOT CONFIGURED');
  if (!accountAuthenticated) blockingReasons.push('READ ONLY: CLOB AUTHENTICATION INCOMPLETE');
  if (!userStreamConnected) blockingReasons.push('READ ONLY: USER ORDER STREAM DISCONNECTED');
  if (!balanceLoaded) blockingReasons.push('READ ONLY: ACCOUNT BALANCE IS NOT FRESH');
  if (!allowanceValid) blockingReasons.push('READ ONLY: COLLATERAL ALLOWANCE IS NOT CONFIRMED');
  if (!referenceDataFresh) blockingReasons.push(`BLOCKED: REFERENCE DATA IS STALE (${(rtds.dataAgeMs / 1000).toFixed(1)}s OLD)`);
  if (!marketDataFresh) blockingReasons.push(booksCoherent ? 'BLOCKED: MARKET DATA IS STALE' : 'BLOCKED: BOTH OUTCOME BOOKS MUST BE COHERENT');
  if (!minimumTimeRemainingSatisfied) blockingReasons.push(`BLOCKED: LESS THAN ${Math.round(minTimeRemainingMs / 1000)} SECONDS REMAINING`);

  const anchor = activeMarket ? getMarketAnchor(activeMarket.conditionId) : undefined;
  const anchorValid = !!anchor && anchor.validated && parseFloat(anchor.value) > 0
    && anchor.windowStart === activeMarket?.startTime
    && anchor.validationMethod !== 'CURRENT_SPOT';
  if (!anchorValid) blockingReasons.push('BLOCKED: OPENING PRICE ANCHOR NOT VALIDATED FOR THIS WINDOW');

  const unresolved = (() => {
    try { return Number((getDb().prepare("SELECT COUNT(*) count FROM orders WHERE reconciliationRequired=1 OR status IN ('UNKNOWN','RECONCILING')").get() as any)?.count || 0); }
    catch { return 1; }
  })();
  if (unresolved > 0) blockingReasons.push(`BLOCKED: ${unresolved} ORDER(S) REQUIRE RECONCILIATION`);

  if (!liveArmedState) blockingReasons.push('LIVE EXECUTION DISARMED');

  const healthBlockers = blockingReasons.filter(reason => reason !== 'LIVE EXECUTION DISARMED');
  if (liveArmedState && healthBlockers.length > 0) disarmLive('READINESS_LOST');
  checks.push(
    { code: 'BOOKS_COHERENT', subsystem: 'MARKET', ready: booksCoherent, message: booksCoherent ? 'Both books coherent' : 'Outcome books invalid' },
    { code: 'BOOK_AGE_MS', subsystem: 'MARKET', ready: marketDataFresh, message: 'Market book freshness', measuredValue: bookAgeMs, limitValue: loadConfig().MAX_MARKET_DATA_AGE_MS },
    { code: 'REFERENCE_AGE_MS', subsystem: 'REFERENCE', ready: referenceDataFresh, message: 'Reference freshness', measuredValue: rtds.dataAgeMs, limitValue: loadConfig().MAX_REFERENCE_DATA_AGE_MS },
    { code: 'ANCHOR_VALID', subsystem: 'REFERENCE', ready: anchorValid, message: 'Opening anchor validation', measuredValue: anchor?.validationMethod || 'MISSING' },
    { code: 'USER_STREAM', subsystem: 'ACCOUNT', ready: userStreamConnected, message: 'Authenticated private stream' },
    { code: 'RECONCILIATION', subsystem: 'RECOVERY', ready: reconciliationComplete && unresolved === 0, message: 'Remote/local reconciliation', measuredValue: unresolved, limitValue: 0 },
    { code: 'CUTOFF_MS', subsystem: 'RISK', ready: minimumTimeRemainingSatisfied, message: 'Time remaining', measuredValue: timeLeft, limitValue: minTimeRemainingMs },
  );
  return {
    backendConnected,
    publicMarketConnected,
    referenceConnected,
    selectedMarketValid,
    currentWindowValid,
    accountConfigured,
    accountAuthenticated,
    userStreamConnected,
    balanceLoaded,
    allowanceValid,
    reconciliationComplete,
    marketDataFresh,
    referenceDataFresh,
    minimumTimeRemainingSatisfied,
    liveEnabledByConfiguration: enableLive,
    liveArmed: liveArmedState,
    executionPermitted: liveArmedState && healthBlockers.length === 0,
    checks,
    revision: snapshotRevision,
    blockingReasons,
  };
}

export function determineOperationalState(readiness: LiveReadiness, activeMarket: any): OperationalState {
  if (!readiness.backendConnected) return 'OFFLINE';
  if (!readiness.accountConfigured || !readiness.accountAuthenticated) return 'READ_ONLY';
  if (!readiness.referenceDataFresh || !readiness.marketDataFresh) return 'STALE_DATA';
  if (activeMarket && activeMarket.targetTime && activeMarket.targetTime - Date.now() < 5000) return 'MARKET_SWITCHING';
  if (!readiness.liveArmed) return 'LIVE_DISARMED';
  if (readiness.blockingReasons.length === 0 && readiness.liveArmed) return 'LIVE_ARMED';
  return 'READ_ONLY';
}

export async function registerRoutes(app: FastifyInstance) {
  const db = getDb();
  executionService = new ExecutionService(db, adapter, disarmLive);
  (globalThis as any).disarmLive = disarmLive;
  app.get('/api/v1/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  app.get('/api/v1/readiness', async () => {
    const currentMarket = await getAuthoritativeMarket(true);
    try { await refreshAccountState(); } catch {}
    const readiness = evaluateReadiness(currentMarket);
    const state = determineOperationalState(readiness, currentMarket);
    return { operationalState: state, readiness };
  });

  app.post('/api/v1/live/disarm', async () => {
    const currentMarket = await getAuthoritativeMarket();
    disarmLive();
    const readiness = evaluateReadiness(currentMarket);
    const state = determineOperationalState(readiness, currentMarket);
    return { success: true, operationalState: state, readiness };
  });

  app.get('/api/v1/presets', { preHandler: authenticatedHttp }, async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM presets').all() as any[];
    if (rows.length === 0) {
      const crypto = require('crypto');
      const defaults = [
        { id: crypto.randomUUID(), name: 'Match Ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: 0, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '1c under ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: -0.01, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '15% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -15, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '20% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -20, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '50% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -50, active: true, clampMode: 'CLAMP' },
        
        { id: crypto.randomUUID(), name: 'Match Bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '1c over bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0.01, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '15% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 15, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '20% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 20, active: true, clampMode: 'CLAMP' },
        { id: crypto.randomUUID(), name: '50% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 50, active: true, clampMode: 'CLAMP' },
      ];
      const insert = db.prepare('INSERT INTO presets (id, name, config) VALUES (?, ?, ?)');
      defaults.forEach(d => insert.run(d.id, d.name, JSON.stringify(d)));
      return defaults;
    }
    return rows.map(r => ({ id: r.id, name: r.name, ...JSON.parse(r.config) }));
  });

  app.post('/api/v1/presets', { preHandler: authenticatedHttp }, async (request) => {
    const db = getDb();
    const crypto = require('crypto');
    const body = request.body as any;
    const id = body.id || crypto.randomUUID();
    db.prepare('INSERT INTO presets (id, name, config) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, config=excluded.config')
      .run(id, body.name || 'Preset', JSON.stringify(body));
    return { success: true, preset: { id, ...body } };
  });

  app.get('/api/settings', { preHandler: authenticatedHttp }, async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all() as { key: string, value: string }[];
    const map: Record<string, string> = {
      maxLoss: '10',
      maxProfit: '150',
      buySizesUsd: '[10,25,50,100]',
      sellPercentages: '[25,50,100]',
    };
    rows.forEach(r => { map[r.key] = r.value; });
    return map;
  });

  app.post('/api/settings', { preHandler: authenticatedHttp }, async (request) => {
    const db = getDb();
    const body = request.body as Record<string, any>;
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(body)) {
      insert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    return { success: true };
  });

  app.get('/api/positions', { preHandler: authenticatedHttp }, async () => {
    const db = getDb();
    const globalDiscoveryService = (globalThis as any).discoveryService;
    const currentMarket = globalDiscoveryService ? globalDiscoveryService.getCurrentMarket() : null;
    return getPanelPositions(db, currentMarket);
  });

  app.get('/api/balance', { preHandler: authenticatedHttp }, async () => {
    const balance = adapter ? await adapter.getBalance() : 0;
    return { balance };
  });

  app.get('/ws', { websocket: true }, (connection: SocketStream, req: any) => {
    if (req.headers?.origin !== getAllowedExtensionOrigin()) {
      connection.socket.close(1008, 'Configured extension origin required');
      return;
    }
    let activeMarketId: string | null = null;
    let isAuthenticated = false;
    let helloAccepted = false;
    const sessionId = crypto.randomUUID();
    let pairingToken: string | null = nodeCrypto.randomBytes(32).toString('hex');
    (connection.socket as any).sessionId = sessionId;

    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) connection.socket.close();
    }, 5000);
    
    const intervalId = setInterval(async () => {
      if (!isAuthenticated) return;
      try {
        const db = getDb();
        const globalDiscoveryService = (globalThis as any).discoveryService;
        const currentMarket = await getAuthoritativeMarket(true);
        const markets = globalDiscoveryService ? globalDiscoveryService.getMarkets() : [];
        if (!activeMarketId && currentMarket?.conditionId) {
          activeMarketId = currentMarket.conditionId;
          subscribeAdapterToMarket(currentMarket);
        }
        if (activeMarketId !== currentMarket?.conditionId) activeMarketId = currentMarket?.conditionId || null;

        if (currentMarket) {
          const activeMarket = currentMarket;
          const state = currentMarket;
          const timeRemaining = activeMarket.targetTime ? activeMarket.targetTime - Date.now() : 0;
          const anchor = getMarketAnchor(activeMarket.conditionId);
          activeMarket.transitionPhase = timeRemaining <= loadConfig().MIN_TIME_REMAINING_MS
            ? 'CUTOFF'
            : (!activeMarket.upBook || !activeMarket.downBook || activeMarket.stale)
              ? 'WAITING_FOR_BOOKS'
              : (!anchor?.validated ? 'VALIDATING_ANCHOR' : 'STEADY');
          if (activeMarket.transitionPhase !== 'STEADY') disarmLive(`MARKET_${activeMarket.transitionPhase}`);
          const readiness = evaluateReadiness(activeMarket);
          const operationalState = determineOperationalState(readiness, activeMarket);
          const positions = await getPanelPositions(db, activeMarket);
          const orders = getPanelOrders(db);
          const presets = getPanelPresets(db);
          const settings = getPanelSettings(db);
          const balance = adapter ? await adapter.getBalance() : 0;
          const account = adapter ? await adapter.getAccountState() : undefined;
          if (account) { lastAccountState = account; lastAccountStateAt = Date.now(); }
          const updateMarkets = markets.map((market: any) => market.conditionId === state.conditionId ? state : market);
          connection.socket.send(JSON.stringify({
            type: 'TERMINAL_SNAPSHOT',
            protocolVersion: PROTOCOL_VERSION,
            payload: {
              protocolVersion: PROTOCOL_VERSION,
              revision: ++snapshotRevision,
              publishedAt: Date.now(),
              market: activeMarket,
              anchor,
              readiness,
              operationalState,
              reference: getRtdsMetrics(),
              positions,
              orders,
              presets,
              settings,
              realizedPnl: 0,
              balance,
              account,
              markets: updateMarkets,
            }
          }));
          db.prepare('UPDATE outbox_events SET publishedAt=? WHERE publishedAt IS NULL').run(Date.now());
        }
      } catch (err) {
        disarmLive('SNAPSHOT_FAILURE');
        app.log.error(err, 'Failed to publish terminal snapshot');
      }
    }, 1000);

    connection.socket.on('message', async (message: any) => {
      let requestId: string | undefined;
      let requestType: string | undefined;
      try {
        const rawPayload = JSON.parse(message.toString());
        requestId = typeof rawPayload?.id === 'string' ? rawPayload.id : undefined;
        requestType = typeof rawPayload?.type === 'string' ? rawPayload.type : undefined;
        const parsedCommand = ClientCommandEnvelopeSchema.safeParse(rawPayload);
        const detailedCommand = WsEventSchema.safeParse(rawPayload);
        if (!parsedCommand.success || !detailedCommand.success) {
          connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION,
            id: rawPayload?.id, payload: { code: 'INVALID_MESSAGE', message: 'Invalid or incompatible command' } }));
          return;
        }
        const payload = detailedCommand.data as any;
        const db = getDb();
        const globalDiscoveryService = (globalThis as any).discoveryService;
        
        if (payload.type === 'HELLO') {
          if (helloAccepted) {
            connection.socket.close(1008, 'HELLO already accepted');
            return;
          }
          helloAccepted = true;
          connection.socket.send(JSON.stringify({ type: 'HELLO_ACK', protocolVersion: PROTOCOL_VERSION, id: payload.id,
            payload: { protocolVersion: PROTOCOL_VERSION, serverVersion: '3.0.0', sessionId, pairingToken } }));
          return;
        }

        if (payload.type === 'AUTH') {
          if (!helloAccepted) {
            connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { code: 'HELLO_REQUIRED', message: 'Protocol handshake is required before authentication' } }));
            connection.socket.close(1008, 'HELLO required');
            return;
          }
          const suppliedToken = String(payload.payload?.token || '');
          const tokenMatches = pairingToken !== null && suppliedToken.length === pairingToken.length
            && nodeCrypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(pairingToken));
          if (tokenMatches) {
            pairingToken = null;
            isAuthenticated = true;
            (connection.socket as any).terminalAuthenticated = true;
            getDb().prepare(`INSERT INTO extension_sessions (id,origin,protocolVersion,authenticatedAt,lastSeenAt)
              VALUES (?,?,?,?,?)`).run(sessionId, req.headers.origin, PROTOCOL_VERSION, Date.now(), Date.now());
            getDb().prepare(`INSERT INTO connection_events (subsystem,state,reason,timestamp) VALUES ('EXTENSION','AUTHENTICATED',?,?)`)
              .run(req.headers.origin, Date.now());
            clearTimeout(authTimeout);
            connection.socket.send(JSON.stringify({ type: 'AUTH_OK', protocolVersion: PROTOCOL_VERSION, id: payload.id }));
          } else {
            connection.socket.send(JSON.stringify({ type: 'AUTH_ERROR', protocolVersion: PROTOCOL_VERSION, payload: { message: 'Invalid local auth token' }, id: payload.id }));
            connection.socket.close();
          }
          return;
        }

        if (!isAuthenticated) {
          connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION,
            id: payload.id, payload: { code: 'AUTH_REQUIRED', message: 'Authenticate before sending commands' } }));
          return;
        }
        const currentMarket = await getAuthoritativeMarket(true);
        getDb().prepare('UPDATE extension_sessions SET lastSeenAt=? WHERE id=?').run(Date.now(), sessionId);

        if (payload.type === 'ARM_LIVE') {
          if (!isAuthenticated) return;
          const duration = payload.payload?.durationSeconds ? payload.payload.durationSeconds * 1000 : 300000;
          try { await refreshAccountState(); } catch {}
          const readinessBeforeArm = evaluateReadiness(currentMarket);
          const blockersBeforeArm = readinessBeforeArm.blockingReasons.filter((reason: string) => reason !== 'LIVE EXECUTION DISARMED');
          if (blockersBeforeArm.length > 0) {
            connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id, payload: { ...readinessBeforeArm, revision: ++snapshotRevision } }));
            connection.socket.send(JSON.stringify({
              type: 'ERROR', protocolVersion: PROTOCOL_VERSION,
              id: payload.id,
              payload: { message: `Cannot arm live trading: ${blockersBeforeArm.join('; ')}` },
              error: `Cannot arm live trading: ${blockersBeforeArm.join('; ')}`
            }));
            return;
          }
          armLive(duration);
          const readiness = evaluateReadiness(currentMarket);
          connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id, payload: { ...readiness, revision: ++snapshotRevision } }));
          return;
        }

        if (payload.type === 'DISARM_LIVE') {
          if (!isAuthenticated) return;
          disarmLive();
          const readiness = evaluateReadiness(currentMarket);
          connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id, payload: { ...readiness, revision: ++snapshotRevision } }));
          return;
        }

        if (payload.type === 'SNAPSHOT_REQUEST') {
          if (!isAuthenticated) return;
          const refreshedMarket = await getAuthoritativeMarket(true);
          const readiness = evaluateReadiness(refreshedMarket);
          const operationalState = determineOperationalState(readiness, refreshedMarket);
          if (refreshedMarket?.conditionId) {
            activeMarketId = refreshedMarket.conditionId;
          }
          const discoveredMarkets = globalDiscoveryService ? globalDiscoveryService.getMarkets() : [];
          const snapshotMarkets = refreshedMarket
            ? discoveredMarkets.map((market: any) => market.conditionId === refreshedMarket.conditionId ? refreshedMarket : market)
            : discoveredMarkets;

          const orders = getPanelOrders(db);
          const positions = await getPanelPositions(db, refreshedMarket);
          const balance = adapter ? await adapter.getBalance() : 0;
          const account = adapter ? await adapter.getAccountState() : undefined;
          if (account) { lastAccountState = account; lastAccountStateAt = Date.now(); }
          
          const presets = getPanelPresets(db);
          const settings = getPanelSettings(db);

          const anchor = refreshedMarket ? getMarketAnchor(refreshedMarket.conditionId) : undefined;

          connection.socket.send(JSON.stringify({
            type: 'TERMINAL_SNAPSHOT', protocolVersion: PROTOCOL_VERSION,
            id: payload.id,
            payload: {
              protocolVersion: PROTOCOL_VERSION,
              revision: ++snapshotRevision,
              publishedAt: Date.now(),
              operationalState,
              readiness,
              account,
              market: refreshedMarket,
              markets: snapshotMarkets,
              anchor,
              reference: getRtdsMetrics(),
              orders,
              positions,
              balance,
              realizedPnl: 0,
              presets,
              settings
            }
          }));
          return;
        }

        if (payload.type === 'REQUEST_QUOTES') {
          const market = currentMarket && currentMarket.conditionId === payload.payload?.conditionId
            ? await adapter.getMarketState(currentMarket.conditionId) : null;
          if (!market || market.stale) throw new Error('Authoritative current market book is unavailable or stale');
          const outcome = payload.payload?.outcome as 'UP' | 'DOWN';
          const tokenId = outcome === 'UP' ? (market.upTokenId || market.yesTokenId) : (market.downTokenId || market.noTokenId);
          const bid = parseFloat(outcome === 'UP' ? market.upBid : market.downBid);
          const ask = parseFloat(outcome === 'UP' ? market.upAsk : market.downAsk);
          if (!tokenId || !(bid > 0) || !(ask > 0) || bid > ask) throw new Error('Both coherent outcome books are required');
          const revision = Number(market.revision || market.lastUpdated || 0);
          const bookVersion = Number((outcome === 'UP' ? market.upBook?.version : market.downBook?.version) || revision);
          const tick = parseFloat(market.tickSize || '0.01');
          const slippage = Math.min(loadConfig().MAX_FAK_SLIPPAGE_BPS, Number(payload.payload?.slippageBps || 0)) / 10000;
          const presetEngine = new PresetEngine();
          const presets = (db.prepare('SELECT * FROM presets').all() as any[])
            .map(row => { try { return { id: row.id, name: row.name, ...JSON.parse(row.config) }; } catch { return null; } })
            .filter(Boolean).filter((preset: any) => preset.active !== false);
          const makerQuotes = presets.flatMap((preset: any) => {
            const side = preset.side as 'BUY' | 'SELL';
            const referenceType = preset.reference || (side === 'BUY' ? 'BEST_ASK' : 'BEST_BID');
            const reference = referenceType === 'BEST_BID' ? bid : referenceType === 'BEST_ASK' ? ask : (bid + ask) / 2;
            const rawTarget = presetEngine.calculateRaw(reference, preset.mode, Number(preset.value || 0));
            const target = Math.max(tick, Math.min(1 - tick, rawTarget));
            const roundedTarget = presetEngine.round(target, tick, side);
            const makerBoundary = side === 'BUY' ? ask : bid;
            const wouldClamp = rawTarget !== target || (side === 'BUY' ? roundedTarget >= makerBoundary : roundedTarget <= makerBoundary);
            if (preset.clampMode === 'DISABLE' && wouldClamp) return [];

            try {
              return [{ ...executionService!.quotes.create({ conditionId: market.conditionId, tokenId, outcome, side, executionMode: 'MAKER',
                referenceType, referencePrice: target, makerBoundary, tickSize: tick,
                marketRevision: revision, bookVersion, requestedDollars: Number(payload.payload?.requestedDollars || 0),
                requestedShares: Number(payload.payload?.requestedShares || 0) }), presetId: preset.id }];
            } catch (error) {
              if (error instanceof Error && error.message === 'Quote is outside the valid price range') return [];
              throw error;
            }
          });
          const quotes = [...makerQuotes,
            executionService!.quotes.create({ conditionId: market.conditionId, tokenId, outcome, side: 'BUY', executionMode: 'IMMEDIATE',
              referenceType: 'BEST_ASK', referencePrice: ask * (1 + slippage), tickSize: tick, marketRevision: revision, bookVersion,
              requestedDollars: Number(payload.payload?.requestedDollars || 0) }),
            executionService!.quotes.create({ conditionId: market.conditionId, tokenId, outcome, side: 'SELL', executionMode: 'IMMEDIATE',
              referenceType: 'BEST_BID', referencePrice: bid * (1 - slippage), tickSize: tick, marketRevision: revision, bookVersion,
              requestedShares: Number(payload.payload?.requestedShares || 0) }),
          ];
          connection.socket.send(JSON.stringify({ type: 'EXECUTABLE_QUOTES_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id,
            payload: { conditionId: market.conditionId, outcome, marketRevision: revision, revision: ++snapshotRevision, quotes } }));
          return;
        }

        if (payload.type === 'PLACE_ORDER_INTENT') {
          const validation = OrderIntentSchema.safeParse(payload.payload);
          if (!validation.success) throw new Error('Invalid order intent');
          const intent = validation.data;
          if (!intent.quoteId) throw new Error('Executable quote is required');
          if (!currentMarket || currentMarket.conditionId !== intent.conditionId) throw new Error('Order is not bound to the authoritative current market');
          const authoritativeToken = intent.outcome === 'UP'
            ? (currentMarket.upTokenId || currentMarket.yesTokenId) : (currentMarket.downTokenId || currentMarket.noTokenId);
          if (!authoritativeToken || authoritativeToken !== intent.tokenId) throw new Error('Order token does not match the selected market outcome');
          const readiness = evaluateReadiness(currentMarket);
          if (!readiness.executionPermitted) throw new Error(`Order blocked: ${readiness.blockingReasons.join('; ')}`);
          const market = await adapter.getMarketState(currentMarket.conditionId);
          const revision = Number(market?.revision || market?.lastUpdated || 0);
          const bookVersion = Number((intent.outcome === 'UP' ? market?.upBook?.version : market?.downBook?.version) || revision);
          const currentBid = parseFloat(intent.outcome === 'UP' ? market?.upBid || '0' : market?.downBid || '0');
          const currentAsk = parseFloat(intent.outcome === 'UP' ? market?.upAsk || '0' : market?.downAsk || '0');
          const prior = db.prepare('SELECT status,response,createdAt FROM idempotency WHERE requestId=?').get(intent.requestId) as any;
          if (prior?.response) { connection.socket.send(prior.response); return; }
          if (prior) {
            const order = db.prepare('SELECT * FROM orders WHERE clientRequestId=?').get(intent.requestId) as any;
            const result = order
              ? { result: order.submissionResult || 'AMBIGUOUS', requestId: intent.requestId, orderId: order.id,
                  remoteOrderId: order.remoteOrderId || undefined, requestedAmount: intent.side === 'BUY' ? order.dollarSpend : order.requestedShares,
                  executedAmount: order.filledShares || '0', unfilledAmount: order.remainingShares || undefined,
                  filledShares: order.filledShares || '0', averageExecutionPrice: order.averageFillPrice || undefined,
                  fee: order.fees || undefined, remoteTradeIds: [], errorMessage: order.errorMessage || 'Recovered request requires reconciliation' }
              : { result: 'REJECTED', requestId: intent.requestId, orderId: `interrupted_${intent.requestId}`,
                  remoteTradeIds: [], errorCode: 'INTERRUPTED_BEFORE_RESERVATION', errorMessage: 'The prior request stopped before a local order was reserved' };
            if (order && !order.submissionResult) {
              db.prepare("UPDATE orders SET status='RECONCILING',remoteState='UNKNOWN',submissionResult='AMBIGUOUS',reconciliationRequired=1,updatedAt=? WHERE id=?")
                .run(Date.now(), order.id);
              disarmLive('RECOVERED_IN_PROGRESS_ORDER');
            }
            const replay = JSON.stringify({ type: 'ORDER_RESULT', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { ...result, revision: ++snapshotRevision } });
            db.prepare('UPDATE idempotency SET status=?,response=?,updatedAt=? WHERE requestId=?')
              .run(result.result, replay, Date.now(), intent.requestId);
            connection.socket.send(replay);
            return;
          }
          db.prepare("INSERT INTO idempotency (requestId,status,createdAt,updatedAt) VALUES (?,'RESERVED',?,?)")
            .run(intent.requestId, Date.now(), Date.now());
          try {
            const quote = executionService!.quotes.consume(intent.quoteId, intent, { marketRevision: revision, bookVersion, currentBid, currentAsk });
            const requestedShares = intent.side === 'BUY'
              ? parseFloat(intent.dollarSpend || '0') / parseFloat(quote.submittedPrice)
              : parseFloat(intent.shares || '0');
            if (requestedShares < parseFloat(currentMarket.minimumOrderSize || '0')) {
              throw new Error(`Order is below the ${currentMarket.minimumOrderSize} share minimum`);
            }
            const response = await executionService!.submit(intent, quote, {
              balance: await adapter.getBalance(), availableShares: await getAvailableShares(db, intent.tokenId),
            });
            const responseText = JSON.stringify({ type: 'ORDER_RESULT', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { ...response, revision: ++snapshotRevision } });
            db.prepare('UPDATE idempotency SET status=?,response=?,updatedAt=? WHERE requestId=?')
              .run(response.result, responseText, Date.now(), intent.requestId);
            connection.socket.send(responseText);
          } catch (error: any) {
            const responseText = JSON.stringify({ type: 'ERROR', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { message: error.message, code: 'ORDER_REJECTED' } });
            db.prepare("UPDATE idempotency SET status='FAILED',response=?,updatedAt=? WHERE requestId=?")
              .run(responseText, Date.now(), intent.requestId);
            connection.socket.send(responseText);
          }
          return;
        }

        if (payload.type === 'PLACE_ORDER') {
          connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION, id: payload.id,
            payload: { code: 'QUOTE_REQUIRED', message: 'Legacy unquoted order submission is disabled; request an executable quote' } }));
          return;
          /* Legacy implementation retained temporarily below for historical comparison only.
          if (!isAuthenticated) return;
          
          const requestId = payload.id || crypto.randomUUID();

          try {
            db.prepare(`INSERT INTO idempotency (requestId, status, createdAt, updatedAt) VALUES (?, 'RESERVED', ?, ?)`).run(requestId, Date.now(), Date.now());
          } catch (e: any) {
            const existing = db.prepare(`SELECT response FROM idempotency WHERE requestId = ?`).get(requestId) as any;
            if (existing && existing.response) {
              connection.socket.send(existing.response);
              return;
            } else {
              connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Duplicate order request in progress', id: requestId }));
              return;
            }
          }

          const readiness = evaluateReadiness(currentMarket);
          if (readiness.blockingReasons.length > 0) {
            db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
            connection.socket.send(JSON.stringify({ 
              type: 'ERROR', 
              payload: { message: `Order blocked: ${readiness.blockingReasons.join('; ')}` },
              error: `Order blocked: ${readiness.blockingReasons.join('; ')}`, 
              id: requestId 
            }));
            return;
          }

          const validation = PlaceOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters', id: requestId }));
            return;
          }

          const { tokenId, outcome, side, dollarSpend, size, price, presetId, executionMode, slippageBps } = validation.data;
          const requestedShares = parseFloat(size);
          const requestedPrice = parseFloat(price);
          const requestedSpend = dollarSpend ? parseFloat(dollarSpend) : requestedShares * requestedPrice;
          const minimumOrderSize = parseFloat(currentMarket?.minimumOrderSize || '0');

          if (minimumOrderSize > 0 && requestedShares < minimumOrderSize) {
            db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
            connection.socket.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: `Order blocked: minimum size is ${minimumOrderSize} shares` },
              error: `Order blocked: minimum size is ${minimumOrderSize} shares`,
              id: requestId
            }));
            return;
          }

          if (side === 'BUY') {
            const balance = adapter ? await adapter.getBalance() : 0;
            if (!Number.isFinite(requestedSpend) || requestedSpend <= 0 || requestedSpend > balance) {
              db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
              connection.socket.send(JSON.stringify({
                type: 'ERROR',
                payload: { message: `Order blocked: insufficient balance for $${requestedSpend.toFixed(2)} buy` },
                error: `Order blocked: insufficient balance for $${requestedSpend.toFixed(2)} buy`,
                id: requestId
              }));
              return;
            }
          } else {
            const availableShares = await getAvailableShares(db, tokenId);
            if (!Number.isFinite(requestedShares) || requestedShares <= 0 || requestedShares > availableShares + POSITION_EPSILON) {
              db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
              connection.socket.send(JSON.stringify({
                type: 'ERROR',
                payload: { message: `Order blocked: only ${availableShares.toFixed(4)} shares available to sell` },
                error: `Order blocked: only ${availableShares.toFixed(4)} shares available to sell`,
                id: requestId
              }));
              return;
            }
          }
          
          try {
            db.prepare(`UPDATE idempotency SET status='SUBMITTING', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);

            if (!adapter) throw new Error('Adapter not initialized');
            const order = executionMode === 'ONE_TAP'
              ? await adapter.placeMarketOrder(tokenId, side, side === 'BUY' ? String(requestedSpend) : size, slippageBps)
              : await adapter.placeOrder(tokenId, side, size, price);
            order.clientRequestId = requestId;
            order.outcome = outcome;
            order.dollarSpend = dollarSpend;
            order.presetId = presetId;
            order.conditionId = currentMarket?.conditionId;

            const storedOrder = persistPlacedOrder(db, {
              order,
              requestId,
              currentMarket,
              tokenId,
              outcome,
              side,
              dollarSpend,
              presetId,
            });
            
            const responseMsg = JSON.stringify({ 
               type: 'ORDER_UPDATE', 
               id: requestId,
               payload: storedOrder || order
            });

            db.prepare(`UPDATE idempotency SET status='COMPLETED', response=?, updatedAt=? WHERE requestId=?`).run(responseMsg, Date.now(), requestId);
            connection.socket.send(responseMsg);
          } catch (err: any) {
            db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message, id: requestId }));
          }
        } */
        }
        else if (payload.type === 'CANCEL_ORDER') {
          if (!isAuthenticated) return;
          const validation = CancelOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', protocolVersion: PROTOCOL_VERSION, error: 'Invalid order parameters', id: payload.id }));
            return;
          }

          const { orderId } = validation.data;
          try {
            if (!adapter) throw new Error('Adapter not initialized');
            const localOrder = db.prepare('SELECT * FROM orders WHERE id=? OR remoteOrderId=?').get(orderId, orderId) as any;
            if (!localOrder) throw new Error('Order not found');
            executionService!.lifecycle.markCancelPending(localOrder.id);
            const success = await adapter.cancelOrder(localOrder.remoteOrderId || localOrder.id);
            if (success) {
              executionService!.lifecycle.confirmCancelled(localOrder.id);
            } else {
              db.transaction(() => {
                db.prepare(`UPDATE orders SET status='RECONCILING',remoteState='CANCEL_UNKNOWN',reconciliationRequired=1,updatedAt=? WHERE id=?`)
                  .run(Date.now(), localOrder.id);
              })();
              disarmLive('AMBIGUOUS_CANCELLATION');
            }
            const storedOrder = normalizeOrderRow(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(localOrder.id));
            const responseMsg = JSON.stringify({ type: 'ORDER_UPDATE', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { ...storedOrder, revision: ++snapshotRevision } });
            connection.socket.send(responseMsg);
          } catch (e: any) {
            const localOrder = db.prepare('SELECT id FROM orders WHERE id=? OR remoteOrderId=?').get(orderId, orderId) as any;
            if (localOrder) {
              db.transaction(() => {
                db.prepare(`UPDATE orders SET status='RECONCILING',remoteState='CANCEL_UNKNOWN',reconciliationRequired=1,errorMessage=?,updatedAt=? WHERE id=?`)
                  .run(e.message, Date.now(), localOrder.id);
                db.prepare("UPDATE reservations SET state='RECONCILING',updatedAt=? WHERE orderId=?").run(Date.now(), localOrder.id);
              })();
            }
            disarmLive('AMBIGUOUS_CANCELLATION');
            connection.socket.send(JSON.stringify({ type: 'ERROR', protocolVersion: PROTOCOL_VERSION, error: e.message, id: payload.id }));
          }
        }
        else if (payload.type === 'CANCEL_ALL') {
          if (!isAuthenticated) return;
          try {
            if (!adapter) throw new Error('Adapter not initialized');
            const result = await adapter.cancelAll();
            const localByRemoteId = new Map((db.prepare(`SELECT id,remoteOrderId FROM orders WHERE status IN (${ACTIVE_ORDER_STATUS_SQL}) AND remoteOrderId IS NOT NULL`).all() as any[])
              .map(order => [String(order.remoteOrderId), String(order.id)]));
            db.transaction(() => {
              for (const remoteOrderId of result.confirmedOrderIds) {
                const localId = localByRemoteId.get(remoteOrderId);
                if (localId) executionService!.lifecycle.confirmCancelled(localId);
              }
              for (const remoteOrderId of result.unresolvedOrderIds) {
                const localId = localByRemoteId.get(remoteOrderId);
                if (!localId) continue;
                db.prepare(`UPDATE orders SET status='RECONCILING',remoteState='CANCEL_UNKNOWN',reconciliationRequired=1,updatedAt=? WHERE id=?`)
                  .run(Date.now(), localId);
                db.prepare("UPDATE reservations SET state='RECONCILING',updatedAt=? WHERE orderId=?").run(Date.now(), localId);
              }
            })();
            if (result.unresolvedOrderIds.length === 0) {
              connection.socket.send(JSON.stringify({ type: 'COMMAND_ACCEPTED', protocolVersion: PROTOCOL_VERSION, id: payload.id,
                payload: { message: `${result.confirmedOrderIds.length} remote order(s) were confirmed cancelled` } }));
            } else {
              disarmLive('CANCEL_ALL_RECONCILIATION');
              connection.socket.send(JSON.stringify({ type: 'COMMAND_ACCEPTED', protocolVersion: PROTOCOL_VERSION, id: payload.id,
                payload: { message: `${result.unresolvedOrderIds.length} targeted cancellation(s) require reconciliation` } }));
            }
          } catch (e: any) {
            disarmLive('AMBIGUOUS_CANCEL_ALL');
            connection.socket.send(JSON.stringify({ type: 'ERROR', protocolVersion: PROTOCOL_VERSION, error: e.message, id: payload.id }));
          }
        }
        else if (payload.type === 'SUBSCRIBE_MARKET' || payload.type === 'SELECT_MARKET') {
          const conditionId = String(payload.payload?.conditionId || '');
          const selectedMarket = globalDiscoveryService
            ? globalDiscoveryService.getMarkets().find((market: any) => market.conditionId === conditionId) : null;
          if (!selectedMarket) throw new Error('Market is not present in authoritative discovery');
          activeMarketId = conditionId;
          subscribeAdapterToMarket(selectedMarket);
          setActiveMarketAnchor(conditionId, selectedMarket.startTime || 0);
        }
        else if (payload.type === 'PAGE_ANCHOR_UPDATE') {
          const validation = PageAnchorSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', protocolVersion: PROTOCOL_VERSION, error: 'Invalid page anchor update', id: payload.id }));
            return;
          }

          const markets = globalDiscoveryService ? globalDiscoveryService.getMarkets() : [];
          const current = globalDiscoveryService ? globalDiscoveryService.getCurrentMarket() : null;
          const selectedMarket = markets.find((market: any) => market.slug === validation.data.slug) || current;
          if (!selectedMarket || selectedMarket.slug !== validation.data.slug) return;

          connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION, id: payload.id,
            payload: { code: 'PAGE_CONTEXT_INFORMATIONAL', message: 'Page price is displayed for lag comparison and cannot change the execution market or opening anchor' } }));
        }
        else if (payload.type === 'UPDATE_SETTINGS' || payload.type === 'UPDATE_SIZE_PRESETS') {
          const body = payload.payload as Record<string, unknown>;
          const allowed = new Set(['maxLoss','maxProfit','buySizesUsd','sellPercentages','panelMode','dockSide','panelWidth','activeTab','executionMode','pageFollowPreference','cancelOnShutdown']);
          const insert = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
          db.transaction(() => {
            for (const [key, value] of Object.entries(body || {})) {
              if (!allowed.has(key)) throw new Error(`Unsupported setting: ${key}`);
              insert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
          })();
          connection.socket.send(JSON.stringify({ type: 'SETTINGS_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id, payload: { ...body, revision: ++snapshotRevision } }));
        }
        else if (payload.type === 'UPDATE_PRESETS') {
          const rows = z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).parse(payload.payload);
          const insert = db.prepare('INSERT INTO presets (id,name,config) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,config=excluded.config');
          db.transaction(() => rows.forEach(row => insert.run(row.id, row.name, JSON.stringify(row))))();
          connection.socket.send(JSON.stringify({ type: 'SETTINGS_UPDATED', protocolVersion: PROTOCOL_VERSION, id: payload.id, payload: { presets: rows, revision: ++snapshotRevision } }));
        }
        else if (payload.type === 'PING') {
          connection.socket.send(JSON.stringify({
            type: 'PONG',
            protocolVersion: PROTOCOL_VERSION,
            id: payload.id,
            payload: { timestamp: Date.now() },
          }));
        }
        else if (payload.type === 'RECONCILE') {
          const runId = crypto.randomUUID();
          db.prepare(`INSERT INTO reconciliation_runs (id,reason,status,startedAt) VALUES (?,'OPERATOR','RUNNING',?)`).run(runId, Date.now());
          try {
            await adapter.reconcile();
            const unresolved = Number((db.prepare("SELECT COUNT(*) count FROM orders WHERE reconciliationRequired=1 OR status='RECONCILING'").get() as any)?.count || 0);
            db.prepare(`UPDATE reconciliation_runs SET status=?,completedAt=?,unresolvedCount=? WHERE id=?`)
              .run(unresolved === 0 ? 'COMPLETED' : 'COMPLETED_WITH_DISCREPANCIES', Date.now(), unresolved, runId);
            connection.socket.send(JSON.stringify({ type: 'PROTOCOL_ERROR', protocolVersion: PROTOCOL_VERSION, id: payload.id,
              payload: { code: 'RECONCILIATION_COMPLETE', message: unresolved ? `${unresolved} item(s) still require review` : 'Reconciliation completed' } }));
          } catch (error: any) {
            db.prepare(`UPDATE reconciliation_runs SET status='FAILED',completedAt=?,errorMessage=? WHERE id=?`).run(Date.now(), error.message, runId);
            disarmLive('RECONCILIATION_FAILED');
            throw error;
          }
        }
      } catch (err: any) {
        connection.socket.send(JSON.stringify({
          type: 'ERROR',
          protocolVersion: PROTOCOL_VERSION,
          id: requestId,
          payload: {
            code: requestType === 'REQUEST_QUOTES' ? 'QUOTE_UNAVAILABLE' : 'COMMAND_REJECTED',
            message: err.message,
          },
          error: err.message,
        }));
      }
    });

    connection.socket.on('close', () => {
      clearInterval(intervalId);
      clearTimeout(authTimeout);
      try { getDb().prepare('UPDATE extension_sessions SET closedAt=?,lastSeenAt=? WHERE id=?').run(Date.now(), Date.now(), sessionId); } catch {}
      try { getDb().prepare(`INSERT INTO connection_events (subsystem,state,reason,timestamp) VALUES ('EXTENSION','DISCONNECTED',?,?)`).run(sessionId, Date.now()); } catch {}
    });
  });
}
