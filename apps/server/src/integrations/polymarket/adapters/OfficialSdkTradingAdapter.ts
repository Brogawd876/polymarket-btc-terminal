import { Order, MarketState, Side, OrderStatus } from '@polymarket-btc/shared';
import { ethers } from 'ethers';

import { AssetType, ClobClient, Side as ClobSide, OrderType } from '@polymarket/clob-client-v2';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYMARKET_API_KEY = process.env.POLYMARKET_API_KEY || process.env.BUILDER_KEY || '';
const POLY_SIGNATURE_TYPE = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
const POLY_FUNDER_ADDRESS = process.env.POLY_FUNDER_ADDRESS;

import crypto from 'crypto';
import WebSocket from 'ws';
import { getDb } from '../../../db/index';

import { TradingAdapter } from './TradingAdapter';
import { TradingError } from '../../../errors/TradingError';

export class OfficialSdkTradingAdapter extends TradingAdapter {
  private isConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private activeSubscriptions: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private wallet?: ethers.Wallet;
  private clobClient!: ClobClient;
  private wsUser?: WebSocket;
  private wsMarket?: WebSocket;

  // Track token IDs for each condition
  private conditionTokens: Map<string, {yesTokenId: string, noTokenId: string}> = new Map();
  private tokenToCondition: Map<string, string> = new Map();
  private orderbooks: Map<string, { bids: any[], asks: any[] }> = new Map();

  constructor() {
    super();
    if (process.env.ENABLE_LIVE_TRADING === 'true') {
      if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY is not set in environment. Fatal initialization error.');
      }
      this.wallet = new ethers.Wallet(PRIVATE_KEY);
      delete process.env.PRIVATE_KEY;
    }
  }

  async initialize(): Promise<void> {
    console.log('Initializing Polymarket Adapter...');

    if (process.env.ENABLE_LIVE_TRADING !== 'true') {
      console.warn('ENABLE_LIVE_TRADING is not true. Polymarket integration is disabled.');
      this.isConnected = false;
      return;
    }
    
    this.clobClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: this.wallet,
      signatureType: POLY_SIGNATURE_TYPE,
      funderAddress: POLY_FUNDER_ADDRESS
    });
    const creds = await this.clobClient.createOrDeriveApiKey();
    this.clobClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: this.wallet,
      creds,
      signatureType: POLY_SIGNATURE_TYPE,
      funderAddress: POLY_FUNDER_ADDRESS
    });

    try {
      const openOrders = await this.clobClient.getOpenOrders();
      console.log('Boot Sync: Fetched open orders:', openOrders.length);
      
      const openOrderIds = new Set(openOrders.map((o: any) => o.id || o.orderID || o.order_id));
      
      const db = getDb();
      const restingOrders = db.prepare(`SELECT id, status FROM orders WHERE status IN ('PENDING', 'OPEN', 'NEW')`).all() as {id: string, status: string}[];
      
      let filledCount = 0;
      let cancelledCount = 0;
      let restingCount = 0;

      for (const order of restingOrders) {
        if (!openOrderIds.has(order.id)) {
          try {
            const details = await this.clobClient.getOrder(order.id);
            const sizeMatched = parseFloat((details as any).size_matched || '0');
            const originalSize = parseFloat((details as any).original_size || (details as any).size || '0');
            
            if (sizeMatched > 0 && sizeMatched >= originalSize) {
              db.prepare(`UPDATE orders SET status = 'FILLED' WHERE id = ?`).run(order.id);
              filledCount++;
            } else if (details.status === 'canceled' || details.status === 'cancelled' || details.status === 'closed') {
              db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`).run(order.id);
              cancelledCount++;
            } else {
              db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`).run(order.id);
              cancelledCount++;
            }
          } catch (err: any) {
            // Default to cancelled on 404 or other errors
            db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`).run(order.id);
            cancelledCount++;
          }
        } else {
          restingCount++;
        }
      }
      
      console.log(`Reconciled ${filledCount} filled, ${cancelledCount} cancelled, ${restingCount} resting`);
    } catch(err) {
      console.error('Failed to sync open orders:', err);
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sigString = `${timestamp}GET/ws/user`;
    const signature = crypto.createHmac('sha256', Buffer.from(creds.secret, 'base64'))
                            .update(sigString)
                            .digest('base64');
                            
    this.wsUser = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user');
    this.wsUser.on('open', () => {
       console.log('Connected to WS User channel');
       this.wsUser?.send(JSON.stringify({
          assets: ["user"],
          type: "auth",
          key: creds.key,
          secret: creds.secret,
          passphrase: creds.passphrase,
          timestamp: timestamp,
          signature: signature
       }));
    });
    this.wsUser.on('message', (data) => {
       try {
           const msg = JSON.parse(data.toString());
           if (msg.event === 'auth') {
               console.log('WS User auth status:', msg.status);
           }
           if (Array.isArray(msg)) {
               for (const item of msg) {
                   this.handleUserMessage(item);
               }
           } else {
               this.handleUserMessage(msg);
           }
       } catch (err) {
           console.error('Error parsing WS User msg:', err);
       }
    });

    this.wsMarket = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
    this.wsMarket.on('open', () => {
      console.log('Connected to WS Market channel');
      // Re-subscribe to active subscriptions if reconnected
      const allTokens: string[] = [];
      for (const conditionId of this.activeSubscriptions) {
        const tokens = this.conditionTokens.get(conditionId);
        if (tokens) {
          allTokens.push(tokens.yesTokenId, tokens.noTokenId);
        }
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
        if (!raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
          console.warn(`Ignoring non-JSON WS Market msg: ${raw}`);
          return;
        }

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

    this.wsMarket.on('error', (err) => console.error('WS Market Error:', err));
    this.wsMarket.on('close', () => console.log('WS Market connection closed'));

    this.isConnected = true;
    console.log('Polymarket Adapter Initialized.');
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down Polymarket Adapter...');
    this.isConnected = false;
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
      
      if (msg.bids && Array.isArray(msg.bids)) {
         ob.bids = msg.bids;
      }
      if (msg.asks && Array.isArray(msg.asks)) {
         ob.asks = msg.asks;
      }

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
      if (status === 'canceled' || status === 'cancelled' || status === 'closed') {
        const db = getDb();
        db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ? AND status != 'FILLED'`).run(orderId);
        console.log(`Order ${orderId} cancelled via WS`);
      } else if (status === 'filled') {
        const db = getDb();
        db.prepare(`UPDATE orders SET status = 'FILLED' WHERE id = ?`).run(orderId);
      }
    }
  }
  
  private updateMarketStateFromOrderbooks(conditionId: string) {
    const tokens = this.conditionTokens.get(conditionId);
    if (!tokens) return;
    
    const yesOb = this.orderbooks.get(tokens.yesTokenId);
    const noOb = this.orderbooks.get(tokens.noTokenId);
    
    let yesBid = '0', yesAsk = '0', noBid = '0', noAsk = '0';
    let yesPrice = '0', noPrice = '0';
    
    if (yesOb) {
      yesBid = yesOb.bids.length > 0 ? yesOb.bids[0].price : '0';
      yesAsk = yesOb.asks.length > 0 ? yesOb.asks[0].price : '0';
      yesPrice = yesBid !== '0' ? yesBid : (yesAsk !== '0' ? yesAsk : '0');
    }
    
    if (noOb) {
      noBid = noOb.bids.length > 0 ? noOb.bids[0].price : '0';
      noAsk = noOb.asks.length > 0 ? noOb.asks[0].price : '0';
      noPrice = noBid !== '0' ? noBid : (noAsk !== '0' ? noAsk : '0');
    }
    
    const existing = this.marketCache.get(conditionId) || {
      marketId: conditionId,
      conditionId,
      yesTokenId: tokens.yesTokenId,
      noTokenId: tokens.noTokenId,
      status: 'OPEN'
    };
    
    this.marketCache.set(conditionId, {
      ...existing,
      yesPrice,
      noPrice,
      yesBid,
      yesAsk,
      noBid,
      noAsk,
      lastUpdated: Date.now()
    } as MarketState);
  }

  private handleFill(fill: any) {
    console.log('Received fill:', fill);
    try {
      const db = getDb();
      const fillId = fill.id || `fill_${Date.now()}_${Math.random()}`;
      const orderId = fill.order_id || 'unknown';
      const tokenId = fill.asset_id || fill.token_id;
      const side = fill.side; // "BUY" or "SELL"
      const price = fill.price;
      const size = fill.size;
      const fee = fill.fee || '0';
      const createdAt = Date.now();

      db.prepare(`INSERT OR IGNORE INTO fills (id, orderId, tokenId, side, price, size, fee, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(fillId, orderId, tokenId, side, String(price), String(size), String(fee), createdAt);

      // aggregate positions
      const existingPos = db.prepare(`SELECT * FROM positions WHERE tokenId = ?`).get(tokenId) as any;
      
      const fillSize = parseFloat(size);
      const fillPrice = parseFloat(price);
      
      if (existingPos) {
        let netSize = parseFloat(existingPos.netSize);
        let avgPrice = parseFloat(existingPos.avgPrice);
        
        if (side.toUpperCase() === 'BUY') {
          const totalCost = (netSize * avgPrice) + (fillSize * fillPrice);
          netSize += fillSize;
          avgPrice = netSize > 0 ? totalCost / netSize : 0;
        } else {
          netSize -= fillSize;
          if (netSize === 0) avgPrice = 0;
        }
        
        db.prepare(`UPDATE positions SET netSize = ?, avgPrice = ?, updatedAt = ? WHERE tokenId = ?`)
          .run(String(netSize), String(avgPrice), createdAt, tokenId);
      } else {
        const netSize = side.toUpperCase() === 'BUY' ? fillSize : -fillSize;
        const avgPrice = fillPrice;
        db.prepare(`INSERT INTO positions (tokenId, netSize, avgPrice, updatedAt) VALUES (?, ?, ?, ?)`)
          .run(tokenId, String(netSize), String(avgPrice), createdAt);
      }
    } catch(err) {
       console.error('Error handling fill:', err);
    }
  }

  subscribeToMarket(conditionId: string, yesTokenId: string, noTokenId: string): void {
    if (!this.activeSubscriptions.has(conditionId)) {
      this.activeSubscriptions.add(conditionId);
      this.conditionTokens.set(conditionId, { yesTokenId, noTokenId });
      this.tokenToCondition.set(yesTokenId, conditionId);
      this.tokenToCondition.set(noTokenId, conditionId);
      
      if (this.wsMarket?.readyState === WebSocket.OPEN) {
         this.wsMarket.send(JSON.stringify({
            operation: "subscribe",
            assets_ids: [yesTokenId, noTokenId],
         }));
      }
    }
  }

  updateMarketDiscovery(market: MarketState) {
    const existing = this.marketCache.get(market.conditionId);
    if (!existing) {
      this.marketCache.set(market.conditionId, market);
      this.subscribeToMarket(market.conditionId, market.yesTokenId, market.noTokenId);
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

  async placeOrder(tokenId: string, side: Side, size: string, price: string, orderType?: 'GTC' | 'FAK' | 'FOK'): Promise<Order> {
    if (!this.isConnected) throw new TradingError('Adapter not connected', 'ADAPTER_NOT_CONNECTED');
    
    const tickSizeStr = await this.clobClient.getTickSize(tokenId);
    const tickSize = parseFloat(tickSizeStr);
    
    let precision = 2;
    if (tickSizeStr.includes('.')) {
      precision = tickSizeStr.split('.')[1].length;
    }
    
    const p = parseFloat(price);
    const s = parseFloat(size);
    const roundedPrice = Math.round(p / tickSize) * tickSize;
    const roundedSize = Math.round(s / tickSize) * tickSize;

    const actualOrderType = orderType || 'GTC';
    const clobOrderType = OrderType[actualOrderType];
    const isPostOnly = actualOrderType === 'GTC';

    const orderArgs = {
      tokenID: tokenId,
      price: Number(roundedPrice.toFixed(precision)),
      side: side === 'BUY' ? ClobSide.BUY : ClobSide.SELL,
      size: Number(roundedSize.toFixed(precision)),
      feeRateBps: 0,
      nonce: 0,
      // If it's a taker order, postOnly must be false, wait, clob-client handles postOnly dynamically? We'll just pass it.
      postOnly: isPostOnly
    };

    try {
      const signedOrder = await this.clobClient.createOrder(orderArgs);
      const response = await this.clobClient.postOrder(signedOrder, clobOrderType, isPostOnly);
      
      if ((response as any).errorMsg) {
         throw new TradingError(`Polymarket API error: ${(response as any).errorMsg}`, 'API_ERROR');
      }
      
      let mappedStatus: OrderStatus = 'PENDING';
      if (response.success) {
         // order was placed successfully
         mappedStatus = 'PENDING';
      } else {
         mappedStatus = 'REJECTED';
      }

      const order: Order = {
        id: response.orderID || `0x${Date.now().toString(16)}`,
        tokenId,
        side,
        size: roundedSize.toFixed(precision),
        price: roundedPrice.toFixed(precision),
        status: mappedStatus,
        timestamp: Date.now(),
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

  async getMarketState(conditionId: string): Promise<any> {
    const state = this.marketCache.get(conditionId);
    if (!state) return null;
    if (Date.now() - state.lastUpdated > 10000) {
      console.warn(`Market ${conditionId} data is stale (>10s old)`);
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
      // Polygon USDC.e contract
      const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon.drpc.org';
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint256)'], provider);
      const balanceAddress = POLY_FUNDER_ADDRESS || this.wallet.address;
      const bal = await contract.balanceOf(balanceAddress);
      return parseFloat(ethers.utils.formatUnits(bal, 6));
    } catch (e) {
      console.error('Failed to fetch balance', e);
      return 0;
    }
  }

  private parseCollateralBalance(balance: string): number {
    const parsed = parseFloat(balance);
    if (!Number.isFinite(parsed)) return 0;

    return parsed > 100000 ? parsed / 1_000_000 : parsed;
  }
}
