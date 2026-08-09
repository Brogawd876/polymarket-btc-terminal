import { Order, MarketState, Side, AccountState } from '@polymarket-btc/shared';
import { TradingAdapter } from './TradingAdapter';

export class RawTradingAdapter extends TradingAdapter {
  async initialize(): Promise<void> {
    console.log('Initializing RawTradingAdapter (Stub)');
  }
  async shutdown(): Promise<void> {}
  getIsConnected(): boolean { return false; }
  getUserStreamConnected(): boolean { return false; }
  getLastReconciliationTime(): number { return 0; }
  async placeOrder(tokenId: string, side: Side, size: string, price: string): Promise<Order> {
    throw new Error('RawTradingAdapter.placeOrder not implemented');
  }
  async placeMarketOrder(tokenId: string, side: Side, amount: string, slippageBps?: number): Promise<Order> {
    throw new Error('RawTradingAdapter.placeMarketOrder not implemented');
  }
  async cancelOrder(orderId: string): Promise<boolean> {
    throw new Error('RawTradingAdapter.cancelOrder not implemented');
  }
  async cancelAll(): Promise<boolean> {
    return true;
  }
  async getMarketState(conditionId: string): Promise<any> {
    return null;
  }
  subscribeToMarket(conditionId: string, upTokenId: string, downTokenId: string): void {}
  updateMarketDiscovery(market: MarketState): void {}
  async getBalance(): Promise<number> {
    return 0;
  }
  async getAccountState(): Promise<AccountState> {
    return {
      collateralBalance: 0,
      allowanceValid: false,
      authenticated: false,
      userStreamConnected: false,
    };
  }
}
