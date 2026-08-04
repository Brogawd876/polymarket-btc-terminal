import { Order, MarketState, Side, OrderStatus } from '@polymarket-btc/shared';
import { ethers } from 'ethers';

import { ClobClient, Side as ClobSide } from '@polymarket/clob-client-v2';

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYMARKET_API_KEY = process.env.POLYMARKET_API_KEY || process.env.BUILDER_KEY || '';
const POLY_SIGNATURE_TYPE = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
const POLY_FUNDER_ADDRESS = process.env.POLY_FUNDER_ADDRESS;

import crypto from 'crypto';
import WebSocket from 'ws';
import { getDb } from '../../db/index.js';

// Interface matching the Master Implementation Prompt
export interface TradingAdapter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  placeOrder(tokenId: string, side: Side, size: string, price: string): Promise<Order>;
  cancelOrder(orderId: string): Promise<boolean>;
  getMarketState(conditionId: string): Promise<any>;
  subscribeToMarket(conditionId: string, yesTokenId: string, noTokenId: string): void;
  getBalance(): Promise<number>;
}

export class PolymarketAdapter implements TradingAdapter {
  private isConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private activeSubscriptions: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private wallet: ethers.Wallet;
  private clobClient!: ClobClient;
  private wsUser?: WebSocket;

  // Track token IDs for each condition
  private conditionTokens: Map<string, {yesTokenId: string, noTokenId: string}> = new Map();

  constructor() {
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY is not set in environment. Fatal initialization error.');
    }
    this.wallet = new ethers.Wallet(PRIVATE_KEY);
    delete process.env.PRIVATE_KEY;
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
                   if (item.event === 'fill') {
                       this.handleFill(item);
                   }
               }
           } else if (msg.event === 'fill') {
               this.handleFill(msg);
           }
       } catch (err) {
           console.error('Error parsing WS User msg:', err);
       }
    });

    this.startPolling();

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
    this.activeSubscriptions.add(conditionId);
    this.conditionTokens.set(conditionId, { yesTokenId, noTokenId });
    // Fetch immediately
    this.fetchMarketPrice(conditionId, yesTokenId, noTokenId);
  }

  private startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    // Poll every 3 seconds
    this.pollInterval = setInterval(() => {
      for (const conditionId of this.activeSubscriptions) {
        const tokens = this.conditionTokens.get(conditionId);
        if (tokens) {
          this.fetchMarketPrice(conditionId, tokens.yesTokenId, tokens.noTokenId);
        }
      }
    }, 3000);
  }

  private async fetchMarketPrice(conditionId: string, yesTokenId: string, noTokenId: string) {
    try {
      // Using CLOB API midpoint endpoint
      const resYes = await fetch(`https://clob.polymarket.com/midpoint?token_id=${yesTokenId}`);
      const resNo = await fetch(`https://clob.polymarket.com/midpoint?token_id=${noTokenId}`);
      
      const yesPriceData = await resYes.json().catch(() => ({ mid: '0' }));
      const noPriceData = await resNo.json().catch(() => ({ mid: '0' }));

      const yesPrice = yesPriceData.mid ? String(yesPriceData.mid) : '0';
      const noPrice = noPriceData.mid ? String(noPriceData.mid) : '0';

      const state: MarketState = {
        marketId: conditionId, // Using conditionId as marketId
        conditionId,
        yesTokenId,
        noTokenId,
        yesPrice,
        noPrice,
        status: 'OPEN',
        lastUpdated: Date.now()
      };
      
      this.marketCache.set(conditionId, state);
    } catch (err) {
      console.error(`Failed to fetch price for condition ${conditionId}:`, err);
    }
  }

  async placeOrder(tokenId: string, side: Side, size: string, price: string): Promise<Order> {
    if (!this.isConnected) throw new Error('Adapter not connected');
    
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
      const response = await this.clobClient.postOrder(signedOrder);
      
      if ((response as any).errorMsg) {
         throw new Error(`Polymarket API error: ${(response as any).errorMsg}`);
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
    } catch (error) {
      console.error('Error placing order:', error);
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.isConnected) throw new Error('Adapter not connected');
    await this.clobClient.cancelOrder({ orderID: orderId }); 
    console.log(`Cancelled order: ${orderId}`);
    return true;
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
    try {
      // Polygon USDC.e contract
      const usdcAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
      const contract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint256)'], provider);
      const bal = await contract.balanceOf(this.wallet.address);
      return parseFloat(ethers.utils.formatUnits(bal, 6));
    } catch (e) {
      console.error('Failed to fetch balance', e);
      return 0;
    }
  }
}
