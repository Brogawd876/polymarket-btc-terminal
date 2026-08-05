import { Order, MarketState, Side } from '@polymarket-btc/shared';
import { TradingAdapter } from './TradingAdapter';

export class RawTradingAdapter extends TradingAdapter {
  async initialize(): Promise<void> {
    console.log('Initializing RawTradingAdapter (Stub)');
  }
  async shutdown(): Promise<void> {}
  async placeOrder(tokenId: string, side: Side, size: string, price: string, orderType?: 'GTC' | 'FAK' | 'FOK'): Promise<Order> {
    throw new Error('RawTradingAdapter.placeOrder not implemented');
  }
  async cancelOrder(orderId: string): Promise<boolean> {
    throw new Error('RawTradingAdapter.cancelOrder not implemented');
  }
  async getMarketState(conditionId: string): Promise<any> {
    return null;
  }
  subscribeToMarket(conditionId: string, yesTokenId: string, noTokenId: string): void {}
  updateMarketDiscovery(market: MarketState): void {}
  async getBalance(): Promise<number> {
    return 0;
  }
}
