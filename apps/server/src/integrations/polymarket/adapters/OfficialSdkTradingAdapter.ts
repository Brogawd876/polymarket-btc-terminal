import { Order, MarketState, Side, OrderState, AccountState, Position } from '@polymarket-btc/shared';
import { ethers } from 'ethers';
import { AssetType, ClobClient, Side as ClobSide, OrderType, type TickSize } from '@polymarket/clob-client-v2';
import WebSocket from 'ws';
import { getDb } from '../../../db/index';
import { TradingAdapter } from './TradingAdapter';
import { TradingError } from '../../../errors/TradingError';
import {
  LocalOrderBook,
  applyBookDelta,
  applyBookSnapshot,
  bestPrice,
  bookStaleReason,
  messageSourceTimestamp,
  normalizeSourceTimestamp,
  privateEventKey,
  toPublicBookState,
} from './streamUtils';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLY_SIGNATURE_TYPE = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
const POLY_FUNDER_ADDRESS = process.env.POLY_FUNDER_ADDRESS;
const SUPPORTED_TICK_SIZES: TickSize[] = ['0.1', '0.01', '0.005', '0.0025', '0.001', '0.0001'];
const WS_RECONNECT_MS = 3000;
const WS_HEARTBEAT_MS = 10000;
const WS_LIVENESS_TIMEOUT_MS = 30000;
const BOOK_STALE_AFTER_MS = 10000;
const ACCOUNT_DATA_STALE_AFTER_MS = 15000;
const MAX_PRIVATE_EVENT_KEYS = 5000;

interface BalanceCacheEntry {
  value: number;
  sourceTimestamp: number;
  stale: boolean;
  lastErrorAt?: number;
}

function normalizeTickSize(value: string): TickSize {
  return SUPPORTED_TICK_SIZES.includes(value as TickSize) ? value as TickSize : '0.01';
}

async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
  timeoutMs = 15000
): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })), timeoutMs);
        // We can't easily clear the timeout if operation finishes first without a wrapper class,
        // but it's safe to let it fire since the Promise is already resolved. 
        // Wait, Node.js might keep the event loop alive. Let's unref it if possible.
        if (timer.unref) timer.unref();
      });
      return await Promise.race([operation(), timeoutPromise]);
    } catch (err: any) {
      const isRateLimit = Number(err?.status || err?.response?.status) === 429;
      if (isRateLimit && i < retries) {
        console.warn(`Rate limited (429). Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // exponential backoff
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

export class OfficialSdkTradingAdapter extends TradingAdapter {
  private isConnected: boolean = false;
  private userStreamConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private activeSubscriptions: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private wallet?: ethers.Wallet;
  private clobClient!: ClobClient;
  private wsUser?: WebSocket;
  private wsMarket?: WebSocket;
  private userWsReconnectTimer: NodeJS.Timeout | null = null;
  private marketWsReconnectTimer: NodeJS.Timeout | null = null;
  private userWsHeartbeatTimer: NodeJS.Timeout | null = null;
  private userAuthConfirmationTimer: NodeJS.Timeout | null = null;
  private marketWsHeartbeatTimer: NodeJS.Timeout | null = null;
  private userWsLastActivity = 0;
  private marketWsLastActivity = 0;
  private shuttingDown = false;
  private apiCredentials?: any;
  private privateEventKeys = new Map<string, number>();
  private lastReconciliationTime: number = 0;

  private conditionTokens: Map<string, { upTokenId: string, downTokenId: string }> = new Map();
  private tokenToCondition: Map<string, string> = new Map();
  private orderbooks: Map<string, LocalOrderBook> = new Map();
  private restOrderbookRefreshTimes: Map<string, number> = new Map();
  private collateralBalanceCache?: BalanceCacheEntry;
  private tokenBalanceCache = new Map<string, BalanceCacheEntry>();

  constructor() {
    super();
    if (process.env.ENABLE_LIVE_TRADING === 'true') {
      if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY is not set in environment. Fatal initialization error.');
      }
      this.wallet = new ethers.Wallet(PRIVATE_KEY);
    }
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getUserStreamConnected(): boolean {
    return this.userStreamConnected;
  }

  getLastReconciliationTime(): number {
    return this.lastReconciliationTime;
  }

  async reconcile(): Promise<void> {
    if (!this.apiCredentials) throw new TradingError('Private credentials are unavailable', 'RECONCILIATION_UNAVAILABLE');
    await this.reconcileState(this.apiCredentials);
    await this.reconcileRecentTrades();
  }

  async initialize(): Promise<void> {
    console.log('Initializing Polymarket Adapter...');
    this.shuttingDown = false;

    if (process.env.ENABLE_LIVE_TRADING !== 'true') {
      console.warn('ENABLE_LIVE_TRADING is not true. Polymarket live integration is disabled.');
      this.isConnected = false;
      return;
    }
    
    try {
      this.clobClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: 137,
        signer: this.wallet,
        signatureType: POLY_SIGNATURE_TYPE,
        funderAddress: POLY_FUNDER_ADDRESS
      });

      const creds = await this.clobClient.createOrDeriveApiKey();
      this.apiCredentials = creds;
      console.log('Derived Polymarket API credentials.');
      this.clobClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: 137,
        signer: this.wallet,
        creds,
        signatureType: POLY_SIGNATURE_TYPE,
        funderAddress: POLY_FUNDER_ADDRESS
      });

      await this.reconcileState(creds);
      await this.reconcileRecentTrades();
      this.connectUserWs(creds);
      this.connectMarketWs();
      this.pollInterval = setInterval(() => {
        this.reconcileRecentTrades().catch(err => console.error('Trade reconciliation failed:', err));
        this.reconcileMissingRemoteIds().catch(err => console.error('Missing ID reconciliation failed:', err));
      }, 15000);

      this.isConnected = true;
      console.log('Polymarket Adapter Initialized.');
    } catch (err) {
      console.error('Failed to initialize Polymarket ClobClient:', err);
      this.isConnected = false;
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down Polymarket Adapter...');
    this.shuttingDown = true;
    this.isConnected = false;
    this.userStreamConnected = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.userWsReconnectTimer) {
      clearTimeout(this.userWsReconnectTimer);
      this.userWsReconnectTimer = null;
    }
    if (this.userAuthConfirmationTimer) {
      clearTimeout(this.userAuthConfirmationTimer);
      this.userAuthConfirmationTimer = null;
    }
    if (this.marketWsReconnectTimer) {
      clearTimeout(this.marketWsReconnectTimer);
      this.marketWsReconnectTimer = null;
    }
    this.stopWsHeartbeat('user');
    this.stopWsHeartbeat('market');
    if (this.wsUser) {
      this.wsUser.removeAllListeners();
      this.wsUser.close();
      this.wsUser = undefined;
    }
    if (this.wsMarket) {
      this.wsMarket.removeAllListeners();
      this.wsMarket.close();
      this.wsMarket = undefined;
    }
  }

  private async reconcileState(_creds: any): Promise<void> {
    try {
      console.log('Starting boot reconciliation with Polymarket CLOB...');
      const openOrders = await this.clobClient.getOpenOrders();
      console.log(`Boot Sync: Fetched ${openOrders.length} remote open orders`);

      const remoteOrderMap = new Map<string, any>();
      openOrders.forEach((o: any) => {
        const id = o.id || o.orderID || o.order_id;
        if (id) remoteOrderMap.set(id, o);
      });

      const db = getDb();
      for (const [remoteOrderId, remote] of remoteOrderMap) {
        const existing = db.prepare('SELECT id FROM orders WHERE remoteOrderId = ?').get(remoteOrderId) as { id: string } | undefined;
        if (existing) {
          this.applyRemoteOrderState(existing.id, remote, 'BOOT_OPEN_ORDERS');
        } else {
          this.importRemoteOpenOrder(remoteOrderId, remote);
        }
      }

      const restingOrders = db.prepare(`SELECT id, remoteOrderId, status, clientRequestId FROM orders WHERE status IN ('PENDING', 'OPEN', 'NEW', 'LIVE', 'SUBMITTING', 'ACCEPTED', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'RECONCILING')`).all() as { id: string, remoteOrderId?: string, status: string, clientRequestId?: string }[];

      for (const order of restingOrders) {
        const remoteOrderId = order.remoteOrderId;
        if (!remoteOrderId) {
          this.markOrderUnknown(order.id, 'MISSING_REMOTE_ORDER_ID');
          continue;
        }
        if (remoteOrderMap.has(remoteOrderId)) continue;

        try {
          const details = await this.clobClient.getOrder(remoteOrderId);
          if (details) this.applyRemoteOrderState(order.id, details, 'BOOT_ORDER_LOOKUP');
          else this.markOrderUnknown(order.id, 'EMPTY_REMOTE_ORDER_LOOKUP');
        } catch {
          this.markOrderUnknown(order.id, 'REMOTE_ORDER_LOOKUP_FAILED');
        }
      }

      this.lastReconciliationTime = Date.now();
      console.log('Boot reconciliation completed successfully.');
    } catch (err) {
      console.error('Failed to reconcile open orders on boot:', err);
    }
  }

  private importRemoteOpenOrder(remoteOrderId: string, remote: any): void {
    const tokenId = String(remote.asset_id || remote.token_id || '');
    if (!tokenId) return;
    const now = Date.now();
    const localId = `remote_${remoteOrderId}`;
    const conditionId = String(remote.market || remote.condition_id || this.tokenToCondition.get(tokenId) || '');
    const outcome = this.inferOutcome(tokenId, remote.outcome);
    const side = String(remote.side || 'BUY').toUpperCase();
    const size = String(remote.original_size || remote.size || '0');
    const filled = String(remote.size_matched || remote.filled_size || '0');
    const remaining = String(Math.max(0, Number(size) - Number(filled)));
    const db = getDb();
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO orders
        (id, remoteOrderId, conditionId, tokenId, outcome, side, dollarSpend, size, price, filledShares, remainingShares, fees, status, remoteState, reconciliationRequired, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', 'LIVE', 'LIVE', 0, ?, ?)`)
        .run(localId, remoteOrderId, conditionId, tokenId, outcome, side, '0', size, String(remote.price || '0'), filled, remaining, now, now);
      db.prepare(`INSERT OR IGNORE INTO order_events (orderId, fromState, toState, source, remoteEventId, payload, exchangeTimestamp, receiveTimestamp)
        VALUES (?, NULL, 'LIVE', 'REMOTE_IMPORT', ?, ?, ?, ?)`)
        .run(localId, `remote-order:${remoteOrderId}:import`, JSON.stringify(remote), messageSourceTimestamp(remote) || null, now);
    })();
  }

  private applyRemoteOrderState(localOrderId: string, remote: any, source: string): void {
    const remoteStatus = String(remote.status || '').toLowerCase();
    const matched = Number(remote.size_matched || remote.filled_size || '0');
    const original = Number(remote.original_size || remote.size || '0');
    const isFilled = remoteStatus === 'filled' || remoteStatus === 'matched' || (original > 0 && matched >= original);
    const isCancelled = ['canceled', 'cancelled', 'closed'].includes(remoteStatus);
    const isLive = ['live', 'open', 'active', 'pending'].includes(remoteStatus) || (!remoteStatus && original > matched);
    if (!isFilled && !isCancelled && !isLive) {
      this.markOrderUnknown(localOrderId, `UNRECOGNIZED_REMOTE_STATE:${remoteStatus || 'missing'}`);
      return;
    }

    const nextState = isFilled ? 'FILLED' : isCancelled ? 'CANCELLED' : matched > 0 ? 'PARTIALLY_FILLED' : 'LIVE';
    const now = Date.now();
    const db = getDb();
    db.transaction(() => {
      const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(localOrderId) as { status?: string } | undefined;
      db.prepare(`UPDATE orders SET status = ?, remoteState = ?, filledShares = MAX(CAST(COALESCE(filledShares, '0') AS REAL), ?), remainingShares = CASE WHEN CAST(size AS REAL) > 0 THEN CAST(MAX(0, CAST(size AS REAL) - ?) AS TEXT) ELSE remainingShares END, reconciliationRequired = 0, updatedAt = ?, rowVersion = rowVersion + 1 WHERE id = ?`)
        .run(nextState, nextState, matched, matched, now, localOrderId);
      db.prepare(`INSERT OR IGNORE INTO order_events (orderId, fromState, toState, source, remoteEventId, payload, exchangeTimestamp, receiveTimestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(localOrderId, current?.status || null, nextState, source, `remote-order:${localOrderId}:${remoteStatus}:${messageSourceTimestamp(remote) || now}`, JSON.stringify(remote), messageSourceTimestamp(remote) || null, now);
      if (isFilled || isCancelled) this.releaseReservations(db, localOrderId, now);
    })();
  }

  private markOrderUnknown(localOrderId: string, reason: string): void {
    const now = Date.now();
    const db = getDb();
    db.transaction(() => {
      const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(localOrderId) as { status?: string } | undefined;
      db.prepare(`UPDATE orders SET status = 'RECONCILING', remoteState = 'UNKNOWN', reconciliationRequired = 1, errorCode = ?, updatedAt = ?, rowVersion = rowVersion + 1 WHERE id = ?`)
        .run(reason, now, localOrderId);
      db.prepare(`INSERT INTO order_events (orderId, fromState, toState, source, payload, receiveTimestamp) VALUES (?, ?, 'RECONCILING', 'RECONCILIATION', ?, ?)`)
        .run(localOrderId, current?.status || null, JSON.stringify({ reason }), now);
    })();
  }

  private releaseReservations(db: any, localOrderId: string, now: number): void {
    db.prepare(`UPDATE reservations SET state = 'RELEASED', updatedAt = ? WHERE orderId = ? AND state NOT IN ('RELEASED', 'CONSUMED')`)
      .run(now, localOrderId);
  }

  private async reconcileMissingRemoteIds(): Promise<void> {
    const db = getDb();
    const threshold = Date.now() - 300000; // 5 minutes
    try {
      db.transaction(() => {
        const stuckOrders = db.prepare(`SELECT id, status FROM orders WHERE status = 'RECONCILING' AND remoteOrderId IS NULL AND createdAt < ?`).all(threshold) as { id: string, status: string }[];
        for (const order of stuckOrders) {
          db.prepare(`UPDATE orders SET status = 'REJECTED', remoteState = 'UNKNOWN', submissionResult = 'AMBIGUOUS', reconciliationRequired = 0, errorMessage = 'Timeout waiting for remote order ID', updatedAt = ?, rowVersion = rowVersion + 1 WHERE id = ?`).run(Date.now(), order.id);
          this.releaseReservations(db, order.id, Date.now());
          db.prepare(`INSERT INTO order_events (orderId, fromState, toState, source, payload, receiveTimestamp) VALUES (?, ?, 'REJECTED', 'RECONCILIATION', ?, ?)`).run(order.id, order.status, JSON.stringify({ reason: 'MISSING_REMOTE_ORDER_ID_TIMEOUT' }), Date.now());
          db.prepare(`INSERT INTO outbox_events (eventType,aggregateId,payload,createdAt) VALUES ('ORDER_UPDATED',?,?,?)`).run(order.id, JSON.stringify({ orderId: order.id, from: order.status, to: 'REJECTED', source: 'RECONCILIATION' }), Date.now());
          console.warn(`Order ${order.id} permanently rejected after timing out without a remoteOrderId.`);
        }
      })();
    } catch (err) {
      console.error('Failed to reconcile missing remote ids:', err);
    }
  }

  private async reconcileRecentTrades(): Promise<void> {
    if (!this.clobClient) return;

    try {
      const trades = await this.clobClient.getTrades(undefined, true);
      if (!Array.isArray(trades) || trades.length === 0) return;

      for (const trade of trades as any[]) {
        if (trade.status && !['CONFIRMED', 'MATCHED', 'MINED'].includes(String(trade.status).toUpperCase())) {
          continue;
        }

        const makerOrder = this.findUserMakerOrder(trade);
        const isMaker = String(trade.trader_side || '').toUpperCase() === 'MAKER' && makerOrder;
        const orderId = isMaker ? makerOrder.order_id : trade.taker_order_id;
        const side = String(isMaker ? makerOrder.side : trade.side || 'BUY').toUpperCase();
        const size = String(isMaker ? makerOrder.matched_amount : trade.size || '0');

        if (!orderId || !trade.asset_id || parseFloat(size) <= 0) continue;

        const db = getDb();
        const existingFill = db.prepare('SELECT id FROM fills WHERE id = ?').get(trade.id);
        if (existingFill) continue;

        this.handleFill({
          id: trade.id,
          order_id: orderId,
          asset_id: trade.asset_id,
          token_id: trade.asset_id,
          market: trade.market,
          conditionId: trade.market,
          outcome: trade.outcome || makerOrder?.outcome,
          side,
          price: isMaker ? makerOrder.price : trade.price,
          size,
          fee: trade.fee,
          createdAt: this.parseTradeTimestamp(trade.match_time || trade.last_update)
        });
      }
    } catch (err) {
      console.error('Failed to reconcile recent trades:', err);
    }
  }

  private findUserMakerOrder(trade: any): any | undefined {
    const funder = (POLY_FUNDER_ADDRESS || '').toLowerCase();
    const signer = (this.wallet?.address || '').toLowerCase();
    return (trade.maker_orders || []).find((order: any) => {
      const owner = String(order.owner || '').toLowerCase();
      const maker = String(order.maker_address || '').toLowerCase();
      return (funder && (owner === funder || maker === funder)) || (signer && (owner === signer || maker === signer));
    });
  }

  private parseTradeTimestamp(value?: string): number {
    if (!value) return Date.now();
    return normalizeSourceTimestamp(value) || Date.now();
  }

  private connectUserWs(creds: any) {
    if (this.shuttingDown) return;
    if (this.userWsReconnectTimer) {
      clearTimeout(this.userWsReconnectTimer);
      this.userWsReconnectTimer = null;
    }

    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user');
    this.wsUser = ws;
    this.userStreamConnected = false;
    ws.on('open', () => {
       console.log('User WebSocket opened; awaiting authenticated subscription confirmation');
       this.userWsLastActivity = Date.now();
       this.startWsHeartbeat('user', ws);
       ws.send(JSON.stringify({
         auth: {
           apiKey: creds.key,
           secret: creds.secret,
           passphrase: creds.passphrase,
         },
         type: 'user',
       }));
       // The CLOB user channel may remain silent after accepting credentials.
       // A socket that remains open after the authentication frame is the
       // protocol's positive confirmation; explicit errors still close it.
       this.userAuthConfirmationTimer = setTimeout(() => {
         if (this.wsUser === ws && ws.readyState === WebSocket.OPEN) {
           this.userStreamConnected = true;
           console.log('Authenticated user WebSocket subscription confirmed');
         }
       }, 2000);
    });

    ws.on('message', (data) => {
       try {
           const raw = data.toString();
           this.userWsLastActivity = Date.now();
           if (raw === 'PONG' || raw === 'PING') return;
           const msg = JSON.parse(raw);
           if (Array.isArray(msg)) {
               for (const item of msg) this.processUserMessage(item);
           } else {
               this.processUserMessage(msg);
           }
       } catch (err) {
           console.error('Error parsing WS User msg:', err);
       }
    });

    ws.on('pong', () => {
      this.userWsLastActivity = Date.now();
    });

    ws.on('close', (code, reason) => {
       if (this.wsUser === ws) this.wsUser = undefined;
       this.userStreamConnected = false;
       if (this.userAuthConfirmationTimer) {
         clearTimeout(this.userAuthConfirmationTimer);
         this.userAuthConfirmationTimer = null;
       }
       this.stopWsHeartbeat('user');
       if (this.shuttingDown) return;
       console.log(`WS User channel disconnected (${code}${reason ? `: ${reason.toString()}` : ''}), reconnecting in 3s`);
       if (this.isConnected) {
         this.userWsReconnectTimer = setTimeout(() => this.connectUserWs(creds), WS_RECONNECT_MS);
       }
    });

    ws.on('error', (err) => {
       this.userStreamConnected = false;
       console.error('WS User Error:', err);
    });
  }

  private connectMarketWs() {
    if (this.shuttingDown) return;
    if (this.marketWsReconnectTimer) {
      clearTimeout(this.marketWsReconnectTimer);
      this.marketWsReconnectTimer = null;
    }

    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
    this.wsMarket = ws;
    ws.on('open', () => {
      console.log('Connected to WS Market channel');
      this.marketWsLastActivity = Date.now();
      this.startWsHeartbeat('market', ws);
      const allTokens: string[] = [];
      for (const conditionId of this.activeSubscriptions) {
        const tokens = this.conditionTokens.get(conditionId);
        if (tokens) allTokens.push(tokens.upTokenId, tokens.downTokenId);
      }
      if (allTokens.length > 0) {
        ws.send(JSON.stringify({
          assets_ids: allTokens,
          type: 'market',
        }));
      }
      this.recoverAllOrderbooks().catch((error) => console.warn('Market WebSocket REST recovery failed:', error));
    });
    
    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        this.marketWsLastActivity = Date.now();
        if (raw === 'PONG' || raw === 'PING') return;
        if (!raw.trim().startsWith('{') && !raw.trim().startsWith('[')) return;

        const msg = JSON.parse(raw);
        if (Array.isArray(msg)) {
          for (const item of msg) this.handleMarketMessage(item);
        } else {
          this.handleMarketMessage(msg);
        }
      } catch (err) {
        console.error('Error parsing WS Market msg:', err);
      }
    });

    ws.on('pong', () => {
      this.marketWsLastActivity = Date.now();
    });

    ws.on('close', () => {
      if (this.wsMarket === ws) this.wsMarket = undefined;
      this.stopWsHeartbeat('market');
      if (this.shuttingDown) return;
      console.log('WS Market connection closed, reconnecting in 3s');
      if (this.isConnected) {
        this.marketWsReconnectTimer = setTimeout(() => this.connectMarketWs(), WS_RECONNECT_MS);
      }
    });
    ws.on('error', (err) => console.error('WS Market Error:', err));
  }

  private handleMarketMessage(msg: any) {
    const eventType = String(msg.event_type || msg.event || msg.type || '').toLowerCase();
    const receiveTimestamp = Date.now();
    const parentSourceTimestamp = messageSourceTimestamp(msg);

    if (eventType === 'market' || eventType === 'book') {
      const assetId = msg.asset_id;
      if (!assetId) return;
      
      const conditionId = this.tokenToCondition.get(assetId);
      if (!conditionId) return;

      const previous = this.orderbooks.get(assetId);
      const next = applyBookSnapshot(previous, msg, receiveTimestamp);
      if (next === previous) return;
      this.orderbooks.set(assetId, next);

      this.updateMarketStateFromOrderbooks(conditionId);
    } else if (eventType === 'price_change') {
      const changes = Array.isArray(msg.price_changes) ? msg.price_changes : [msg];
      const changedConditions = new Set<string>();

      for (const change of changes) {
        const assetId = change.asset_id;
        if (!assetId) continue;
        const conditionId = this.tokenToCondition.get(assetId);
        if (!conditionId) continue;

        const previous = this.orderbooks.get(assetId);
        const next = applyBookDelta(previous, change, parentSourceTimestamp, receiveTimestamp);
        if (next === previous) continue;
        this.orderbooks.set(assetId, next);
        changedConditions.add(conditionId);
      }

      for (const conditionId of changedConditions) this.updateMarketStateFromOrderbooks(conditionId);
    } else if (eventType === 'tick_size_change' || eventType === 'last_trade_price') {
      const assetId = msg.asset_id;
      if (!assetId) return;
      const conditionId = this.tokenToCondition.get(assetId);
      if (!conditionId) return;

      const previous = this.orderbooks.get(assetId);
      const next = applyBookDelta(previous, msg, parentSourceTimestamp, receiveTimestamp);
      if (next === previous) return;
      this.orderbooks.set(assetId, next);
      this.updateMarketStateFromOrderbooks(conditionId);
    } else if (eventType === 'best_bid_ask') {
      const assetId = msg.asset_id;
      const conditionId = assetId ? this.tokenToCondition.get(assetId) : undefined;
      if (conditionId) {
        this.refreshMarketOrderbooks(conditionId, true).catch((error) => console.warn('Best-quote REST recovery failed:', error));
      }
    }
  }

  private processUserMessage(item: any): void {
    const eventType = String(item?.event_type ?? item?.event ?? item?.type ?? '').toLowerCase();
    const status = String(item?.status ?? '').toLowerCase();
    const isAcknowledgement = ['auth', 'authenticated', 'subscribed', 'subscription'].includes(eventType);
    if (isAcknowledgement) {
      const acknowledged = item?.success === true
        || item?.authenticated === true
        || ['ok', 'success', 'connected', 'authenticated', 'subscribed'].includes(status);
      this.userStreamConnected = acknowledged;
      if (!acknowledged && (status === 'error' || item?.success === false)) {
        this.wsUser?.close(4001, 'Private subscription rejected');
      }
      return;
    }

    if (!['trade', 'fill', 'order', 'order_change'].includes(eventType)) return;
    const isValidTrade = ['trade', 'fill'].includes(eventType)
      && Boolean(item?.id || item?.trade_id)
      && Boolean(item?.order_id || item?.taker_order_id)
      && Boolean(item?.asset_id || item?.token_id)
      && Number(item?.price) > 0
      && Number(item?.size ?? item?.matched_amount) > 0;
    const isValidOrder = ['order', 'order_change'].includes(eventType)
      && Boolean(item?.order_id || item?.id);
    if (!isValidTrade && !isValidOrder) return;
    this.userStreamConnected = true;
    const key = privateEventKey(item);
    if (key && this.privateEventKeys.has(key)) return;
    if (key) this.rememberPrivateEvent(key);
    this.handleUserMessage(item, eventType);
  }

  private handleUserMessage(item: any, eventType: string) {
    if (eventType === 'fill' || eventType === 'trade') {
      const status = String(item.status || '').toUpperCase();
      if (status && !['CONFIRMED', 'MATCHED', 'MINED'].includes(status)) return;
      const makerOrder = this.findUserMakerOrder(item);
      const isMaker = String(item.trader_side || '').toUpperCase() === 'MAKER' && makerOrder;
      this.handleFill({
        ...item,
        order_id: item.order_id || (isMaker ? makerOrder?.order_id : item.taker_order_id),
        asset_id: item.asset_id || item.token_id,
        side: isMaker ? makerOrder?.side : item.side,
        size: isMaker ? makerOrder?.matched_amount : item.size,
        price: isMaker ? makerOrder?.price : item.price,
        createdAt: this.parseTradeTimestamp(item.match_time || item.last_update || item.timestamp),
      });
    } else if (eventType === 'order' || eventType === 'order_change') {
      const remoteOrderId = String(item.order_id || item.id || '');
      if (!remoteOrderId) return;
      const db = getDb();
      let local = db.prepare('SELECT id FROM orders WHERE remoteOrderId = ?').get(remoteOrderId) as { id: string } | undefined;
      if (!local && (item.asset_id || item.token_id)) {
        this.importRemoteOpenOrder(remoteOrderId, item);
        local = db.prepare('SELECT id FROM orders WHERE remoteOrderId = ?').get(remoteOrderId) as { id: string } | undefined;
      }
      if (local) this.applyRemoteOrderState(local.id, item, 'USER_STREAM');
    }
  }

  private rememberPrivateEvent(key: string): void {
    this.privateEventKeys.set(key, Date.now());
    while (this.privateEventKeys.size > MAX_PRIVATE_EVENT_KEYS) {
      const oldest = this.privateEventKeys.keys().next().value;
      if (!oldest) break;
      this.privateEventKeys.delete(oldest);
    }
  }

  private startWsHeartbeat(kind: 'user' | 'market', ws: WebSocket): void {
    this.stopWsHeartbeat(kind);
    const timer = setInterval(() => {
      const lastActivity = kind === 'user' ? this.userWsLastActivity : this.marketWsLastActivity;
      if (Date.now() - lastActivity > WS_LIVENESS_TIMEOUT_MS) {
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send('PING');
    }, WS_HEARTBEAT_MS);
    if (kind === 'user') this.userWsHeartbeatTimer = timer;
    else this.marketWsHeartbeatTimer = timer;
  }

  private stopWsHeartbeat(kind: 'user' | 'market'): void {
    const timer = kind === 'user' ? this.userWsHeartbeatTimer : this.marketWsHeartbeatTimer;
    if (timer) clearInterval(timer);
    if (kind === 'user') this.userWsHeartbeatTimer = null;
    else this.marketWsHeartbeatTimer = null;
  }

  private updateMarketStateFromOrderbooks(conditionId: string) {
    const tokens = this.conditionTokens.get(conditionId);
    if (!tokens) return;
    
    const upOb = this.orderbooks.get(tokens.upTokenId);
    const downOb = this.orderbooks.get(tokens.downTokenId);
    
    const existing = this.marketCache.get(conditionId);
    const now = Date.now();
    const upStaleReason = bookStaleReason(upOb, now, BOOK_STALE_AFTER_MS);
    const downStaleReason = bookStaleReason(downOb, now, BOOK_STALE_AFTER_MS);
    const upQuote = upStaleReason ? undefined : {
      bid: this.getBestBid(upOb!.bids),
      ask: this.getBestAsk(upOb!.asks),
    };
    const downQuote = downStaleReason ? undefined : {
      bid: this.getBestBid(downOb!.bids),
      ask: this.getBestAsk(downOb!.asks),
    };

    // Bad or briefly missing books never flash zeroes over a last-good quote.
    const upBid = upQuote?.bid || existing?.upBid || '0';
    const upAsk = upQuote?.ask || existing?.upAsk || '0';
    const downBid = downQuote?.bid || existing?.downBid || '0';
    const downAsk = downQuote?.ask || existing?.downAsk || '0';
    const upPrice = upQuote ? upQuote.bid : existing?.upPrice || '0.50';
    const downPrice = downQuote ? downQuote.bid : existing?.downPrice || '0.50';
    const sourceTimestamps = [upOb?.sourceTimestamp, downOb?.sourceTimestamp].filter((value): value is number => Boolean(value));
    const oldestSourceTimestamp = sourceTimestamps.length ? Math.min(...sourceTimestamps) : existing?.lastUpdated || 0;
    const staleReasons = [upStaleReason && `UP_${upStaleReason}`, downStaleReason && `DOWN_${downStaleReason}`].filter(Boolean);
    
    const existingOrDefault = existing || {
      marketId: conditionId,
      conditionId,
      upTokenId: tokens.upTokenId,
      downTokenId: tokens.downTokenId,
      yesTokenId: tokens.upTokenId,
      noTokenId: tokens.downTokenId,
      upPrice,
      downPrice,
      status: 'OPEN',
      lastUpdated: oldestSourceTimestamp,
    };
    
    this.marketCache.set(conditionId, {
      ...existingOrDefault,
      upPrice,
      downPrice,
      yesPrice: upPrice,
      noPrice: downPrice,
      upBid,
      upAsk,
      downBid,
      downAsk,
      yesBid: upBid,
      yesAsk: upAsk,
      noBid: downBid,
      noAsk: downAsk,
      tickSize: upOb?.tickSize || downOb?.tickSize || existing?.tickSize,
      lastUpdated: oldestSourceTimestamp,
      stale: staleReasons.length > 0,
      staleReason: staleReasons.join(',' ) || undefined,
      bookSourceTimestamp: oldestSourceTimestamp,
      bookReceiveTimestamp: Math.min(upOb?.receiveTimestamp || 0, downOb?.receiveTimestamp || 0),
      bookAgeMs: oldestSourceTimestamp > 0 ? Math.max(0, now - oldestSourceTimestamp) : Number.MAX_SAFE_INTEGER,
      upBook: toPublicBookState(
        upOb,
        tokens.upTokenId,
        'UP',
        upOb?.tickSize || existing?.tickSize || '0.01',
        existing?.minimumOrderSize || '5',
        upStaleReason,
      ),
      downBook: toPublicBookState(
        downOb,
        tokens.downTokenId,
        'DOWN',
        downOb?.tickSize || existing?.tickSize || '0.01',
        existing?.minimumOrderSize || '5',
        downStaleReason,
      ),
    } as MarketState);
  }

  private resolveCrossedQuote(bid: string, ask: string, previousBid?: string, previousAsk?: string): { bid: string, ask: string } {
    const bidNum = parseFloat(bid || '0');
    const askNum = parseFloat(ask || '0');
    if (bidNum > 0 && askNum > 0 && bidNum > askNum) {
      const previousBidNum = parseFloat(previousBid || '0');
      const previousAskNum = parseFloat(previousAsk || '0');
      if (previousBidNum > 0 && previousAskNum > 0 && previousBidNum <= previousAskNum) {
        return { bid: previousBid!, ask: previousAsk! };
      }
      return { bid: '0', ask: '0' };
    }
    return { bid, ask };
  }

  private getBestBid(levels: any[]): string {
    return this.getBestPrice(levels, 'bid');
  }

  private getBestAsk(levels: any[]): string {
    return this.getBestPrice(levels, 'ask');
  }

  private getBestPrice(levels: any[], side: 'bid' | 'ask'): string {
    return bestPrice(Array.isArray(levels) ? levels : [], side);
  }

  private inferOutcome(tokenId: string, rawOutcome?: any, db?: any): 'UP' | 'DOWN' {
    const normalized = String(rawOutcome || '').toUpperCase();
    if (normalized.includes('DOWN') || normalized === 'NO') return 'DOWN';
    if (normalized.includes('UP') || normalized === 'YES') return 'UP';

    const conditionId = this.tokenToCondition.get(tokenId);
    const tokens = conditionId ? this.conditionTokens.get(conditionId) : undefined;
    if (tokens?.downTokenId === tokenId) return 'DOWN';
    if (tokens?.upTokenId === tokenId) return 'UP';

    try {
      const existing = db?.prepare(`SELECT outcome FROM orders WHERE tokenId = ? AND outcome IS NOT NULL ORDER BY updatedAt DESC LIMIT 1`).get(tokenId) as { outcome?: string } | undefined;
      if (String(existing?.outcome || '').toUpperCase() === 'DOWN') return 'DOWN';
      if (String(existing?.outcome || '').toUpperCase() === 'UP') return 'UP';
    } catch {
      // Token mapping is authoritative when present; DB lookup is only a fallback.
    }

    return 'UP';
  }

  private handleFill(fill: any) {
    try {
      const db = getDb();
      const remoteEventId = String(fill.id || fill.trade_id || '');
      const remoteOrderId = String(fill.remoteOrderId || fill.order_id || '');
      const tokenId = String(fill.asset_id || fill.token_id || '');
      const side = String(fill.side || 'BUY').toUpperCase();
      const price = String(fill.price || '0');
      const size = String(fill.size || '0');
      const hasKnownFee = fill.fee !== undefined && fill.fee !== null;
      const fee = String(fill.fee ?? '0');
      const createdAt = Number(fill.createdAt) || Date.now();
      if (!remoteEventId || !remoteOrderId || !tokenId || Number(price) <= 0 || Number(size) <= 0) {
        console.warn('Ignoring incomplete confirmed fill event', { remoteEventId, remoteOrderId, tokenId });
        return;
      }

      db.transaction(() => {
        const duplicate = db.prepare('SELECT tradeId FROM remote_trades WHERE tradeId = ? AND state = ?').get(remoteEventId, 'CONFIRMED');
        if (duplicate) return;

        let localOrder = db.prepare(`SELECT id, conditionId, outcome, side, dollarSpend, size, status FROM orders
          WHERE remoteOrderId = ? OR id = ?
          ORDER BY CASE WHEN remoteOrderId = ? THEN 0 ELSE 1 END LIMIT 1`)
          .get(remoteOrderId, remoteOrderId, remoteOrderId) as { id: string, conditionId?: string, outcome?: string, side?: string, dollarSpend?: string, size: string, status: string } | undefined;

        const conditionId = String(fill.conditionId || fill.market || localOrder?.conditionId || this.tokenToCondition.get(tokenId) || '');
        const outcome = this.inferOutcome(tokenId, fill.outcome || localOrder?.outcome, db);
        if (!localOrder) {
          const localId = `remote_${remoteOrderId}`;
          db.prepare(`INSERT OR IGNORE INTO orders
            (id, remoteOrderId, conditionId, tokenId, outcome, side, dollarSpend, size, price, filledShares, remainingShares, fees, status, remoteState, reconciliationRequired, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, '0', ?, '0', 'RECONCILING', 'UNKNOWN', 1, ?, ?)`)
            .run(localId, remoteOrderId, conditionId, tokenId, outcome, side, '0', price, '0', createdAt, createdAt);
          localOrder = { id: localId, conditionId, outcome, side, dollarSpend: '0', size: '0', status: 'RECONCILING' };
        }

        db.prepare(`INSERT INTO remote_trades
          (tradeId, orderId, tokenId, conditionId, outcome, side, price, size, fee, state, exchangeTimestamp, receiveTimestamp, payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?)
          ON CONFLICT(tradeId) DO UPDATE SET orderId=excluded.orderId, state='CONFIRMED', receiveTimestamp=excluded.receiveTimestamp, payload=excluded.payload`)
          .run(remoteEventId, localOrder.id, tokenId, conditionId, outcome, side, price, size, hasKnownFee ? fee : null, createdAt, Date.now(), JSON.stringify(fill));

        db.prepare(`INSERT OR IGNORE INTO fills
          (id, orderId, tokenId, conditionId, outcome, side, price, size, fee, remoteEventId, remoteTradeState, confirmed, tradeTimestamp, receiveTimestamp, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 1, ?, ?, ?)`)
          .run(remoteEventId, localOrder.id, tokenId, conditionId, outcome, side, price, size, fee, remoteEventId, createdAt, Date.now(), createdAt);
        db.prepare(`UPDATE fills SET remoteEventId = COALESCE(remoteEventId, ?), remoteTradeState = 'CONFIRMED', confirmed = 1,
          tradeTimestamp = COALESCE(tradeTimestamp, ?), receiveTimestamp = ? WHERE id = ? OR remoteEventId = ?`)
          .run(remoteEventId, createdAt, Date.now(), remoteEventId, remoteEventId);

        const orderTotals = db.prepare(`SELECT SUM(CAST(size AS REAL)) AS filledShares,
          SUM(CAST(size AS REAL) * CAST(price AS REAL)) AS notional,
          SUM(CAST(fee AS REAL)) AS fees
          FROM fills WHERE orderId = ? AND confirmed = 1`).get(localOrder.id) as { filledShares?: number, notional?: number, fees?: number } | undefined;
        const aggregateFilled = Number(orderTotals?.filledShares || 0);
        const aggregateNotional = Number(orderTotals?.notional || 0);
        const aggregateFees = Number(orderTotals?.fees || 0);
        const originalSize = Number(localOrder.size || '0');
        const aggregateStatus = originalSize <= 0
          ? 'RECONCILING'
          : aggregateFilled + 0.000001 < originalSize
            ? 'PARTIALLY_FILLED'
            : 'FILLED';
        const averageFillPrice = aggregateFilled > 0 ? String(aggregateNotional / aggregateFilled) : price;
        const remoteState = aggregateStatus === 'RECONCILING' ? 'UNKNOWN' : aggregateStatus;

        db.prepare(`UPDATE orders SET filledShares = ?, remainingShares = ?, averageFillPrice = ?, fees = ?, status = ?, remoteState = ?, reconciliationRequired = ?, updatedAt = ?, rowVersion = rowVersion + 1 WHERE id = ?`)
          .run(String(aggregateFilled), originalSize > 0 ? String(Math.max(0, originalSize - aggregateFilled)) : null, averageFillPrice, String(aggregateFees), aggregateStatus, remoteState, aggregateStatus === 'RECONCILING' ? 1 : 0, createdAt, localOrder.id);
        db.prepare(`INSERT OR IGNORE INTO order_events (orderId, fromState, toState, source, remoteEventId, payload, exchangeTimestamp, receiveTimestamp)
          VALUES (?, ?, ?, 'CONFIRMED_TRADE', ?, ?, ?, ?)`)
          .run(localOrder.id, localOrder.status, aggregateStatus, `fill:${remoteEventId}`, JSON.stringify(fill), createdAt, Date.now());

        if (aggregateStatus === 'FILLED') {
          this.releaseReservations(db, localOrder.id, createdAt);
        } else if (aggregateStatus === 'PARTIALLY_FILLED') {
          const remaining = Math.max(0, originalSize - aggregateFilled);
          const reservationAmount = localOrder.side === 'BUY' && originalSize > 0
            ? Number(localOrder.dollarSpend || 0) * (remaining / originalSize)
            : remaining;
          db.prepare("UPDATE reservations SET amount=?,state='ACTIVE',updatedAt=? WHERE orderId=? AND state NOT IN ('RELEASED','CONSUMED')")
            .run(String(reservationAmount), createdAt, localOrder.id);
        }
        this.rebuildPosition(db, tokenId, conditionId, outcome, createdAt);
      })();
    } catch (err) {
       console.error('Error applying confirmed fill transaction:', err);
    }
  }

  private rebuildPosition(db: any, tokenId: string, conditionId: string, outcome: 'UP' | 'DOWN', updatedAt: number): void {
    const fills = db.prepare(`SELECT f.side, f.price, f.size, f.fee,
      CASE WHEN rt.fee IS NULL THEN 0 ELSE 1 END AS feeKnown
      FROM fills f LEFT JOIN remote_trades rt ON rt.tradeId = f.remoteEventId
      WHERE f.tokenId = ? AND (f.confirmed = 1 OR f.remoteEventId IS NULL)
      ORDER BY COALESCE(f.tradeTimestamp, f.createdAt), f.createdAt, f.id`).all(tokenId) as { side: string, price: string, size: string, fee: string, feeKnown: number }[];
    let netSize = 0;
    let totalCost = 0;
    let totalFees = 0;
    let realizedPnl = 0;
    let grossRealizedPnl = 0;
    let feesKnown = true;
    let oversellDetected = false;

    for (const entry of fills) {
      const fillSize = Number(entry.size);
      const fillPrice = Number(entry.price);
      const fillFee = Number(entry.fee || '0');
      if (!Number.isFinite(fillSize) || !Number.isFinite(fillPrice) || fillSize <= 0 || fillPrice <= 0) continue;
      feesKnown = feesKnown && entry.feeKnown === 1;
      totalFees += Number.isFinite(fillFee) ? fillFee : 0;
      if (entry.side === 'BUY') {
        totalCost += fillSize * fillPrice + (Number.isFinite(fillFee) ? fillFee : 0);
        netSize += fillSize;
      } else if (entry.side === 'SELL') {
        if (fillSize > netSize + 0.000001) oversellDetected = true;
        const averageCost = netSize > 0 ? totalCost / netSize : 0;
        const gross = fillSize * fillPrice - fillSize * averageCost;
        grossRealizedPnl += gross;
        realizedPnl += gross - fillFee;
        netSize = Math.max(0, netSize - fillSize);
        totalCost = netSize * averageCost;
      }
    }

    const reserved = db.prepare(`SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS amount FROM reservations
      WHERE assetType = 'SHARES' AND assetId = ? AND state NOT IN ('RELEASED', 'CONSUMED')`).get(tokenId) as { amount?: number } | undefined;
    const reservedShares = Math.max(0, Number(reserved?.amount || 0));
    const averagePrice = netSize > 0 ? totalCost / netSize : 0;
    const availableShares = Math.max(0, netSize - reservedShares);
    db.prepare(`INSERT INTO positions
      (tokenId, conditionId, outcome, netSize, avgPrice, fees, realizedPnl, reservedShares, availableShares, grossRealizedPnl, netRealizedPnl, feesKnown, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tokenId) DO UPDATE SET conditionId=excluded.conditionId, outcome=excluded.outcome,
        netSize=excluded.netSize, avgPrice=excluded.avgPrice, fees=excluded.fees,
        realizedPnl=excluded.realizedPnl, reservedShares=excluded.reservedShares,
        availableShares=excluded.availableShares, grossRealizedPnl=excluded.grossRealizedPnl,
        netRealizedPnl=excluded.netRealizedPnl, feesKnown=excluded.feesKnown, updatedAt=excluded.updatedAt`)
      .run(tokenId, conditionId, outcome, String(netSize), String(averagePrice), String(totalFees), realizedPnl,
        String(reservedShares), String(availableShares), grossRealizedPnl, realizedPnl, feesKnown ? 1 : 0, updatedAt);
    if (oversellDetected) {
      db.prepare(`INSERT OR IGNORE INTO reconciliation_discrepancies
        (entityType,entityId,reasonCode,detail,state,detectedAt) VALUES ('POSITION',?,'OVERSELL_HISTORY',?,'QUARANTINED',?)`)
        .run(tokenId, JSON.stringify({ conditionId, outcome }), updatedAt);
      db.prepare("UPDATE positions SET resolutionState='QUARANTINED',feesKnown=0 WHERE tokenId=?").run(tokenId);
    }
  }

  subscribeToMarket(conditionId: string, upTokenId: string, downTokenId: string): void {
    if (!this.activeSubscriptions.has(conditionId)) {
      this.activeSubscriptions.add(conditionId);
      this.conditionTokens.set(conditionId, { upTokenId, downTokenId });
      this.tokenToCondition.set(upTokenId, conditionId);
      this.tokenToCondition.set(downTokenId, conditionId);
      
      if (this.wsMarket?.readyState === WebSocket.OPEN) {
         this.wsMarket.send(JSON.stringify({
            operation: "subscribe",
            assets_ids: [upTokenId, downTokenId],
         }));
      }
      this.refreshMarketOrderbooks(conditionId, true).catch((error) => {
        console.warn(`Initial CLOB orderbook recovery failed for ${conditionId}:`, error);
      });
    }
  }

  updateMarketDiscovery(market: MarketState) {
    const existing = this.marketCache.get(market.conditionId);
    if (!existing) {
      this.marketCache.set(market.conditionId, market);
      this.subscribeToMarket(market.conditionId, market.upTokenId, market.downTokenId);
    } else {
      this.marketCache.set(market.conditionId, {
        ...existing,
        slug: market.slug,
        title: market.title,
        startTime: market.startTime,
        targetTime: market.targetTime,
        type: market.type,
        status: market.status,
        tickSize: market.tickSize || existing.tickSize,
        minimumOrderSize: market.minimumOrderSize || existing.minimumOrderSize,
      });
    }
  }

  async placeOrder(tokenId: string, side: Side, size: string, price: string): Promise<Order> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    
    let tickSizeStr = '0.01';
    try {
      tickSizeStr = await this.clobClient.getTickSize(tokenId);
    } catch (e) {
      console.warn('Using default tick size 0.01');
    }
    const normalizedTickSize = normalizeTickSize(tickSizeStr);
    const tickSize = parseFloat(normalizedTickSize) || 0.01;
    
    let precision = 2;
    if (tickSizeStr.includes('.')) {
      precision = tickSizeStr.split('.')[1].length;
    }
    
    const p = parseFloat(price);
    const s = parseFloat(size);
    const sizePrecision = 4;
    const sizeScale = 10 ** sizePrecision;
    const roundedSize = side === 'SELL'
      ? Math.floor(s * sizeScale) / sizeScale
      : Math.round(s * sizeScale) / sizeScale;
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(s) || s <= 0 || roundedSize <= 0) {
      throw new TradingError('Maker price and size must be positive finite numbers', 'INVALID_MAKER_ORDER');
    }
    const tickUnits = p / tickSize;
    if (Math.abs(tickUnits - Math.round(tickUnits)) > 1e-8) {
      throw new TradingError(`Requested maker price ${price} is not aligned to tick ${normalizedTickSize}`, 'INVALID_TICK_PRICE');
    }
    const submittedPrice = Number(p.toFixed(precision));
    if (Math.abs(submittedPrice - p) > 1e-8) {
      throw new TradingError(`Requested maker price ${price} exceeds tick precision`, 'INVALID_TICK_PRICE');
    }

    try {
      const liveBook = await this.clobClient.getOrderBook(tokenId);
      const liveBid = this.getBestBid(Array.isArray((liveBook as any).bids) ? (liveBook as any).bids : []);
      const liveAsk = this.getBestAsk(Array.isArray((liveBook as any).asks) ? (liveBook as any).asks : []);
      const bestBid = parseFloat(liveBid);
      const bestAsk = parseFloat(liveAsk);

      if (side === 'BUY' && Number.isFinite(bestAsk) && bestAsk > 0 && submittedPrice >= bestAsk) {
        throw new TradingError(`Requested maker BUY ${price} would cross ask ${liveAsk}`, 'MAKER_WOULD_CROSS');
      } else if (side === 'SELL' && Number.isFinite(bestBid) && bestBid > 0 && submittedPrice <= bestBid) {
        throw new TradingError(`Requested maker SELL ${price} would cross bid ${liveBid}`, 'MAKER_WOULD_CROSS');
      }
    } catch (error) {
      if (error instanceof TradingError) throw error;
      throw new TradingError('Could not verify the current book for exact maker placement', 'MARKET_BOOK_UNAVAILABLE');
    }

    if (submittedPrice < tickSize || submittedPrice > 1 - tickSize) {
      throw new TradingError(`Post-only price ${submittedPrice.toFixed(precision)} is outside valid range`, 'INVALID_POST_ONLY_PRICE');
    }

    const orderArgs = {
      tokenID: tokenId,
      price: submittedPrice,
      side: side === 'BUY' ? ClobSide.BUY : ClobSide.SELL,
      size: Number(roundedSize.toFixed(sizePrecision)),
      feeRateBps: 0,
    };

    try {
      const response = await withRetry(() => this.clobClient.createAndPostOrder(
        orderArgs,
        { tickSize: normalizedTickSize },
        OrderType.GTC,
        true
      ));
      console.log(`Polymarket CLOB order response: ${JSON.stringify(response)}`);
      
      if ((response as any).error || (response as any).errorMsg || !(response as any).success) {
        const reason = (response as any).errorMsg || (response as any).error || (response as any).status || JSON.stringify(response);
        throw new TradingError(`Polymarket API rejected order: ${reason}`, 'API_REJECTED_ORDER');
      }
      if (!response.orderID) {
        throw new TradingError('Polymarket accepted the request without returning an order ID', 'AMBIGUOUS_ORDER_RESPONSE');
      }

      const remoteStatus = String(response.status || '').toLowerCase();
      const status: OrderState = remoteStatus === 'matched' || remoteStatus === 'filled'
        ? 'FILLED'
        : remoteStatus === 'live' || remoteStatus === 'open'
          ? 'LIVE'
          : 'ACCEPTED';

      const order: Order = {
        id: response.orderID,
        remoteOrderId: response.orderID,
        tokenId,
        side,
        size: roundedSize.toFixed(sizePrecision),
        price: submittedPrice.toFixed(precision),
        requestedPrice: price,
        submittedPrice: submittedPrice.toFixed(precision),
        filledShares: status === 'FILLED' ? roundedSize.toFixed(sizePrecision) : '0',
        remainingShares: status === 'FILLED' ? '0' : roundedSize.toFixed(sizePrecision),
        fees: '0',
        status,
        state: status,
        remoteState: remoteStatus ? remoteStatus.toUpperCase() : 'ACCEPTED',
        timestamp: Date.now(),
        createdAt: Date.now(),
      };
      
      console.log(`Placed order: ${JSON.stringify(order)}`);
      return order;
    } catch (error: any) {
      console.error('Error placing order:', error);
      if (error instanceof TradingError) throw error;
      throw new TradingError(error.message, 'UNKNOWN_ORDER_ERROR');
    }
  }

  async placeMarketOrder(tokenId: string, side: Side, amount: string, slippageBps: number = 100, quotedLimitPrice?: string): Promise<Order> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');

    let tickSizeStr = '0.01';
    try {
      tickSizeStr = await this.clobClient.getTickSize(tokenId);
    } catch (e) {
      console.warn('Using default tick size 0.01');
    }
    const normalizedTickSize = normalizeTickSize(tickSizeStr);
    const tickSize = parseFloat(normalizedTickSize) || 0.01;
    const precision = tickSizeStr.includes('.') ? tickSizeStr.split('.')[1].length : 2;
    const requestedAmount = parseFloat(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new TradingError('Market order amount must be greater than zero', 'INVALID_MARKET_AMOUNT');
    }

    const orderSide = side === 'BUY' ? ClobSide.BUY : ClobSide.SELL;
    const orderType: OrderType.FAK = OrderType.FAK;
    const estimatedPrice = quotedLimitPrice ? Number(quotedLimitPrice) : await this.clobClient.calculateMarketPrice(tokenId, orderSide, requestedAmount, orderType);
    const slippageMultiplier = Math.max(0, slippageBps) / 10000;
    const limitPrice = quotedLimitPrice ? estimatedPrice : side === 'BUY'
      ? estimatedPrice * (1 + slippageMultiplier)
      : estimatedPrice * (1 - slippageMultiplier);
    const roundedPrice = Math.round(limitPrice / tickSize) * tickSize;

    if (roundedPrice < tickSize || roundedPrice > 1 - tickSize) {
      throw new TradingError(`One-tap limit price ${roundedPrice.toFixed(precision)} is outside valid range`, 'INVALID_MARKET_PRICE');
    }

    const orderArgs = {
      tokenID: tokenId,
      amount: Number(requestedAmount.toFixed(6)),
      side: orderSide,
      price: Number(roundedPrice.toFixed(precision)),
      orderType,
    };

    try {
      const response = await withRetry(() => this.clobClient.createAndPostMarketOrder(
        orderArgs,
        { tickSize: normalizedTickSize },
        orderType
      ));
      console.log(`Polymarket CLOB market order response: ${JSON.stringify(response)}`);

      if ((response as any).error || (response as any).errorMsg || !(response as any).success) {
        const reason = (response as any).errorMsg || (response as any).error || (response as any).status || JSON.stringify(response);
        throw new TradingError(`Polymarket API rejected market order: ${reason}`, 'API_REJECTED_MARKET_ORDER');
      }
      if (!response.orderID) {
        throw new TradingError('Polymarket accepted the immediate request without returning an order ID', 'AMBIGUOUS_MARKET_ORDER_RESPONSE');
      }

      const remoteStatus = String(response.status || '').toLowerCase();
      const orderStatus: OrderState = remoteStatus === 'matched' || remoteStatus === 'filled'
        ? 'FILLED'
        : ['unmatched', 'cancelled', 'canceled', 'closed'].includes(remoteStatus)
          ? 'CANCELLED'
          : 'ACCEPTED';
      const filledShares = side === 'BUY'
        ? String((response as any).takingAmount || '0')
        : String((response as any).makingAmount || '0');
      const order: Order = {
        id: response.orderID,
        remoteOrderId: response.orderID,
        tokenId,
        side,
        dollarSpend: side === 'BUY' ? amount : undefined,
        size: side === 'BUY' ? filledShares : requestedAmount.toFixed(4),
        price: roundedPrice.toFixed(precision),
        requestedPrice: String(estimatedPrice),
        submittedPrice: roundedPrice.toFixed(precision),
        filledShares,
        remainingShares: orderStatus === 'FILLED' || orderStatus === 'CANCELLED' ? '0' : undefined,
        fees: (response as any).fee !== undefined ? String((response as any).fee) : '0',
        status: orderStatus,
        state: orderStatus,
        remoteState: remoteStatus ? remoteStatus.toUpperCase() : 'ACCEPTED',
        timestamp: Date.now(),
        createdAt: Date.now(),
      };

      await this.reconcileRecentTrades();
      setTimeout(() => this.reconcileRecentTrades().catch(err => console.error('Delayed market-order reconciliation failed:', err)), 2500);
      setTimeout(() => this.reconcileRecentTrades().catch(err => console.error('Delayed market-order reconciliation failed:', err)), 7500);

      console.log(`Placed market order: ${JSON.stringify(order)}`);
      return order;
    } catch (error: any) {
      console.error('Error placing market order:', error);
      if (error instanceof TradingError) throw error;
      throw new TradingError(error.message, 'UNKNOWN_MARKET_ORDER_ERROR');
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    try {
      const response = await withRetry(() => this.clobClient.cancelOrder({ orderID: orderId }));
      let confirmed = this.responseConfirmsCancellation(response, [orderId]);
      if (!confirmed) {
        try {
          const remote = await this.clobClient.getOrder(orderId);
          confirmed = ['canceled', 'cancelled', 'closed'].includes(String((remote as any)?.status || '').toLowerCase());
        } catch (err: any) {
          if (err?.status === 404 || err?.response?.status === 404 || String(err?.message || '').includes('404')) {
            confirmed = true;
          } else {
            confirmed = false;
          }
        }
      }
      if (!confirmed) return false;

      const db = getDb();
      const local = db.prepare('SELECT id FROM orders WHERE remoteOrderId = ?').get(orderId) as { id: string } | undefined;
      if (local) this.applyRemoteOrderState(local.id, { ...response, id: orderId, status: 'cancelled' }, 'CANCEL_RESPONSE');
      console.log(`Confirmed cancelled order: ${orderId}`);
      return true;
    } catch (error: any) {
      console.error('Cancellation could not be remotely confirmed:', error);
      return false;
    }
  }

  async cancelAll(): Promise<{ targetedOrderIds: string[]; confirmedOrderIds: string[]; unresolvedOrderIds: string[] }> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    try {
      const before = await this.clobClient.getOpenOrders();
      const targetIds = before.map((order: any) => String(order.id || order.orderID || order.order_id || '')).filter(Boolean);
      if (targetIds.length === 0) return { targetedOrderIds: [], confirmedOrderIds: [], unresolvedOrderIds: [] };
      const response = await withRetry(() => this.clobClient.cancelAll());
      const after = await this.clobClient.getOpenOrders();
      const remaining = new Set(after.map((order: any) => String(order.id || order.orderID || order.order_id || '')));
      const confirmedOrderIds = targetIds.filter((id) => !remaining.has(id));
      const unresolvedOrderIds = targetIds.filter((id) => remaining.has(id));

      const db = getDb();
      for (const remoteOrderId of confirmedOrderIds) {
        const local = db.prepare('SELECT id FROM orders WHERE remoteOrderId = ?').get(remoteOrderId) as { id: string } | undefined;
        if (local) this.applyRemoteOrderState(local.id, { id: remoteOrderId, status: 'cancelled' }, 'CANCEL_ALL_RESPONSE');
      }
      console.log(`Confirmed ${confirmedOrderIds.length}/${targetIds.length} targeted orders cancelled via CLOB`);
      return { targetedOrderIds: targetIds, confirmedOrderIds, unresolvedOrderIds };
    } catch (error: any) {
      console.error('Bulk cancellation could not be remotely confirmed:', error);
      throw error;
    }
  }

  private responseConfirmsCancellation(response: any, targetIds: string[]): boolean {
    if (!response || targetIds.length === 0) return targetIds.length === 0;
    const cancelled = response.canceled || response.cancelled || response.canceled_orders || response.cancelled_orders;
    if (Array.isArray(cancelled)) {
      const ids = new Set(cancelled.map((value: any) => String(value?.id || value?.order_id || value)));
      return targetIds.every((id) => ids.has(id));
    }
    const status = String(response.status || response.state || '').toLowerCase();
    return targetIds.length === 1
      && ['canceled', 'cancelled'].includes(status)
      && String(response.orderID || response.order_id || response.id || targetIds[0]) === targetIds[0];
  }

  async getMarketState(conditionId: string): Promise<any> {
    await this.refreshMarketOrderbooks(conditionId);
    const state = this.marketCache.get(conditionId);
    if (!state) return null;
    const tokens = this.conditionTokens.get(conditionId);
    const upReason = tokens ? bookStaleReason(this.orderbooks.get(tokens.upTokenId), Date.now(), BOOK_STALE_AFTER_MS) : 'BOOK_NOT_INITIALIZED';
    const downReason = tokens ? bookStaleReason(this.orderbooks.get(tokens.downTokenId), Date.now(), BOOK_STALE_AFTER_MS) : 'BOOK_NOT_INITIALIZED';
    if (upReason || downReason) {
      return {
        ...state,
        stale: true,
        staleReason: [upReason && `UP_${upReason}`, downReason && `DOWN_${downReason}`].filter(Boolean).join(','),
      };
    }
    return { ...state, stale: false, staleReason: undefined };
  }

  private async refreshMarketOrderbooks(conditionId: string, force = false): Promise<void> {
    const lastRefresh = this.restOrderbookRefreshTimes.get(conditionId) || 0;
    if (!force && Date.now() - lastRefresh < 1500) return;

    const tokens = this.conditionTokens.get(conditionId);
    if (!tokens || !this.clobClient) return;

    this.restOrderbookRefreshTimes.set(conditionId, Date.now());
    try {
      const [upBook, downBook] = await Promise.all([
        this.clobClient.getOrderBook(tokens.upTokenId),
        this.clobClient.getOrderBook(tokens.downTokenId),
      ]);

      const receivedAt = Date.now();
      this.orderbooks.set(
        tokens.upTokenId,
        applyBookSnapshot(this.orderbooks.get(tokens.upTokenId), upBook, receivedAt),
      );
      this.orderbooks.set(
        tokens.downTokenId,
        applyBookSnapshot(this.orderbooks.get(tokens.downTokenId), downBook, receivedAt),
      );

      this.updateMarketStateFromOrderbooks(conditionId);
    } catch (err) {
      console.warn(`Failed to refresh CLOB orderbook for ${conditionId}:`, err);
    }
  }

  private async recoverAllOrderbooks(): Promise<void> {
    await Promise.allSettled(
      [...this.activeSubscriptions].map((conditionId) => this.refreshMarketOrderbooks(conditionId, true)),
    );
  }

  async getBalance(): Promise<number> {
    if (!this.wallet) return 0;
    try {
      const balanceAllowance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });
      const clobBalance = this.parseCollateralBalance(balanceAllowance.balance);
      if (clobBalance !== undefined) {
        this.collateralBalanceCache = this.freshBalance(clobBalance);
        return clobBalance;
      }
    } catch (e) {
      console.error('Failed to fetch CLOB balance', e);
    }

    try {
      const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon.drpc.org';
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint256)'], provider);
      const balanceAddress = POLY_FUNDER_ADDRESS || this.wallet.address;
      const bal = await contract.balanceOf(balanceAddress);
      const chainBalance = Number(ethers.utils.formatUnits(bal, 6));
      if (!Number.isFinite(chainBalance) || chainBalance < 0) throw new Error('Invalid collateral balance response');
      this.collateralBalanceCache = this.freshBalance(chainBalance);
      return chainBalance;
    } catch (e) {
      if (this.collateralBalanceCache) {
        this.collateralBalanceCache.stale = true;
        this.collateralBalanceCache.lastErrorAt = Date.now();
        return this.collateralBalanceCache.value;
      }
      throw new TradingError('Collateral balance is unavailable and no last-good value exists', 'ACCOUNT_DATA_UNAVAILABLE');
    }
  }

  async getTokenBalance(tokenId: string): Promise<number> {
    if (!this.wallet || !this.clobClient || !tokenId) return 0;
    try {
      const balanceAllowance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId
      });
      const tokenBalance = this.parseTokenBalance(balanceAllowance.balance);
      if (tokenBalance === undefined) throw new Error('Invalid conditional-token balance response');
      this.tokenBalanceCache.set(tokenId, this.freshBalance(tokenBalance));
      return tokenBalance;
    } catch (e) {
      console.error(`Failed to fetch CLOB conditional-token balance for ${tokenId}`, e);
      const cached = this.tokenBalanceCache.get(tokenId);
      if (cached) {
        cached.stale = true;
        cached.lastErrorAt = Date.now();
        return cached.value;
      }
      throw new TradingError(`Token balance for ${tokenId} is unavailable and no last-good value exists`, 'ACCOUNT_DATA_UNAVAILABLE');
    }
  }

  async getAccountState(): Promise<AccountState> {
    const balance = await this.getBalance();
    let allowanceValid = true;
    try {
      const ba = await this.clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      allowanceValid = ba.allowances && Object.values(ba.allowances).some(v => parseFloat(v) > 0);
    } catch (e) {
      allowanceValid = false;
    }

    const balanceSourceTimestamp = this.collateralBalanceCache?.sourceTimestamp || 0;
    const balanceAgeMs = balanceSourceTimestamp > 0 ? Date.now() - balanceSourceTimestamp : Number.MAX_SAFE_INTEGER;
    const balanceStale = !this.collateralBalanceCache
      || this.collateralBalanceCache.stale
      || balanceAgeMs > ACCOUNT_DATA_STALE_AFTER_MS;
    return {
      signerAddress: this.wallet?.address,
      funderAddress: POLY_FUNDER_ADDRESS || this.wallet?.address,
      signatureType: POLY_SIGNATURE_TYPE,
      collateralBalance: balance,
      allowanceValid,
      authenticated: this.isConnected,
      userStreamConnected: this.userStreamConnected,
      lastReconciliationTime: this.lastReconciliationTime,
      balanceSourceTimestamp,
      balanceAgeMs,
      balanceStale,
      balanceStaleReason: balanceStale ? 'ACCOUNT_BALANCE_STALE' : undefined,
    } as AccountState;
  }

  private freshBalance(value: number): BalanceCacheEntry {
    return { value, sourceTimestamp: Date.now(), stale: false };
  }

  private parseCollateralBalance(balance: string): number | undefined {
    const parsed = parseFloat(balance);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed > 100000 ? parsed / 1_000_000 : parsed;
  }

  private parseTokenBalance(balance: string): number | undefined {
    const parsed = parseFloat(balance);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed > 100000 ? parsed / 1_000_000 : parsed;
  }
}
