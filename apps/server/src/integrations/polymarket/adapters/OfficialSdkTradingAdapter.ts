import { Order, MarketState, Side, OrderState, AccountState, Position } from '@polymarket-btc/shared';
import { ethers } from 'ethers';
import { AssetType, ClobClient, Side as ClobSide, OrderType, type TickSize } from '@polymarket/clob-client-v2';
import WebSocket from 'ws';
import { getDb } from '../../../db/index';
import { TradingAdapter } from './TradingAdapter';
import { TradingError } from '../../../errors/TradingError';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLY_SIGNATURE_TYPE = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
const POLY_FUNDER_ADDRESS = process.env.POLY_FUNDER_ADDRESS;
const SUPPORTED_TICK_SIZES: TickSize[] = ['0.1', '0.01', '0.005', '0.0025', '0.001', '0.0001'];

function normalizeTickSize(value: string): TickSize {
  return SUPPORTED_TICK_SIZES.includes(value as TickSize) ? value as TickSize : '0.01';
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
  private lastReconciliationTime: number = 0;

  private conditionTokens: Map<string, { upTokenId: string, downTokenId: string }> = new Map();
  private tokenToCondition: Map<string, string> = new Map();
  private orderbooks: Map<string, { bids: any[], asks: any[] }> = new Map();
  private restOrderbookRefreshTimes: Map<string, number> = new Map();

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

  async initialize(): Promise<void> {
    console.log('Initializing Polymarket Adapter...');

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
    if (this.wsUser) {
      this.wsUser.close();
      this.wsUser = undefined;
    }
    if (this.wsMarket) {
      this.wsMarket.close();
      this.wsMarket = undefined;
    }
  }

  private async reconcileState(creds: any): Promise<void> {
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
      const restingOrders = db.prepare(`SELECT id, status, clientRequestId FROM orders WHERE status IN ('PENDING', 'OPEN', 'NEW', 'SUBMITTING', 'RECONCILING')`).all() as { id: string, status: string, clientRequestId?: string }[];

      for (const order of restingOrders) {
        if (remoteOrderMap.has(order.id)) {
          db.prepare(`UPDATE orders SET status = 'LIVE', remoteState = 'LIVE', updatedAt = ? WHERE id = ?`).run(Date.now(), order.id);
        } else {
          try {
            const details = await this.clobClient.getOrder(order.id);
            const sizeMatched = parseFloat((details as any).size_matched || '0');
            const originalSize = parseFloat((details as any).original_size || (details as any).size || '0');

            if (sizeMatched > 0 && sizeMatched >= originalSize) {
              db.prepare(`UPDATE orders SET status = 'FILLED', filledShares = ?, remoteState = 'FILLED', updatedAt = ? WHERE id = ?`).run(String(sizeMatched), Date.now(), order.id);
            } else if (details.status === 'canceled' || details.status === 'cancelled' || details.status === 'closed') {
              db.prepare(`UPDATE orders SET status = 'CANCELLED', remoteState = 'CANCELLED', updatedAt = ? WHERE id = ?`).run(Date.now(), order.id);
            } else {
              db.prepare(`UPDATE orders SET status = 'CANCELLED', remoteState = 'UNKNOWN', updatedAt = ? WHERE id = ?`).run(Date.now(), order.id);
            }
          } catch (err: any) {
            db.prepare(`UPDATE orders SET status = 'CANCELLED', remoteState = 'CANCELLED', updatedAt = ? WHERE id = ?`).run(Date.now(), order.id);
          }
        }
      }

      this.lastReconciliationTime = Date.now();
      console.log('Boot reconciliation completed successfully.');
    } catch (err) {
      console.error('Failed to reconcile open orders on boot:', err);
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
          fee: '0',
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
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  private connectUserWs(creds: any) {
    if (this.userWsReconnectTimer) {
      clearTimeout(this.userWsReconnectTimer);
      this.userWsReconnectTimer = null;
    }

    this.wsUser = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user');
    this.wsUser.on('open', () => {
       console.log('Connected to WS User channel');
       this.wsUser?.send(JSON.stringify({
          auth: {
            apiKey: creds.key,
            secret: creds.secret,
            passphrase: creds.passphrase,
          },
          type: "user"
       }));
       this.userStreamConnected = true;
    });

    this.wsUser.on('message', (data) => {
       try {
           const msg = JSON.parse(data.toString());
           if (msg.event === 'auth') {
               this.userStreamConnected = msg.status === 'ok' || msg.status === true;
               console.log('WS User auth status:', msg.status);
           }
           if (Array.isArray(msg)) {
               for (const item of msg) this.handleUserMessage(item);
           } else {
               this.handleUserMessage(msg);
           }
       } catch (err) {
           console.error('Error parsing WS User msg:', err);
       }
    });

    this.wsUser.on('close', (code, reason) => {
       this.userStreamConnected = false;
       console.log(`WS User channel disconnected (${code}${reason ? `: ${reason.toString()}` : ''}), reconnecting in 3s`);
       if (this.isConnected) {
         this.userWsReconnectTimer = setTimeout(() => this.connectUserWs(creds), 3000);
       }
    });

    this.wsUser.on('error', (err) => {
       this.userStreamConnected = false;
       console.error('WS User Error:', err);
    });
  }

  private connectMarketWs() {
    this.wsMarket = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
    this.wsMarket.on('open', () => {
      console.log('Connected to WS Market channel');
      const allTokens: string[] = [];
      for (const conditionId of this.activeSubscriptions) {
        const tokens = this.conditionTokens.get(conditionId);
        if (tokens) allTokens.push(tokens.upTokenId, tokens.downTokenId);
      }
      if (allTokens.length > 0) {
        this.wsMarket?.send(JSON.stringify({
          assets_ids: allTokens,
          type: "market"
        }));
      }
    });
    
    this.wsMarket.on('message', (data) => {
      try {
        const raw = data.toString();
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

    this.wsMarket.on('close', () => console.log('WS Market connection closed'));
    this.wsMarket.on('error', (err) => console.error('WS Market Error:', err));
  }

  private handleMarketMessage(msg: any) {
    const eventType = msg.event_type || msg.event;

    if (eventType === 'market' || eventType === 'book') {
      const assetId = msg.asset_id;
      if (!assetId) return;
      
      const conditionId = this.tokenToCondition.get(assetId);
      if (!conditionId) return;

      if (!this.orderbooks.has(assetId)) {
        this.orderbooks.set(assetId, { bids: [], asks: [] });
      }
      const ob = this.orderbooks.get(assetId)!;
      
      if (msg.bids && Array.isArray(msg.bids)) ob.bids = msg.bids;
      if (msg.asks && Array.isArray(msg.asks)) ob.asks = msg.asks;

      this.updateMarketStateFromOrderbooks(conditionId);
    } else if (eventType === 'price_change') {
      const changes = Array.isArray(msg.price_changes) ? msg.price_changes : [msg];
      const changedConditions = new Set<string>();

      for (const change of changes) {
        const assetId = change.asset_id;
        if (!assetId) continue;
        const conditionId = this.tokenToCondition.get(assetId);
        if (!conditionId) continue;

        const ob = this.orderbooks.get(assetId) || { bids: [], asks: [] };
        if (change.bids && Array.isArray(change.bids)) ob.bids = change.bids;
        if (change.asks && Array.isArray(change.asks)) ob.asks = change.asks;
        if (change.best_bid) ob.bids = [{ price: change.best_bid, size: change.size || '0' }, ...ob.bids.slice(1)];
        if (change.best_ask) ob.asks = [{ price: change.best_ask, size: change.size || '0' }, ...ob.asks.slice(1)];
        this.orderbooks.set(assetId, ob);
        changedConditions.add(conditionId);
      }

      for (const conditionId of changedConditions) this.updateMarketStateFromOrderbooks(conditionId);
    } else if (eventType === 'best_bid_ask') {
      const assetId = msg.asset_id;
      if (!assetId) return;
      const conditionId = this.tokenToCondition.get(assetId);
      if (!conditionId) return;

      const ob = this.orderbooks.get(assetId) || { bids: [], asks: [] };
      if (msg.best_bid) ob.bids = [{ price: msg.best_bid, size: '0' }, ...ob.bids.slice(1)];
      if (msg.best_ask) ob.asks = [{ price: msg.best_ask, size: '0' }, ...ob.asks.slice(1)];
      this.orderbooks.set(assetId, ob);
      this.updateMarketStateFromOrderbooks(conditionId);
    }
  }

  private handleUserMessage(item: any) {
    if (item.event === 'fill') {
      this.handleFill(item);
    } else if (item.event === 'order' || item.event === 'order_change') {
      const orderId = item.order_id || item.id;
      if (!orderId) return;
      const status = item.status;
      const db = getDb();
      if (status === 'canceled' || status === 'cancelled' || status === 'closed') {
        db.prepare(`UPDATE orders SET status = 'CANCELLED', remoteState = 'CANCELLED', updatedAt = ? WHERE id = ? AND status != 'FILLED'`).run(Date.now(), orderId);
      } else if (status === 'filled') {
        db.prepare(`UPDATE orders SET status = 'FILLED', remoteState = 'FILLED', updatedAt = ? WHERE id = ?`).run(Date.now(), orderId);
      } else if (status === 'live' || status === 'open') {
        db.prepare(`UPDATE orders SET status = 'LIVE', remoteState = 'LIVE', updatedAt = ? WHERE id = ?`).run(Date.now(), orderId);
      }
    }
  }

  private updateMarketStateFromOrderbooks(conditionId: string) {
    const tokens = this.conditionTokens.get(conditionId);
    if (!tokens) return;
    
    const upOb = this.orderbooks.get(tokens.upTokenId);
    const downOb = this.orderbooks.get(tokens.downTokenId);
    
    let upBid = '0', upAsk = '0', downBid = '0', downAsk = '0';
    let upPrice = '0.50', downPrice = '0.50';
    
    if (upOb) {
      upBid = this.getBestBid(upOb.bids);
      upAsk = this.getBestAsk(upOb.asks);
      upPrice = upBid !== '0' ? upBid : (upAsk !== '0' ? upAsk : '0.50');
    }
    
    if (downOb) {
      downBid = this.getBestBid(downOb.bids);
      downAsk = this.getBestAsk(downOb.asks);
      downPrice = downBid !== '0' ? downBid : (downAsk !== '0' ? downAsk : '0.50');
    }
    
    const existing = this.marketCache.get(conditionId) || {
      marketId: conditionId,
      conditionId,
      upTokenId: tokens.upTokenId,
      downTokenId: tokens.downTokenId,
      yesTokenId: tokens.upTokenId,
      noTokenId: tokens.downTokenId,
      upPrice,
      downPrice,
      status: 'OPEN',
      lastUpdated: Date.now()
    };
    
    this.marketCache.set(conditionId, {
      ...existing,
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
      lastUpdated: Date.now()
    } as MarketState);
  }

  private getBestBid(levels: any[]): string {
    return this.getBestPrice(levels, 'bid');
  }

  private getBestAsk(levels: any[]): string {
    return this.getBestPrice(levels, 'ask');
  }

  private getBestPrice(levels: any[], side: 'bid' | 'ask'): string {
    if (!Array.isArray(levels) || levels.length === 0) return '0';

    let best = side === 'bid' ? -Infinity : Infinity;
    for (const level of levels) {
      const price = parseFloat(String(level?.price || '0'));
      const size = parseFloat(String(level?.size || '0'));
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue;
      if (side === 'bid' ? price > best : price < best) best = price;
    }

    return Number.isFinite(best) ? best.toFixed(2) : '0';
  }

  private handleFill(fill: any) {
    console.log('Received fill event:', fill);
    try {
      const db = getDb();
      const fillId = fill.id || `fill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const orderId = fill.order_id || 'unknown';
      const tokenId = fill.asset_id || fill.token_id;
      const side = (fill.side || 'BUY').toUpperCase();
      const price = String(fill.price || '0');
      const size = String(fill.size || '0');
      const fee = String(fill.fee || '0');
      const conditionId = fill.conditionId || fill.market || '';
      const rawOutcome = String(fill.outcome || '').toUpperCase();
      const outcome = rawOutcome.includes('DOWN') || rawOutcome === 'NO' ? 'DOWN' : 'UP';
      const createdAt = fill.createdAt || Date.now();

      db.prepare(`INSERT OR IGNORE INTO orders (id, remoteOrderId, conditionId, tokenId, outcome, side, dollarSpend, size, price, filledShares, fees, status, remoteState, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(orderId, orderId, conditionId, tokenId, outcome, side, '0', size, price, size, fee, 'FILLED', 'FILLED', createdAt, createdAt);
      db.prepare(`UPDATE orders SET filledShares = ?, averageFillPrice = ?, fees = ?, status = 'FILLED', remoteState = 'FILLED', updatedAt = ? WHERE id = ?`)
        .run(size, price, fee, createdAt, orderId);

      db.prepare(`INSERT OR IGNORE INTO fills (id, orderId, tokenId, side, price, size, fee, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(fillId, orderId, tokenId, side, price, size, fee, createdAt);

      const fills = db.prepare(`SELECT side, price, size, fee FROM fills WHERE tokenId = ?`).all(tokenId) as { side: string, price: string, size: string, fee: string }[];
      
      let netSize = 0;
      let totalCost = 0;
      let totalFees = 0;
      let realizedPnl = 0;

      for (const f of fills) {
        const fSize = parseFloat(f.size);
        const fPrice = parseFloat(f.price);
        const fFee = parseFloat(f.fee || '0');
        totalFees += fFee;

        if (f.side === 'BUY') {
          totalCost += (fSize * fPrice);
          netSize += fSize;
        } else if (f.side === 'SELL') {
          const avgCostBeforeSell = netSize > 0 ? (totalCost / netSize) : 0;
          const sellProceeds = fSize * fPrice;
          const costBasis = fSize * avgCostBeforeSell;
          realizedPnl += (sellProceeds - costBasis - fFee);

          netSize = Math.max(0, netSize - fSize);
          if (netSize === 0) totalCost = 0;
          else totalCost = netSize * avgCostBeforeSell;
        }
      }

      const avgPrice = netSize > 0 ? (totalCost / netSize).toFixed(4) : '0';

      db.prepare(`INSERT INTO positions (tokenId, conditionId, outcome, netSize, avgPrice, fees, realizedPnl, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tokenId) DO UPDATE SET conditionId=excluded.conditionId, outcome=excluded.outcome, netSize=excluded.netSize, avgPrice=excluded.avgPrice, fees=excluded.fees, realizedPnl=excluded.realizedPnl, updatedAt=excluded.updatedAt`)
        .run(tokenId, conditionId, outcome, String(netSize), String(avgPrice), String(totalFees), realizedPnl, createdAt);

      console.log(`Updated position for ${tokenId}: Net ${netSize} @ ${avgPrice}, Realized PnL: $${realizedPnl.toFixed(2)}`);
    } catch(err) {
       console.error('Error processing fill:', err);
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
        title: market.title,
        targetTime: market.targetTime,
        type: market.type,
        status: market.status,
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
    const roundedPrice = Math.round(p / tickSize) * tickSize;
    const roundedSize = Math.round(s / tickSize) * tickSize;

    const orderArgs = {
      tokenID: tokenId,
      price: Number(roundedPrice.toFixed(precision)),
      side: side === 'BUY' ? ClobSide.BUY : ClobSide.SELL,
      size: Number(roundedSize.toFixed(precision)),
      feeRateBps: 0,
      nonce: 0,
    };

    try {
      const response = await this.clobClient.createAndPostOrder(
        orderArgs,
        { tickSize: normalizedTickSize },
        OrderType.GTC,
        true
      );
      console.log(`Polymarket CLOB order response: ${JSON.stringify(response)}`);
      
      if ((response as any).error || (response as any).errorMsg || !(response as any).success) {
        const reason = (response as any).errorMsg || (response as any).error || (response as any).status || JSON.stringify(response);
        throw new TradingError(`Polymarket API rejected order: ${reason}`, 'API_REJECTED_ORDER');
      }

      const order: Order = {
        id: response.orderID || `0x${Date.now().toString(16)}`,
        remoteOrderId: response.orderID,
        tokenId,
        side,
        size: roundedSize.toFixed(precision),
        price: roundedPrice.toFixed(precision),
        filledShares: '0',
        fees: '0',
        status: response.success ? 'LIVE' : 'REJECTED',
        state: response.success ? 'LIVE' : 'REJECTED',
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

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    try {
      await this.clobClient.cancelOrder({ orderID: orderId }); 
      console.log(`Cancelled order: ${orderId}`);
      return true;
    } catch (error: any) {
      console.error('Error canceling order:', error);
      throw new TradingError(error.message, 'CANCEL_FAILED');
    }
  }

  async cancelAll(): Promise<boolean> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    try {
      await this.clobClient.cancelAll();
      console.log('Cancelled all open orders via CLOB');
      return true;
    } catch (error: any) {
      console.error('Error executing cancelAll:', error);
      throw new TradingError(error.message, 'CANCEL_ALL_FAILED');
    }
  }

  async getMarketState(conditionId: string): Promise<any> {
    await this.refreshMarketOrderbooks(conditionId);
    const state = this.marketCache.get(conditionId);
    if (!state) return null;
    if (Date.now() - state.lastUpdated > 10000) {
      return { ...state, stale: true };
    }
    return state;
  }

  private async refreshMarketOrderbooks(conditionId: string): Promise<void> {
    const lastRefresh = this.restOrderbookRefreshTimes.get(conditionId) || 0;
    if (Date.now() - lastRefresh < 1500) return;

    const tokens = this.conditionTokens.get(conditionId);
    if (!tokens || !this.clobClient) return;

    this.restOrderbookRefreshTimes.set(conditionId, Date.now());
    try {
      const [upBook, downBook] = await Promise.all([
        this.clobClient.getOrderBook(tokens.upTokenId),
        this.clobClient.getOrderBook(tokens.downTokenId),
      ]);

      this.orderbooks.set(tokens.upTokenId, {
        bids: Array.isArray((upBook as any).bids) ? (upBook as any).bids : [],
        asks: Array.isArray((upBook as any).asks) ? (upBook as any).asks : [],
      });
      this.orderbooks.set(tokens.downTokenId, {
        bids: Array.isArray((downBook as any).bids) ? (downBook as any).bids : [],
        asks: Array.isArray((downBook as any).asks) ? (downBook as any).asks : [],
      });

      this.updateMarketStateFromOrderbooks(conditionId);
    } catch (err) {
      console.warn(`Failed to refresh CLOB orderbook for ${conditionId}:`, err);
    }
  }

  async getBalance(): Promise<number> {
    if (!this.wallet) return 0;
    try {
      const balanceAllowance = await this.clobClient.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL
      });
      const clobBalance = this.parseCollateralBalance(balanceAllowance.balance);
      if (clobBalance > 0) return clobBalance;
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
      return parseFloat(ethers.utils.formatUnits(bal, 6));
    } catch (e) {
      return 0;
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

    return {
      signerAddress: this.wallet?.address,
      funderAddress: POLY_FUNDER_ADDRESS || this.wallet?.address,
      signatureType: POLY_SIGNATURE_TYPE,
      collateralBalance: balance,
      allowanceValid,
      authenticated: this.isConnected,
      userStreamConnected: this.userStreamConnected,
      lastReconciliationTime: this.lastReconciliationTime,
    };
  }

  private parseCollateralBalance(balance: string): number {
    const parsed = parseFloat(balance);
    if (!Number.isFinite(parsed)) return 0;
    return parsed > 100000 ? parsed / 1_000_000 : parsed;
  }
}
