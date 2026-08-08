import { Order, MarketState, Side, OrderState, AccountState, Position } from '@polymarket-btc/shared';
import { ethers } from 'ethers';
import { AssetType, ClobClient, Side as ClobSide, OrderType } from '@polymarket/clob-client-v2';
import crypto from 'crypto';
import WebSocket from 'ws';
import { getDb } from '../../../db/index';
import { TradingAdapter } from './TradingAdapter';
import { TradingError } from '../../../errors/TradingError';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLY_SIGNATURE_TYPE = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
const POLY_FUNDER_ADDRESS = process.env.POLY_FUNDER_ADDRESS;

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
  private lastReconciliationTime: number = 0;

  private conditionTokens: Map<string, { upTokenId: string, downTokenId: string }> = new Map();
  private tokenToCondition: Map<string, string> = new Map();
  private orderbooks: Map<string, { bids: any[], asks: any[] }> = new Map();

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
      console.log('Derived creds:', creds);
      this.clobClient = new ClobClient({
        host: 'https://clob.polymarket.com',
        chain: 137,
        signer: this.wallet,
        creds,
        signatureType: POLY_SIGNATURE_TYPE,
        funderAddress: POLY_FUNDER_ADDRESS
      });

      await this.reconcileState(creds);
      this.connectUserWs(creds);
      this.connectMarketWs();

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

  private connectUserWs(creds: any) {
    const timestamp = Date.now().toString();
    const sigString = `${timestamp}GET/ws`;
    const normalizedSecret = creds.secret.replace(/-/g, '+').replace(/_/g, '/');
    const signature = crypto.createHmac('sha256', Buffer.from(normalizedSecret, 'base64'))
        .update(sigString)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
                            
    this.wsUser = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user');
    this.wsUser.on('open', () => {
       console.log('Connected to WS User channel');
       this.wsUser?.send(JSON.stringify({
          assets: ["user"],
          type: "auth",
          key: creds.key,
          passphrase: creds.passphrase,
          timestamp: timestamp,
          signature: signature
       }));
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

    this.wsUser.on('close', () => {
       this.userStreamConnected = false;
       console.log('WS User channel disconnected');
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
      upBid = upOb.bids.length > 0 ? upOb.bids[0].price : '0';
      upAsk = upOb.asks.length > 0 ? upOb.asks[0].price : '0';
      upPrice = upBid !== '0' ? upBid : (upAsk !== '0' ? upAsk : '0.50');
    }
    
    if (downOb) {
      downBid = downOb.bids.length > 0 ? downOb.bids[0].price : '0';
      downAsk = downOb.asks.length > 0 ? downOb.asks[0].price : '0';
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
      const createdAt = Date.now();

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

      db.prepare(`INSERT INTO positions (tokenId, netSize, avgPrice, fees, realizedPnl, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tokenId) DO UPDATE SET netSize=excluded.netSize, avgPrice=excluded.avgPrice, fees=excluded.fees, realizedPnl=excluded.realizedPnl, updatedAt=excluded.updatedAt`)
        .run(tokenId, String(netSize), String(avgPrice), String(totalFees), realizedPnl, createdAt);

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
    const tickSize = parseFloat(tickSizeStr) || 0.01;
    
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
      postOnly: true
    };

    try {
      const signedOrder = await this.clobClient.createOrder(orderArgs);
      const response = await this.clobClient.postOrder(signedOrder, OrderType.GTC, true);
      
      if ((response as any).errorMsg) {
         throw new TradingError(`Polymarket API error: ${(response as any).errorMsg}`, 'API_ERROR');
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
    const state = this.marketCache.get(conditionId);
    if (!state) return null;
    if (Date.now() - state.lastUpdated > 10000) {
      return { ...state, stale: true };
    }
    return state;
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
