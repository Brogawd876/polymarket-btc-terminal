import { OfficialSdkTradingAdapter } from './OfficialSdkTradingAdapter';
import { TradingAdapter } from './TradingAdapter';

export { OfficialSdkTradingAdapter, TradingAdapter };

export function createTradingAdapter(): TradingAdapter {
  return new OfficialSdkTradingAdapter();
}
