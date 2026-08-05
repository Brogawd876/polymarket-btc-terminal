import { TradingAdapter } from './TradingAdapter';
import { PaperTradingAdapter } from './PaperTradingAdapter';
import { OfficialSdkTradingAdapter } from './OfficialSdkTradingAdapter';
import { RawTradingAdapter } from './RawTradingAdapter';

export function createTradingAdapter(): TradingAdapter {
  const mode = process.env.TRADING_MODE;
  const isLive = process.env.ENABLE_LIVE_TRADING === 'true';

  if (!isLive || mode === 'paper') {
    return new PaperTradingAdapter();
  }
  
  if (mode === 'raw') {
    return new RawTradingAdapter();
  }
  
  // Automatically use sdk if ENABLE_LIVE_TRADING is true and not explicitly overridden
  return new OfficialSdkTradingAdapter();
}
