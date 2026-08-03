import { Order, MarketState, Side, OrderStatus } from '@polymarket-btc/shared';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import * as dotenv from 'dotenv';
import { ClobClient, Side as ClobSide } from '@polymarket/clob-client';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYMARKET_API_KEY = process.env.POLYMARKET_API_KEY || process.env.BUILDER_KEY || '';
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

// Interface matching the Master Implementation Prompt
export interface TradingAdapter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  placeOrder(marketId: string, side: Side, size: string, price: string): Promise<Order>;
  cancelOrder(orderId: string): Promise<boolean>;
  getMarketState(marketId: string): Promise<any>;
}

export class PolymarketAdapter implements TradingAdapter {
  private isConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private ws: WebSocket | null = null;
  private wallet: ethers.Wallet;
  private clobClient!: ClobClient;

  constructor() {
    if (!PRIVATE_KEY) {
      console.warn('PRIVATE_KEY is not set in environment.');
    }
    this.wallet = new ethers.Wallet(PRIVATE_KEY || ethers.Wallet.createRandom().privateKey);
    delete process.env.PRIVATE_KEY;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Polymarket Adapter...');
    
    this.clobClient = new ClobClient(
      'https://clob.polymarket.com', 
      137, 
      this.wallet
    );
    const creds = await this.clobClient.createOrDeriveApiKey();
    this.clobClient = new ClobClient(
      'https://clob.polymarket.com', 
      137, 
      this.wallet,
      creds
    );
    
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    
    this.ws = new WebSocket(WS_URL);
    
    this.ws.on('open', () => {
      console.log('WebSocket connected to Polymarket');
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'subscribe', channel: 'market' }));
      }
    });
    
    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.marketId) {
          const lastPriceNum = parsed.lastPrice ? parseFloat(parsed.lastPrice) : 0;
          const state: MarketState = {
            marketId: parsed.marketId,
            yesPrice: parsed.lastPrice || '0',
            noPrice: lastPriceNum ? (1 - lastPriceNum).toFixed(2) : '0',
            status: 'OPEN',
            lastUpdated: Date.now()
          };
          this.marketCache.set(parsed.marketId, state);
        }
      } catch (err) {
        // Ignore parse errors
      }
    });

    this.ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    this.ws.on('close', () => {
      console.log('WebSocket closed, attempting to reconnect...');
      setTimeout(() => this.initialize(), 3000);
    });

    this.isConnected = true;
    console.log('Polymarket Adapter Initialized.');
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down Polymarket Adapter...');
    this.isConnected = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  async placeOrder(marketId: string, side: Side, size: string, price: string): Promise<Order> {
    if (!this.isConnected) throw new Error('Adapter not connected');
    
    const orderArgs = {
      tokenID: marketId,
      price: Number(parseFloat(String(price)).toFixed(2)),
      side: side === 'BUY' ? ClobSide.BUY : ClobSide.SELL,
      size: Number(parseFloat(String(size)).toFixed(2)),
      feeRateBps: 0,
      nonce: 0
    };

    try {
      const signedOrder = await this.clobClient.createOrder(orderArgs);
      const response = await this.clobClient.postOrder(signedOrder);
      
      if (response.error) {
         throw new Error(`Polymarket API error: ${response.error}`);
      }
      
      const order: Order = {
        id: response.orderID || `0x${Date.now().toString(16)}`,
        marketId,
        side,
        size,
        price,
        status: 'PENDING',
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

  async getMarketState(marketId: string): Promise<any> {
    const state = this.marketCache.get(marketId);
    if (!state) return null;
    // 10 second staleness guard
    if (Date.now() - state.lastUpdated > 10000) {
      console.warn(`Market ${marketId} data is stale (>10s old)`);
      return { ...state, stale: true };
    }
    return state;
  }
}
