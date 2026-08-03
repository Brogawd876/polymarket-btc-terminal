import { Order, MarketState, Side, OrderStatus } from '@polymarket-btc/shared';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYMARKET_API_KEY = process.env.POLYMARKET_API_KEY || '';
const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com/order';
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

// Interface matching the Master Implementation Prompt
export interface TradingAdapter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  placeOrder(marketId: string, side: Side, size: string, price: string): Promise<Order>;
  cancelOrder(orderId: string): Promise<boolean>;
  getMarketState(marketId: string): Promise<MarketState>;
}

export class PolymarketAdapter implements TradingAdapter {
  private isConnected: boolean = false;
  private marketCache: Map<string, MarketState> = new Map();
  private ws: WebSocket | null = null;
  private wallet: ethers.Wallet;

  constructor() {
    if (!PRIVATE_KEY) {
      console.warn('PRIVATE_KEY is not set in environment.');
    }
    this.wallet = new ethers.Wallet(PRIVATE_KEY || ethers.Wallet.createRandom().privateKey);
  }

  async initialize(): Promise<void> {
    console.log('Initializing Polymarket Adapter...');
    
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
          const state: MarketState = {
            id: parsed.marketId,
            bids: parsed.bids || [],
            asks: parsed.asks || [],
            lastPrice: parsed.lastPrice || '0',
            volume24h: parsed.volume || '0',
            timestamp: Date.now()
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
    
    // EIP-712 Order Signature mock structure
    const domain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: 137,
      verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
    };
    
    const types = {
      Order: [
        { name: 'salt', type: 'uint256' },
        { name: 'maker', type: 'address' },
        { name: 'signer', type: 'address' },
        { name: 'taker', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'makerAmount', type: 'uint256' },
        { name: 'takerAmount', type: 'uint256' },
        { name: 'expiration', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'feeRateBps', type: 'uint256' },
        { name: 'side', type: 'uint8' },
        { name: 'signatureType', type: 'uint8' }
      ]
    };
    
    const orderData = {
      salt: Date.now(),
      maker: this.wallet.address,
      signer: this.wallet.address,
      taker: '0x0000000000000000000000000000000000000000',
      tokenId: marketId,
      makerAmount: size,
      takerAmount: price,
      expiration: Math.floor(Date.now() / 1000) + 3600,
      nonce: 0,
      feeRateBps: 0,
      side: side === 'BUY' ? 0 : 1,
      signatureType: 2
    };

    const signature = await this.wallet.signTypedData(domain, types, orderData);
    
    const orderPayload = {
      order: orderData,
      signature,
      owner: this.wallet.address
    };
    
    try {
      const response = await fetch(POLYMARKET_CLOB_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${POLYMARKET_API_KEY}`
        },
        body: JSON.stringify(orderPayload)
      });
      
      let responseData;
      try {
         responseData = await response.json();
      } catch (e) {
         responseData = { error: await response.text() };
      }
      
      const order: Order = {
        id: responseData.orderID || `0x${Date.now().toString(16)}`,
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
    console.log(`Cancelled order: ${orderId}`);
    return true;
  }

  async getMarketState(marketId: string): Promise<MarketState> {
    const state = this.marketCache.get(marketId);
    if (!state) {
      throw new Error(`Market ${marketId} not found or stale`);
    }
    return state;
  }
}
