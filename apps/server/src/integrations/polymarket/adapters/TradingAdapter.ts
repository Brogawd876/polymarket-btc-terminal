import { Order, MarketState, Side, AccountState } from '@polymarket-btc/shared';

export abstract class TradingAdapter {
  abstract initialize(): Promise<void>;
  abstract shutdown(): Promise<void>;
  abstract getIsConnected(): boolean;
  abstract getUserStreamConnected(): boolean;
  abstract getLastReconciliationTime(): number;
  abstract placeOrder(tokenId: string, side: Side, size: string, price: string, orderType?: 'GTC'): Promise<Order>;
  abstract placeMarketOrder(tokenId: string, side: Side, amount: string, slippageBps?: number): Promise<Order>;
  abstract cancelOrder(orderId: string): Promise<boolean>;
  abstract cancelAll(): Promise<boolean>;
  abstract getMarketState(conditionId: string): Promise<any>;
  abstract subscribeToMarket(conditionId: string, upTokenId: string, downTokenId: string): void;
  abstract updateMarketDiscovery(market: MarketState): void;
  abstract getBalance(): Promise<number>;
  abstract getTokenBalance(tokenId: string): Promise<number>;
  abstract getAccountState(): Promise<AccountState>;
}
