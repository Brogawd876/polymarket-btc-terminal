import { Order, MarketState, Side, OrderStatus } from '@polymarket-btc/shared';
import { TradingAdapter } from './TradingAdapter';
import { getDb } from '../../../db/index';
import WebSocket from 'ws';

interface PaperOrder extends Order {
  remainingSize: number;
}

export class PaperTradingAdapter extends TradingAdapter {
  private isConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private orderbooks: Map<string, { bids: any[], asks: any[] }> = new Map();
  
  private conditionTokens: Map<string, {yesTokenId: string, noTokenId: string}> = new Map();
  private tokenToCondition: Map<string, string> = new Map();
  private activeSubscriptions: Set<string> = new Set();
  
  private wsMarket?: WebSocket;
  private restingOrders: Map<string, PaperOrder[]> = new Map(); // tokenId -> PaperOrder[]

  async initialize(): Promise<void> {
    console.log('Initializing PaperTradingAdapter...');
    const db = getDb();

    // Ensure paper_balance exists
    const pb = db.prepare(`SELECT * FROM paper_balance WHERE id = 'main'`).get() as any;
    if (!pb) {
      db.prepare(`INSERT INTO paper_balance (id, balance, updatedAt) VALUES (?, ?, ?)`).run('main', '10000', Date.now());
    }

    // Load resting orders
    const rows = db.prepare(`SELECT * FROM orders WHERE status = 'PENDING'`).all() as any[];
    for (const row of rows) {
      const dbFills = db.prepare(`SELECT SUM(size) as filled FROM fills WHERE orderId = ?`).get(row.id) as any;
      const filled = dbFills?.filled ? parseFloat(dbFills.filled) : 0;
      const size = parseFloat(row.size);
      const remainingSize = Math.max(0, size - filled);
      
      if (remainingSize > 0) {
        const pOrder: PaperOrder = {
          id: row.id,
          tokenId: row.tokenId,
          side: row.side as Side,
          size: row.size,
          price: row.price,
          status: row.status as OrderStatus,
          timestamp: row.createdAt,
          remainingSize
        };
        
        let orders = this.restingOrders.get(row.tokenId);
        if (!orders) {
          orders = [];
          this.restingOrders.set(row.tokenId, orders);
        }
        orders.push(pOrder);
      } else {
        db.prepare(`UPDATE orders SET status = 'FILLED' WHERE id = ?`).run(row.id);
      }
    }

    this.connectWs();
    this.isConnected = true;
    console.log('PaperTradingAdapter Initialized.');
  }

  private connectWs() {
    this.wsMarket = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
    this.wsMarket.on('open', () => {
      console.log('Paper: Connected to WS Market channel');
      const allTokens: string[] = [];
      for (const conditionId of this.activeSubscriptions) {
        const tokens = this.conditionTokens.get(conditionId);
        if (tokens) {
          allTokens.push(tokens.yesTokenId, tokens.noTokenId);
        }
      }
      if (allTokens.length > 0) {
        this.wsMarket?.send(JSON.stringify({
          assets: allTokens,
          type: "market"
        }));
      }
    });
    
    this.wsMarket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (Array.isArray(msg)) {
          for (const item of msg) this.handleMarketMessage(item);
        } else {
          this.handleMarketMessage(msg);
        }
      } catch (err) {
        console.error('Paper: Error parsing WS Market msg:', err);
      }
    });

    this.wsMarket.on('error', (err) => console.error('Paper: WS Market Error:', err));
    this.wsMarket.on('close', () => {
      console.log('Paper: WS Market connection closed. Reconnecting...');
      setTimeout(() => {
        if (this.isConnected) this.connectWs();
      }, 5000);
    });
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down PaperTradingAdapter...');
    this.isConnected = false;
    if (this.wsMarket) {
      this.wsMarket.close();
      this.wsMarket = undefined;
    }
  }

  private handleMarketMessage(msg: any) {
    if (msg.event === 'market' || msg.event === 'book') {
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
      this.matchOrders(assetId);
    } else if (msg.event === 'price_change') {
      const assetId = msg.asset_id;
      if (!assetId) return;
      const conditionId = this.tokenToCondition.get(assetId);
      if (!conditionId) return;
      
      const ob = this.orderbooks.get(assetId) || { bids: [], asks: [] };
      if (msg.bids && Array.isArray(msg.bids)) ob.bids = msg.bids;
      if (msg.asks && Array.isArray(msg.asks)) ob.asks = msg.asks;
      this.orderbooks.set(assetId, ob);
      
      this.updateMarketStateFromOrderbooks(conditionId);
      this.matchOrders(assetId);
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

  private matchOrders(tokenId: string) {
    const orders = this.restingOrders.get(tokenId);
    if (!orders || orders.length === 0) return;
    
    const ob = this.orderbooks.get(tokenId);
    if (!ob) return;

    for (let i = orders.length - 1; i >= 0; i--) {
      const order = orders[i];
      const p = parseFloat(order.price);
      
      let matched = false;
      let fillPrice = 0;
      let fillSize = 0;

      // Note: A true FAK/FOK isn't fully implemented this way because resting orders are technically "Maker".
      // But for simulated taker matching, we match against the book.
      if (order.side === 'BUY') {
        // Buy matches if there's an ask <= order price
        for (const ask of ob.asks) {
          if (parseFloat(ask.price) <= p) {
            matched = true;
            fillPrice = parseFloat(ask.price);
            fillSize = Math.min(order.remainingSize, parseFloat(ask.size));
            break; // Just taking the best single level for simplicity in this paper engine
          }
        }
      } else {
        // Sell matches if there's a bid >= order price
        for (const bid of ob.bids) {
          if (parseFloat(bid.price) >= p) {
            matched = true;
            fillPrice = parseFloat(bid.price);
            fillSize = Math.min(order.remainingSize, parseFloat(bid.size));
            break;
          }
        }
      }

      if (matched && fillSize > 0) {
        order.remainingSize -= fillSize;
        this.executeFill(order, fillSize, fillPrice);
        
        if (order.remainingSize <= 0.000001) { // Floating point tolerance
          order.status = 'FILLED';
          orders.splice(i, 1);
          const db = getDb();
          db.prepare(`UPDATE orders SET status = 'FILLED' WHERE id = ?`).run(order.id);
        }
      }
    }
  }

  private executeFill(order: PaperOrder, fillSize: number, fillPrice: number) {
    const db = getDb();
    const fillId = `fill_${Date.now()}_${Math.random()}`;
    const fee = '0';
    const createdAt = Date.now();

    db.prepare(`INSERT INTO fills (id, orderId, tokenId, side, price, size, fee, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fillId, order.id, order.tokenId, order.side, String(fillPrice), String(fillSize), fee, createdAt);

    // Update position
    const existingPos = db.prepare(`SELECT * FROM positions WHERE tokenId = ?`).get(order.tokenId) as any;
    
    if (existingPos) {
      let netSize = parseFloat(existingPos.netSize);
      let avgPrice = parseFloat(existingPos.avgPrice);
      
      if (order.side === 'BUY') {
        const totalCost = (netSize * avgPrice) + (fillSize * fillPrice);
        netSize += fillSize;
        avgPrice = netSize > 0 ? totalCost / netSize : 0;
      } else {
        netSize -= fillSize;
        if (netSize === 0) avgPrice = 0;
      }
      
      db.prepare(`UPDATE positions SET netSize = ?, avgPrice = ?, updatedAt = ? WHERE tokenId = ?`)
        .run(String(netSize), String(avgPrice), createdAt, order.tokenId);
    } else {
      const netSize = order.side === 'BUY' ? fillSize : -fillSize;
      const avgPrice = fillPrice;
      db.prepare(`INSERT INTO positions (tokenId, netSize, avgPrice, updatedAt) VALUES (?, ?, ?, ?)`)
        .run(order.tokenId, String(netSize), String(avgPrice), createdAt);
    }

    // Deduct balance for BUYS, add balance for SELLS
    const pb = db.prepare(`SELECT * FROM paper_balance WHERE id = 'main'`).get() as any;
    if (pb) {
      let balance = parseFloat(pb.balance);
      const costOrGain = fillSize * fillPrice;
      if (order.side === 'BUY') {
        balance -= costOrGain;
      } else {
        balance += costOrGain; // In Polymarket you also get 1 USDC per share if resolving YES, but for now we just add the sell value. Wait, selling gives you the fillPrice.
      }
      db.prepare(`UPDATE paper_balance SET balance = ?, updatedAt = ? WHERE id = 'main'`).run(String(balance), Date.now());
    }
    
    console.log(`Paper Fill: ${order.side} ${fillSize} @ ${fillPrice} for ${order.id}`);
  }

  async placeOrder(tokenId: string, side: Side, size: string, price: string, orderType?: 'GTC' | 'FAK' | 'FOK'): Promise<Order> {
    if (!this.isConnected) throw new Error('Adapter not connected');
    
    const parsedPrice = parseFloat(price);
    if (parsedPrice <= 0 || parsedPrice >= 1) throw new Error("Invalid price");

    let finalSize = size;
    let sharesSize = parseFloat(size);

    if (side === 'BUY') {
      // Input size is USD. Calculate shares: shares = USD / price
      // Round down to avoid exceeding available balance by fractional cents
      sharesSize = Math.floor(sharesSize / parsedPrice);
      finalSize = sharesSize.toString();
    }

    const id = `0x${Date.now().toString(16)}`;
    const order: PaperOrder = {
      id,
      tokenId,
      side,
      size: finalSize,
      price,
      status: 'PENDING',
      timestamp: Date.now(),
      remainingSize: sharesSize
    };

    const db = getDb();
    db.prepare(`INSERT INTO orders (id, tokenId, side, size, price, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, tokenId, side, finalSize, price, 'PENDING', order.timestamp);

    // If it's FOK or FAK, we should try matching immediately, but we will just add it to resting orders and call matchOrders
    let orders = this.restingOrders.get(tokenId);
    if (!orders) {
      orders = [];
      this.restingOrders.set(tokenId, orders);
    }
    orders.push(order);
    
    this.matchOrders(tokenId);

    return {
      id: order.id,
      tokenId: order.tokenId,
      side: order.side,
      size: order.size,
      price: order.price,
      status: order.status,
      timestamp: order.timestamp,
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.isConnected) throw new Error('Adapter not connected');
    
    for (const [tokenId, orders] of this.restingOrders.entries()) {
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx !== -1) {
        orders.splice(idx, 1);
        const db = getDb();
        db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE id = ?`).run(orderId);
        console.log(`Paper: Cancelled order ${orderId}`);
        return true;
      }
    }
    return false;
  }

  async getMarketState(conditionId: string): Promise<any> {
    const state = this.marketCache.get(conditionId);
    if (!state) return null;
    if (Date.now() - state.lastUpdated > 10000) {
      return { ...state, stale: true };
    }
    return state;
  }

  subscribeToMarket(conditionId: string, yesTokenId: string, noTokenId: string): void {
    if (!this.activeSubscriptions.has(conditionId)) {
      this.activeSubscriptions.add(conditionId);
      this.conditionTokens.set(conditionId, { yesTokenId, noTokenId });
      this.tokenToCondition.set(yesTokenId, conditionId);
      this.tokenToCondition.set(noTokenId, conditionId);
      
      if (this.wsMarket?.readyState === WebSocket.OPEN) {
         this.wsMarket.send(JSON.stringify({
            assets: [yesTokenId, noTokenId],
            type: "market"
         }));
      }
    }
  }

  updateMarketDiscovery(market: MarketState): void {
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

  async getBalance(): Promise<number> {
    const db = getDb();
    const pb = db.prepare(`SELECT * FROM paper_balance WHERE id = 'main'`).get() as any;
    if (pb) {
      return parseFloat(pb.balance);
    }
    return 10000;
  }
}
