import { FastifyInstance } from 'fastify';
import { adapter, getLocalAuthToken } from '../index';
import { getDb } from '../db/index';
import { z } from 'zod';
import { SocketStream } from '@fastify/websocket';
import { getRtdsMetrics, isRtdsStale, setActiveMarketAnchor, getMarketAnchor } from '../integrations/polymarket/rtds';
import { LiveReadiness, OperationalState } from '@polymarket-btc/shared';

const PlaceOrderSchema = z.object({
  tokenId: z.string().min(1),
  outcome: z.enum(['UP', 'DOWN']).optional(),
  side: z.enum(['BUY', 'SELL']),
  dollarSpend: z.string().optional(),
  price: z.string().regex(/^0\.(\d+)$/).refine(v => parseFloat(v) > 0 && parseFloat(v) < 1),
  size: z.string().refine(v => parseFloat(v) > 0 && parseFloat(v) <= 100000),
  presetId: z.string().optional(),
  orderType: z.enum(['GTC']).optional().default('GTC')
});

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

let liveArmedState = false;
let armTimeout: NodeJS.Timeout | null = null;

function armLive(durationMs: number = 300000) {
  liveArmedState = true;
  if (armTimeout) clearTimeout(armTimeout);
  armTimeout = setTimeout(() => {
    disarmLive();
  }, durationMs);
}

function disarmLive() {
  liveArmedState = false;
  if (armTimeout) clearTimeout(armTimeout);
  armTimeout = null;
}

export function evaluateReadiness(activeMarket: any): LiveReadiness {
  const blockingReasons: string[] = [];
  const rtds = getRtdsMetrics();
  const enableLive = process.env.ENABLE_LIVE_TRADING === 'true';

  const backendConnected = true;
  const publicMarketConnected = !!activeMarket;
  const referenceConnected = rtds.connected;
  const selectedMarketValid = !!activeMarket && !!activeMarket.conditionId;
  const currentWindowValid = !!activeMarket && (activeMarket.targetTime ? activeMarket.targetTime > Date.now() : true);
  const accountConfigured = enableLive && !!process.env.PRIVATE_KEY;
  const accountAuthenticated = adapter ? adapter.getIsConnected() : false;
  const userStreamConnected = adapter ? adapter.getUserStreamConnected() : false;
  const balanceLoaded = accountAuthenticated;
  const allowanceValid = true;
  const reconciliationComplete = adapter ? adapter.getLastReconciliationTime() > 0 : false;
  const marketDataFresh = publicMarketConnected && (Date.now() - (activeMarket?.lastUpdated || 0) < 10000);
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
  if (!referenceDataFresh) blockingReasons.push(`BLOCKED: REFERENCE DATA IS STALE (${(rtds.dataAgeMs / 1000).toFixed(1)}s OLD)`);
  if (!marketDataFresh) blockingReasons.push('BLOCKED: MARKET DATA IS STALE');
  if (!minimumTimeRemainingSatisfied) blockingReasons.push(`BLOCKED: LESS THAN ${Math.round(minTimeRemainingMs / 1000)} SECONDS REMAINING`);

  const anchor = activeMarket ? getMarketAnchor(activeMarket.conditionId) : undefined;
  if (!anchor || !anchor.validated) blockingReasons.push('BLOCKED: OPENING PRICE ANCHOR NOT VALIDATED');

  if (!liveArmedState) blockingReasons.push('LIVE EXECUTION DISARMED');

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
  app.get('/api/v1/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  app.get('/api/v1/token', async () => {
    return { token: getLocalAuthToken() };
  });

  app.get('/api/v1/readiness', async () => {
    const globalDiscoveryService = (globalThis as any).discoveryService;
    const currentMarket = globalDiscoveryService ? globalDiscoveryService.getCurrentMarket() : null;
    const readiness = evaluateReadiness(currentMarket);
    const state = determineOperationalState(readiness, currentMarket);
    return { operationalState: state, readiness };
  });

  app.get('/api/v1/presets', async () => {
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

  app.post('/api/v1/presets', async (request) => {
    const db = getDb();
    const crypto = require('crypto');
    const body = request.body as any;
    const id = body.id || crypto.randomUUID();
    db.prepare('INSERT INTO presets (id, name, config) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, config=excluded.config')
      .run(id, body.name || 'Preset', JSON.stringify(body));
    return { success: true, preset: { id, ...body } };
  });

  app.get('/api/settings', async () => {
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

  app.post('/api/settings', async (request) => {
    const db = getDb();
    const body = request.body as Record<string, any>;
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(body)) {
      insert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    return { success: true };
  });

  app.get('/api/positions', async () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM positions WHERE CAST(netSize AS REAL) > 0`).all();
  });

  app.get('/api/balance', async () => {
    const balance = adapter ? await adapter.getBalance() : 0;
    return { balance };
  });

  app.get('/ws', { websocket: true }, (connection: SocketStream, req: any) => {
    let activeMarketId: string | null = null;
    let isAuthenticated = false;

    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) connection.socket.close();
    }, 3000);
    
    const intervalId = setInterval(async () => {
      if (activeMarketId) {
        try {
          const db = getDb();
          const globalDiscoveryService = (globalThis as any).discoveryService;
          const currentMarket = globalDiscoveryService ? globalDiscoveryService.getCurrentMarket() : null;
          const state = adapter ? await adapter.getMarketState(activeMarketId) : null;
          if (state) {
            const readiness = evaluateReadiness(currentMarket);
            const operationalState = determineOperationalState(readiness, currentMarket);
            const positions = db.prepare(`SELECT * FROM positions WHERE CAST(netSize AS REAL) > 0`).all() as any[];
            const balance = adapter ? await adapter.getBalance() : 0;
            connection.socket.send(JSON.stringify({ 
              type: 'MARKET_UPDATE', 
              payload: {
                ...state,
                readiness,
                operationalState,
                positions,
                balance,
              }
            }));
          }
        } catch (err) {
          // Ignore
        }
      }
    }, 1000);

    connection.socket.on('message', async (message: any) => {
      try {
        const payload = JSON.parse(message.toString());
        const db = getDb();
        const globalDiscoveryService = (globalThis as any).discoveryService;
        const currentMarket = globalDiscoveryService ? globalDiscoveryService.getCurrentMarket() : null;
        
        if (payload.type === 'AUTH') {
          const expectedToken = getLocalAuthToken();
          if (payload.payload && payload.payload.token === expectedToken) {
            isAuthenticated = true;
            clearTimeout(authTimeout);
            connection.socket.send(JSON.stringify({ type: 'AUTH_OK', id: payload.id }));
          } else {
            connection.socket.send(JSON.stringify({ type: 'AUTH_ERROR', payload: { message: 'Invalid local auth token' }, id: payload.id }));
            connection.socket.close();
          }
          return;
        }

        if (payload.type === 'ARM_LIVE') {
          if (!isAuthenticated) return;
          const duration = payload.payload?.durationSeconds ? payload.payload.durationSeconds * 1000 : 300000;
          const readinessBeforeArm = evaluateReadiness(currentMarket);
          const blockersBeforeArm = readinessBeforeArm.blockingReasons.filter(reason => reason !== 'LIVE EXECUTION DISARMED');
          if (blockersBeforeArm.length > 0) {
            connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', id: payload.id, payload: readinessBeforeArm }));
            connection.socket.send(JSON.stringify({
              type: 'ERROR',
              id: payload.id,
              payload: { message: `Cannot arm live trading: ${blockersBeforeArm.join('; ')}` },
              error: `Cannot arm live trading: ${blockersBeforeArm.join('; ')}`
            }));
            return;
          }
          armLive(duration);
          const readiness = evaluateReadiness(currentMarket);
          connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', id: payload.id, payload: readiness }));
          return;
        }

        if (payload.type === 'DISARM_LIVE') {
          if (!isAuthenticated) return;
          disarmLive();
          const readiness = evaluateReadiness(currentMarket);
          connection.socket.send(JSON.stringify({ type: 'READINESS_UPDATED', id: payload.id, payload: readiness }));
          return;
        }

        if (payload.type === 'SNAPSHOT_REQUEST') {
          if (!isAuthenticated) return;
          const readiness = evaluateReadiness(currentMarket);
          const operationalState = determineOperationalState(readiness, currentMarket);
          const refreshedMarket = currentMarket && adapter
            ? await adapter.getMarketState(currentMarket.conditionId)
            : null;

          const orders = db.prepare(`SELECT * FROM orders WHERE status IN ('PENDING', 'OPEN', 'NEW', 'LIVE', 'SUBMITTING')`).all() as any[];
          const positions = db.prepare(`SELECT * FROM positions WHERE CAST(netSize AS REAL) > 0`).all() as any[];
          const balance = adapter ? await adapter.getBalance() : 0;
          const account = adapter ? await adapter.getAccountState() : undefined;
          
          const presetsRows = db.prepare('SELECT * FROM presets').all() as any[];
          const presets = presetsRows.map(r => ({ id: r.id, name: r.name, ...JSON.parse(r.config) }));

          const anchor = currentMarket ? getMarketAnchor(currentMarket.conditionId) : undefined;

          connection.socket.send(JSON.stringify({
            type: 'SNAPSHOT',
            id: payload.id,
            payload: {
              operationalState,
              readiness,
              account,
              market: refreshedMarket || currentMarket,
              markets: globalDiscoveryService ? globalDiscoveryService.getMarkets() : [],
              anchor,
              orders,
              positions,
              balance,
              realizedPnl: 0,
              presets,
              settings: {}
            }
          }));
          return;
        }

        if (payload.type === 'PLACE_ORDER') {
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

          const { tokenId, outcome, side, dollarSpend, size, price, presetId } = validation.data;
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
            const position = db.prepare(`SELECT netSize FROM positions WHERE tokenId = ?`).get(tokenId) as { netSize?: string } | undefined;
            const availableShares = parseFloat(position?.netSize || '0');
            if (!Number.isFinite(requestedShares) || requestedShares <= 0 || requestedShares > availableShares) {
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
            const order = await adapter.placeOrder(tokenId, side, size, price);
            order.clientRequestId = requestId;
            order.outcome = outcome;
            order.dollarSpend = dollarSpend;
            order.presetId = presetId;
            order.conditionId = currentMarket?.conditionId;

            db.prepare(`INSERT INTO orders (id, clientRequestId, remoteOrderId, conditionId, tokenId, outcome, side, dollarSpend, size, price, presetId, status, remoteState, createdAt, updatedAt) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(order.id, requestId, order.remoteOrderId || order.id, currentMarket?.conditionId || '', tokenId, outcome || 'UP', side, dollarSpend || '0', size, price, presetId || '', order.status, 'LIVE', Date.now(), Date.now());
            
            const responseMsg = JSON.stringify({ 
               type: 'ORDER_UPDATE', 
               id: requestId,
               payload: order 
            });

            db.prepare(`UPDATE idempotency SET status='COMPLETED', response=?, updatedAt=? WHERE requestId=?`).run(responseMsg, Date.now(), requestId);
            connection.socket.send(responseMsg);
          } catch (err: any) {
            db.prepare(`UPDATE idempotency SET status='FAILED', updatedAt=? WHERE requestId=?`).run(Date.now(), requestId);
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message, id: requestId }));
          }
        }
        else if (payload.type === 'CANCEL_ORDER') {
          if (!isAuthenticated) return;
          const validation = CancelOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters', id: payload.id }));
            return;
          }

          const { orderId } = validation.data;
          try {
            if (!adapter) throw new Error('Adapter not initialized');
            const success = await adapter.cancelOrder(orderId);
            if (success) {
              db.prepare(`UPDATE orders SET status='CANCELLED', remoteState='CANCELLED', updatedAt=? WHERE id=?`).run(Date.now(), orderId);
            }
            const responseMsg = JSON.stringify({ type: 'ORDER_UPDATE', id: payload.id, payload: { id: orderId, status: success ? 'CANCELLED' : 'ERROR' } });
            connection.socket.send(responseMsg);
          } catch (e: any) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: e.message, id: payload.id }));
          }
        }
        else if (payload.type === 'CANCEL_ALL') {
          if (!isAuthenticated) return;
          try {
            if (!adapter) throw new Error('Adapter not initialized');
            await adapter.cancelAll();
            db.prepare(`UPDATE orders SET status='CANCELLED', remoteState='CANCELLED', updatedAt=? WHERE status IN ('PENDING', 'OPEN', 'LIVE', 'NEW')`).run(Date.now());
            connection.socket.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST', id: payload.id }));
          } catch (e: any) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: e.message, id: payload.id }));
          }
        }
        else if (payload.type === 'SUBSCRIBE_MARKET' || payload.type === 'SELECT_MARKET') {
          if (!isAuthenticated) return;
          
          const validation = SubscribeMarketSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid market subscription request' }));
            return;
          }
          
          activeMarketId = validation.data.conditionId;
          const upToken = validation.data.upTokenId || validation.data.yesTokenId || '';
          const downToken = validation.data.downTokenId || validation.data.noTokenId || '';
          if (upToken && downToken && adapter) {
            adapter.subscribeToMarket(validation.data.conditionId, upToken, downToken);
            const selectedMarket = globalDiscoveryService
              ? globalDiscoveryService.getMarkets().find((market: any) => market.conditionId === validation.data.conditionId)
              : null;
            setActiveMarketAnchor(validation.data.conditionId, selectedMarket?.startTime || Date.now());
          }
        }
      } catch (err: any) {
        connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
      }
    });

    connection.socket.on('close', () => {
      clearInterval(intervalId);
    });
  });
}
