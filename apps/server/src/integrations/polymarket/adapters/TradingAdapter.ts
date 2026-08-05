import { Order, MarketState, Side } from '@polymarket-btc/shared';

export abstract class TradingAdapter {
  abstract initialize(): Promise<void>;
  abstract shutdown(): Promise<void>;
  abstract placeOrder(tokenId: string, side: Side, size: string, price: string, orderType?: 'GTC' | 'FAK' | 'FOK'): Promise<Order>;
  abstract cancelOrder(orderId: string): Promise<boolean>;
  abstract getMarketState(conditionId: string): Promise<any>;
  abstract subscribeToMarket(conditionId: string, yesTokenId: string, noTokenId: string): void;
  abstract updateMarketDiscovery(market: MarketState): void;
  abstract getBalance(): Promise<number>;
}
