import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { ExecutableQuote, OrderIntent, SubmissionResult } from '@polymarket-btc/shared';
import type { TradingAdapter } from '../integrations/polymarket/adapters/TradingAdapter';
import { loadConfig } from '../config';

type Db = Database.Database;
type Side = 'BUY' | 'SELL';
const ACTIVE_ORDERS = "'PENDING','SUBMITTING','ACCEPTED','OPEN','LIVE','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN','RECONCILING'";
const ACTIVE_RESERVATIONS = "'RESERVED','SUBMITTING','ACTIVE','RECONCILING'";
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const decimal = (value: number) => value.toFixed(8).replace(/\.?0+$/, '') || '0';

export class PresetEngine {
  calculateRaw(reference: number, mode: 'CENT_OFFSET' | 'PERCENT_OFFSET' | 'ABSOLUTE_PRICE', value: number): number {
    return mode === 'CENT_OFFSET' ? reference + value : mode === 'PERCENT_OFFSET' ? reference * (1 + value / 100) : value;
  }

  calculate(reference: number, mode: 'CENT_OFFSET' | 'PERCENT_OFFSET' | 'ABSOLUTE_PRICE', value: number): number {
    const result = this.calculateRaw(reference, mode, value);
    return Math.max(0.001, Math.min(0.999, result));
  }
  round(price: number, tick: number, side: Side): number {
    if (!(tick > 0)) throw new Error('A valid market tick is required');
    const units = price / tick;
    return Number(((side === 'BUY' ? Math.floor(units + 1e-9) : Math.ceil(units - 1e-9)) * tick).toFixed(8));
  }
}

export class QuoteService {
  private quotes = new Map<string, ExecutableQuote>();
  private presets = new PresetEngine();

  create(v: { conditionId: string; tokenId: string; outcome: 'UP' | 'DOWN'; side: Side;
    executionMode: 'MAKER' | 'IMMEDIATE'; referencePrice: number; tickSize: number;
    referenceType?: 'BEST_BID' | 'BEST_ASK' | 'MIDPOINT' | 'LAST_TRADE';
    makerBoundary?: number; marketRevision: number; bookVersion: number;
    requestedDollars?: number; requestedShares?: number; ttlMs?: number }): ExecutableQuote {
    const now = Date.now();
    for (const [id, quote] of this.quotes) {
      if (quote.expiresAt < now) this.quotes.delete(id);
    }

    let price = this.presets.round(v.referencePrice, v.tickSize, v.side);
    let clampResult: 'UNCHANGED' | 'CLAMPED' = 'UNCHANGED';
    if (v.executionMode === 'MAKER' && v.makerBoundary !== undefined) {
      const crosses = v.side === 'BUY' ? price >= v.makerBoundary : price <= v.makerBoundary;
      if (crosses) {
        price = this.presets.round(v.side === 'BUY' ? v.makerBoundary - v.tickSize : v.makerBoundary + v.tickSize, v.tickSize, v.side);
        clampResult = 'CLAMPED';
      }
    }
    if (!(price > 0 && price < 1)) throw new Error('Quote is outside the valid price range');
    const shares = v.requestedShares ?? ((v.requestedDollars || 0) / price);
    const quote: ExecutableQuote = {
      quoteId: crypto.randomUUID(), conditionId: v.conditionId, tokenId: v.tokenId, outcome: v.outcome,
      side: v.side, executionMode: v.executionMode,
      referenceType: v.referenceType || (v.side === 'BUY' ? 'BEST_ASK' : 'BEST_BID'), referencePrice: decimal(v.referencePrice),
      rawCalculatedPrice: decimal(v.referencePrice), tickSize: decimal(v.tickSize),
      makerBoundary: decimal(v.makerBoundary ?? v.referencePrice), displayedPrice: decimal(price), submittedPrice: decimal(price),
      clamped: clampResult === 'CLAMPED', clampReason: clampResult === 'CLAMPED' ? 'POST_ONLY_BOUNDARY' : undefined,
      marketRevision: v.marketRevision, bookVersion: v.bookVersion, calculatedAt: now, expiresAt: now + (v.ttlMs || 2500),
      estimatedShares: decimal(shares), estimatedDollars: decimal(shares * price),
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  consume(quoteId: string, intent: OrderIntent, current: { marketRevision: number; bookVersion: number; currentBid?: number; currentAsk?: number }): ExecutableQuote {
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error('Quote not found or already used');
    this.quotes.delete(quoteId);
    if (Date.now() > quote.expiresAt) throw new Error('Quote expired; request a new quote');
    if (quote.conditionId !== intent.conditionId || quote.tokenId !== intent.tokenId || quote.outcome !== intent.outcome ||
        quote.side !== intent.side || quote.executionMode !== intent.executionMode) throw new Error('Quote binding does not match the order intent');
    
    // Check if quote is stale
    if (quote.marketRevision !== current.marketRevision || quote.bookVersion !== current.bookVersion) {
      // Relaxed validation: if book version shifted, but the top-of-book price is still exactly what the quote expects, allow execution.
      let priceStillValid = false;
      if (current.currentBid !== undefined && current.currentAsk !== undefined) {
        if (quote.referenceType === 'BEST_BID' && current.currentBid === parseFloat(quote.makerBoundary)) priceStillValid = true;
        if (quote.referenceType === 'BEST_ASK' && current.currentAsk === parseFloat(quote.makerBoundary)) priceStillValid = true;
      }
      if (!priceStillValid) throw new Error('Quote is stale');
    }
    return quote;
  }
}

export class RiskService {
  constructor(private db: Db) {}
  reserved(type: 'COLLATERAL' | 'SHARES', id: string): number {
    return number((this.db.prepare(`SELECT COALESCE(SUM(CAST(amount AS REAL)),0) total FROM reservations
      WHERE assetType=? AND assetId=? AND state IN (${ACTIVE_RESERVATIONS})`).get(type, id) as any)?.total);
  }
  check(v: { side: Side; tokenId: string; dollars: number; shares: number; balance: number; availableShares: number }): void {
    const config = loadConfig();
    if (!(v.dollars > 0) || v.dollars > config.MAX_SINGLE_BUY_USD) throw new Error(`Order value exceeds the $${config.MAX_SINGLE_BUY_USD} limit`);
    const count = number((this.db.prepare(`SELECT COUNT(*) count FROM orders WHERE status IN (${ACTIVE_ORDERS})`).get() as any)?.count);
    if (count >= config.MAX_OPEN_ORDERS) throw new Error('Maximum open-order count reached');
    let pnl = 0;
    try { pnl = number((this.db.prepare('SELECT COALESCE(SUM(netRealizedPnl),0) value FROM positions').get() as any)?.value); } catch {}
    const setting = (key: string, fallback: number) => {
      let row: { value?: string } | undefined;
      try { row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined; } catch {}
      return row && number(row.value) > 0 ? number(row.value) : fallback;
    };
    if (pnl <= -setting('maxLoss', config.MAX_SESSION_LOSS)) throw new Error('Session loss lock is active');
    if (pnl >= setting('maxProfit', config.MAX_SESSION_PROFIT)) throw new Error('Session profit lock is active');
    if (v.side === 'BUY') {
      const reserved = this.reserved('COLLATERAL', 'USDC');
      if (v.dollars > Math.max(0, v.balance - reserved)) throw new Error('Insufficient available collateral');
      if (reserved + v.dollars > config.MAX_OPEN_EXPOSURE_USD) throw new Error('Maximum exposure reached');
      let current = 0;
      try { current = number((this.db.prepare('SELECT netSize FROM positions WHERE tokenId=?').get(v.tokenId) as any)?.netSize); } catch {}
      if (current + v.shares > config.MAX_POSITION_SHARES) throw new Error('Maximum position size reached');
    } else if (v.shares > Math.max(0, v.availableShares - this.reserved('SHARES', v.tokenId)) + 1e-8) {
      throw new Error('Insufficient available shares');
    }
  }
}

export class OrderLifecycleService {
  constructor(private db: Db) {}
  private event(id: string, from: string | null, to: string, source: string, payload?: unknown): void {
    this.db.prepare(`INSERT INTO order_events (orderId,fromState,toState,source,payload,receiveTimestamp) VALUES (?,?,?,?,?,?)`)
      .run(id, from, to, source, payload === undefined ? null : JSON.stringify(payload), Date.now());
    this.db.prepare(`INSERT INTO outbox_events (eventType,aggregateId,payload,createdAt) VALUES ('ORDER_UPDATED',?,?,?)`)
      .run(id, JSON.stringify({ orderId: id, from, to, source }), Date.now());
  }
  private transition(id: string, to: string, source: string): void {
    this.db.transaction(() => {
      const old = this.get(id); if (!old) throw new Error('Local order not found');
      this.db.prepare('UPDATE orders SET status=?,remoteState=?,rowVersion=rowVersion+1,updatedAt=? WHERE id=?').run(to, to, Date.now(), id);
      this.event(id, old.status, to, source);
    })();
  }
  reserve(intent: OrderIntent, quote: ExecutableQuote, dollars: number, shares: number): string {
    const existing = this.db.prepare('SELECT id FROM orders WHERE clientRequestId=?').get(intent.requestId) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = crypto.randomUUID(), now = Date.now();
    try {
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO orders (id,clientRequestId,conditionId,tokenId,outcome,side,dollarSpend,size,price,
          filledShares,remainingShares,fees,status,remoteState,executionMode,orderType,requestedPrice,submittedPrice,
          requestedShares,reconciliationRequired,rowVersion,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,'0',?,'0','PENDING','LOCAL_RESERVED',?,?,?,?,?,0,1,?,?)`)
          .run(id, intent.requestId, intent.conditionId, intent.tokenId, intent.outcome, intent.side, decimal(dollars),
            decimal(shares), quote.submittedPrice, decimal(shares), intent.executionMode, intent.orderType,
            quote.displayedPrice, quote.submittedPrice, decimal(shares), now, now);
        const isBuy = intent.side === 'BUY';
        this.db.prepare(`INSERT INTO reservations (id,requestId,orderId,assetType,assetId,amount,state,expiresAt,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?,'RESERVED',?,?,?)`).run(crypto.randomUUID(), intent.requestId, id,
            isBuy ? 'COLLATERAL' : 'SHARES', isBuy ? 'USDC' : intent.tokenId, decimal(isBuy ? dollars : shares),
            quote.expiresAt + 60000, now, now);
        this.event(id, null, 'PENDING', 'LOCAL', { quoteId: quote.quoteId });
      })(); 
      return id;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const found = this.db.prepare('SELECT id FROM orders WHERE clientRequestId=?').get(intent.requestId) as { id: string } | undefined;
        if (found) return found.id;
      }
      throw error;
    }
  }
  submitting(id: string): void { this.transition(id, 'SUBMITTING', 'LOCAL'); }
  accepted(id: string, remote: any): any {
    const remoteId = String(remote.remoteOrderId || remote.id || '');
    if (!remoteId) throw new Error('Exchange response omitted the order ID');

    const now = Date.now();
    const updateOrderState = (targetId: string, ghost?: any) => {
      const status = remote.status || ghost?.status || 'ACCEPTED';
      const remoteState = remote.remoteState || remote.state || ghost?.remoteState || status;
      const filledShares = remote.filledShares ?? ghost?.filledShares ?? null;
      const remainingShares = remote.remainingShares ?? remote.size ?? ghost?.remainingShares ?? null;
      const averageFillPrice = remote.averageFillPrice ?? ghost?.averageFillPrice ?? null;
      const fees = remote.fees ?? ghost?.fees ?? null;
      const price = remote.price ?? null;
      const size = remote.size ?? null;

      this.db.prepare(`UPDATE orders SET 
        remoteOrderId=?, status=?, remoteState=?, 
        submittedPrice=COALESCE(?, submittedPrice), size=COALESCE(?, size),
        filledShares=COALESCE(?, filledShares), remainingShares=COALESCE(?, remainingShares),
        averageFillPrice=COALESCE(?, averageFillPrice), fees=COALESCE(?, fees),
        submissionResult='ACCEPTED', reconciliationRequired=0, rowVersion=rowVersion+1, updatedAt=? 
        WHERE id=?`)
        .run(remoteId, status, remoteState, price, size, filledShares, remainingShares, averageFillPrice, fees, now, targetId);

      const terminal = ['FILLED', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED']
        .includes(String(status).toUpperCase());
      this.db.prepare('UPDATE reservations SET state=?, updatedAt=? WHERE orderId=?')
        .run(terminal ? 'RELEASED' : 'ACTIVE', now, targetId);
    };

    try {
      this.db.transaction(() => {
        updateOrderState(id);
        this.event(id, 'SUBMITTING', remote.status || 'ACCEPTED', 'EXCHANGE', remote);
      })();
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        this.db.transaction(() => {
          const ghost = this.db.prepare('SELECT * FROM orders WHERE remoteOrderId=? AND id!=?').get(remoteId, id) as any;
          if (ghost) {
            this.db.prepare('UPDATE fills SET orderId=? WHERE orderId=?').run(id, ghost.id);
            this.db.prepare('UPDATE remote_trades SET orderId=? WHERE orderId=?').run(id, ghost.id);
            this.db.prepare('UPDATE order_events SET orderId=? WHERE orderId=?').run(id, ghost.id);
            this.db.prepare('DELETE FROM reservations WHERE orderId=?').run(ghost.id);
            this.db.prepare('DELETE FROM orders WHERE id=?').run(ghost.id);

            updateOrderState(id, ghost);
            this.event(id, 'SUBMITTING', remote.status || ghost.status || 'ACCEPTED', 'EXCHANGE_MERGE', remote);
          } else {
            throw error;
          }
        })();
      } else {
        throw error;
      }
    }
    return this.get(id);
  }
  rejected(id: string, error: Error): any { return this.finishFailure(id, error, false); }
  ambiguous(id: string, error: Error): any { return this.finishFailure(id, error, true); }
  private finishFailure(id: string, error: Error, ambiguous: boolean): any {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE orders SET status=?,remoteState=?,submissionResult=?,errorMessage=?,reconciliationRequired=?,rowVersion=rowVersion+1,updatedAt=? WHERE id=?`)
        .run(ambiguous ? 'RECONCILING' : 'REJECTED', ambiguous ? 'UNKNOWN' : 'REJECTED', ambiguous ? 'AMBIGUOUS' : 'REJECTED',
          error.message, ambiguous ? 1 : 0, Date.now(), id);
      this.db.prepare('UPDATE reservations SET state=?,updatedAt=? WHERE orderId=?')
        .run(ambiguous ? 'RECONCILING' : 'RELEASED', Date.now(), id);
      this.event(id, 'SUBMITTING', ambiguous ? 'RECONCILING' : 'REJECTED', ambiguous ? 'TRANSPORT' : 'EXCHANGE', { message: error.message });
    })(); return this.get(id);
  }
  markCancelPending(id: string): void { this.transition(id, 'CANCEL_PENDING', 'LOCAL'); }
  confirmCancelled(id: string): any {
    this.db.transaction(() => { this.transition(id, 'CANCELLED', 'EXCHANGE');
      this.db.prepare("UPDATE reservations SET state='RELEASED',updatedAt=? WHERE orderId=?").run(Date.now(), id); })();
    return this.get(id);
  }
  get(id: string): any { return this.db.prepare('SELECT * FROM orders WHERE id=?').get(id); }
}

export const isAmbiguousSubmissionError = (error: any) => error?.ambiguous === true ||
  ['ETIMEDOUT','ECONNRESET','EPIPE','UNKNOWN_ORDER_ERROR','UNKNOWN_MARKET_ORDER_ERROR','AMBIGUOUS_ORDER_RESPONSE','AMBIGUOUS_MARKET_ORDER_RESPONSE'].includes(error?.code) ||
  [408,429].includes(Number(error?.status || error?.response?.status)) ||
  Number(error?.status || error?.response?.status) >= 500;

export class ExecutionService {
  readonly quotes = new QuoteService(); readonly risk: RiskService; readonly lifecycle: OrderLifecycleService;
  constructor(private db: Db, private adapter: TradingAdapter, private disarm: (reason: string) => void) {
    this.risk = new RiskService(db); this.lifecycle = new OrderLifecycleService(db);
  }
  async submit(intent: OrderIntent, quote: ExecutableQuote, account: { balance: number; availableShares: number }): Promise<SubmissionResult> {
    const duplicate = this.db.prepare('SELECT * FROM orders WHERE clientRequestId=?').get(intent.requestId) as any;
    if (duplicate) {
      const result = duplicate.submissionResult || (duplicate.status === 'REJECTED' ? 'REJECTED' : 'AMBIGUOUS');
      return { result, requestId: intent.requestId, orderId: duplicate.id, remoteOrderId: duplicate.remoteOrderId || undefined,
        requestedAmount: intent.side === 'BUY' ? duplicate.dollarSpend : duplicate.requestedShares,
        executedAmount: duplicate.filledShares || '0', unfilledAmount: duplicate.remainingShares || undefined,
        filledShares: duplicate.filledShares || '0', averageExecutionPrice: duplicate.averageFillPrice || undefined,
        fee: duplicate.fees || undefined, remoteTradeIds: [], errorMessage: duplicate.errorMessage || undefined };
    }
    const price = number(quote.submittedPrice), shares = intent.side === 'BUY' ? number(intent.dollarSpend) / price : number(intent.shares), dollars = shares * price;
    this.risk.check({ side: intent.side, tokenId: intent.tokenId, dollars, shares, ...account });
    if (intent.executionMode === 'IMMEDIATE' && (intent.slippageBps || 0) > loadConfig().MAX_FAK_SLIPPAGE_BPS) {
      throw new Error('Immediate order slippage exceeds the configured limit');
    }
    const localOrderId = this.lifecycle.reserve(intent, quote, dollars, shares); this.lifecycle.submitting(localOrderId);
    try {
      const remote = intent.executionMode === 'IMMEDIATE'
        ? await this.adapter.placeMarketOrder(intent.tokenId, intent.side, intent.side === 'BUY' ? decimal(dollars) : decimal(shares), intent.slippageBps, quote.submittedPrice)
        : await this.adapter.placeOrder(intent.tokenId, intent.side, decimal(shares), quote.submittedPrice);
      const stored = this.lifecycle.accepted(localOrderId, remote);
      return { result: 'ACCEPTED', requestId: intent.requestId, orderId: localOrderId, remoteOrderId: stored.remoteOrderId,
        requestedAmount: intent.side === 'BUY' ? decimal(dollars) : decimal(shares), executedAmount: stored.filledShares || '0',
        unfilledAmount: stored.remainingShares || decimal(shares), filledShares: stored.filledShares || '0',
        averageExecutionPrice: stored.averageFillPrice || undefined, fee: stored.fees || undefined, remoteTradeIds: [] };
    } catch (error: any) {
      if (isAmbiguousSubmissionError(error)) { this.lifecycle.ambiguous(localOrderId, error); this.disarm('AMBIGUOUS_ORDER');
        return { result: 'AMBIGUOUS', requestId: intent.requestId, orderId: localOrderId, requestedAmount: intent.side === 'BUY' ? decimal(dollars) : decimal(shares), remoteTradeIds: [], errorMessage: error.message }; }
      this.lifecycle.rejected(localOrderId, error);
      return { result: 'REJECTED', requestId: intent.requestId, orderId: localOrderId, requestedAmount: intent.side === 'BUY' ? decimal(dollars) : decimal(shares), remoteTradeIds: [], errorMessage: error.message };
    }
  }
}
