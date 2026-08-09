import React, { useState, useEffect } from 'react';
import type { 
  MarketState, 
  Side, 
  Order, 
  PresetConfig, 
  LiveReadiness, 
  OperationalState, 
  Position, 
  Outcome 
} from '@polymarket-btc/shared';
import { ShieldCheck, ShieldAlert, AlertTriangle, Play, Square } from 'lucide-react';

interface Props {
  operationalState: OperationalState;
  readiness: LiveReadiness | null;
  marketInfo: MarketState | null;
  discoveredMarkets?: MarketState[];
  sendMessage: (msg: any) => void;
  orders?: Order[];
  positions?: Position[];
  presets?: PresetConfig[];
  rtdsMetrics?: any;
  balance?: number;
}

const DEFAULT_PRESETS: PresetConfig[] = [
  { id: 'buy-1', name: 'Match Ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: 0, active: true, clampMode: 'CLAMP' },
  { id: 'buy-2', name: '1c under ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: -0.01, active: true, clampMode: 'CLAMP' },
  { id: 'buy-3', name: '15% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -15, active: true, clampMode: 'CLAMP' },
  { id: 'buy-4', name: '20% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -20, active: true, clampMode: 'CLAMP' },
  { id: 'buy-5', name: '50% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -50, active: true, clampMode: 'CLAMP' },

  { id: 'sell-1', name: 'Match Bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0, active: true, clampMode: 'CLAMP' },
  { id: 'sell-2', name: '1c over bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0.01, active: true, clampMode: 'CLAMP' },
  { id: 'sell-3', name: '15% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 15, active: true, clampMode: 'CLAMP' },
  { id: 'sell-4', name: '20% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 20, active: true, clampMode: 'CLAMP' },
  { id: 'sell-5', name: '50% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 50, active: true, clampMode: 'CLAMP' },
];

const TradingPanel: React.FC<Props> = ({ 
  operationalState,
  readiness,
  marketInfo, 
  discoveredMarkets = [], 
  sendMessage, 
  orders = [], 
  positions = [],
  presets = DEFAULT_PRESETS, 
  rtdsMetrics, 
  balance = 0 
}) => {
  const [buyUsdSpend, setBuyUsdSpend] = useState<string>('25');
  const [sellShares, setSellShares] = useState<string>('');
  const [activeOutcome, setActiveOutcome] = useState<Outcome>('UP');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [countdown, setCountdown] = useState<string>('');

  const activeTokenId = marketInfo 
    ? (activeOutcome === 'UP' ? (marketInfo.upTokenId || marketInfo.yesTokenId) : (marketInfo.downTokenId || marketInfo.noTokenId))
    : '';

  const activePosition = positions.find(p => p.tokenId === activeTokenId);
  const availableShares = activePosition ? parseFloat(activePosition.netSize || activePosition.netShares || '0') : 0;
  const walletBalance = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  const maxBuySpend = walletBalance.toFixed(2);
  const buySpendNum = parseFloat(buyUsdSpend) || 0;
  const hasEnoughBalance = walletBalance > 0 && buySpendNum > 0 && buySpendNum <= walletBalance;
  const minimumOrderSize = parseFloat(marketInfo?.minimumOrderSize || '0') || 0;

  useEffect(() => {
    if (!marketInfo?.targetTime) return;
    const interval = setInterval(() => {
      const diff = marketInfo.targetTime! - Date.now();
      if (diff > 0) {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdown(`${m}m ${s}s`);
      } else {
        setCountdown('RESOLVED / SWITCHING');
      }
    }, 100);
    return () => clearInterval(interval);
  }, [marketInfo]);

  useEffect(() => {
    setIsSubmitting(false);
  }, [orders]);

  useEffect(() => {
    if (walletBalance <= 0) return;
    const selectedSpend = parseFloat(buyUsdSpend);
    if (Number.isFinite(selectedSpend) && selectedSpend > walletBalance) {
      setBuyUsdSpend(maxBuySpend);
    }
  }, [buyUsdSpend, maxBuySpend, walletBalance]);

  const handleArmLive = () => {
    sendMessage({ type: 'ARM_LIVE', payload: { durationSeconds: 300 } });
  };

  const handleDisarmLive = () => {
    sendMessage({ type: 'DISARM_LIVE' });
  };

  const handlePlaceOrder = (side: Side, capturedPrice: string, capturedSize: string, capturedUsd?: string) => {
    if (!activeTokenId) return;
    setError('');
    setIsSubmitting(true);
    sendMessage({
      type: 'PLACE_ORDER',
      id: crypto.randomUUID(),
      payload: {
        tokenId: activeTokenId,
        outcome: activeOutcome,
        side,
        dollarSpend: capturedUsd,
        size: capturedSize,
        price: capturedPrice,
        orderType: 'GTC'
      }
    });
  };

  const calculatePresetPrice = (preset: PresetConfig): string | null => {
    if (!marketInfo) return null;
    const isUp = activeOutcome === 'UP';
    const bidStr = isUp ? (marketInfo.upBid || marketInfo.yesBid) : (marketInfo.downBid || marketInfo.noBid);
    const askStr = isUp ? (marketInfo.upAsk || marketInfo.yesAsk) : (marketInfo.downAsk || marketInfo.noAsk);
    const priceStr = isUp ? (marketInfo.upPrice || marketInfo.yesPrice) : (marketInfo.downPrice || marketInfo.noPrice);

    let refPrice = parseFloat(priceStr || '0.50');
    if (preset.reference === 'BEST_BID' && bidStr) refPrice = parseFloat(bidStr);
    if (preset.reference === 'BEST_ASK' && askStr) refPrice = parseFloat(askStr);
    if (preset.reference === 'MIDPOINT') {
      const b = parseFloat(bidStr || priceStr || '0.50');
      const a = parseFloat(askStr || priceStr || '0.50');
      refPrice = (b + a) / 2;
    }

    if (refPrice <= 0) return null;

    let targetPrice = refPrice;
    if (preset.mode === 'CENT_OFFSET') {
      targetPrice = refPrice + preset.value;
    } else if (preset.mode === 'PERCENT_OFFSET') {
      targetPrice = refPrice * (1 + (preset.value / 100));
    } else if (preset.mode === 'ABSOLUTE_PRICE') {
      targetPrice = preset.value;
    }

    const ask = parseFloat(askStr || '0.99');
    const bid = parseFloat(bidStr || '0.01');

    if (preset.side === 'BUY') {
      const maxMakerBuy = Math.max(0.01, ask - 0.01);
      if (targetPrice > maxMakerBuy) targetPrice = maxMakerBuy;
    } else {
      const minMakerSell = Math.min(0.99, bid + 0.01);
      if (targetPrice < minMakerSell) targetPrice = minMakerSell;
    }

    targetPrice = Math.round(targetPrice * 100) / 100;
    if (targetPrice < 0.01 || targetPrice > 0.99) return null;

    return targetPrice.toFixed(2);
  };

  const isExecutionBlocked: boolean = !readiness || (readiness.blockingReasons && readiness.blockingReasons.length > 0) || !readiness.liveArmed;

  return (
    <div className="flex flex-col gap-3 font-sans text-xs">
      {/* Operational State & Arming Header */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${
              operationalState === 'LIVE_ARMED' ? 'bg-green-500 animate-pulse' :
              operationalState === 'LIVE_DISARMED' ? 'bg-yellow-500' :
              operationalState === 'READ_ONLY' ? 'bg-blue-500' : 'bg-red-500'
            }`} />
            <span className="font-bold tracking-wider text-gray-200 uppercase">{operationalState}</span>
          </div>

          {readiness?.liveArmed ? (
            <button 
              onClick={handleDisarmLive}
              className="flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white text-[10px] px-2 py-1 rounded font-bold uppercase"
            >
              <Square size={12} /> Disarm
            </button>
          ) : (
            <button 
              onClick={handleArmLive}
              disabled={Boolean(readiness && readiness.blockingReasons.filter(r => r !== 'LIVE EXECUTION DISARMED').length > 0)}
              className="flex items-center gap-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider"
            >
              <Play size={12} /> HOLD TO ARM LIVE
            </button>
          )}
        </div>

        {/* Blocking reasons banner */}
        {readiness && readiness.blockingReasons.length > 0 && (
          <div className="bg-red-950/80 border border-red-800 p-1.5 rounded text-[10px] text-red-300 font-mono flex flex-col gap-0.5">
            {readiness.blockingReasons.map((reason, idx) => (
              <div key={idx} className="flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discovered Markets Selector */}
      {discoveredMarkets.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {discoveredMarkets.map(m => (
            <button
              key={m.marketId}
              onClick={() => {
                sendMessage({
                  type: 'SUBSCRIBE_MARKET',
                  payload: {
                    conditionId: m.conditionId,
                    yesTokenId: m.upTokenId || m.yesTokenId,
                    noTokenId: m.downTokenId || m.noTokenId,
                    upTokenId: m.upTokenId || m.yesTokenId,
                    downTokenId: m.downTokenId || m.noTokenId,
                  }
                });
              }}
              className={`px-2 py-1 rounded text-[10px] border font-mono whitespace-nowrap ${
                marketInfo?.marketId === m.marketId 
                  ? 'bg-blue-900 border-blue-500 text-white font-bold' 
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {m.type === 'CURRENT' && <span className="text-green-400 font-bold mr-1">•</span>}
              {m.type === 'NEXT' && <span className="text-yellow-400 font-bold mr-1">•</span>}
              {m.title ? m.title.substring(0, 18) : m.marketId.substring(0, 8)}
            </button>
          ))}
        </div>
      )}

      {/* Chainlink Reference & Price Anchor Card */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-1.5 font-mono text-[11px]">
        <div className="flex justify-between items-center text-gray-400 text-[10px]">
          <span>BTC/USD CHAINLINK REFERENCE</span>
          <span>AGE: {rtdsMetrics?.dataAgeMs ? (rtdsMetrics.dataAgeMs / 1000).toFixed(1) : '0.0'}s</span>
        </div>
        <div className="flex justify-between items-baseline">
          <div>
            <span className="text-gray-400 text-[10px] block">PRICE TO BEAT</span>
            <span className="text-sm font-bold text-yellow-400">
              {rtdsMetrics?.priceToBeat && parseFloat(rtdsMetrics.priceToBeat) > 0 
                ? `$${parseFloat(rtdsMetrics.priceToBeat).toLocaleString('en-US', { minimumFractionDigits: 2 })}` 
                : 'ANCHOR PENDING'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-gray-400 text-[10px] block">CHAINLINK LIVE</span>
            <span className="text-sm font-bold text-white">
              {rtdsMetrics?.currentPrice ? `$${rtdsMetrics.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'OFFLINE'}
            </span>
          </div>
        </div>
        {rtdsMetrics?.difference !== undefined && (
          <div className="flex justify-between items-center text-[10px] pt-1 border-t border-gray-700/60">
            <span className="text-gray-400">DIFF: {rtdsMetrics.difference >= 0 ? `+$${rtdsMetrics.difference.toFixed(2)}` : `-$${Math.abs(rtdsMetrics.difference).toFixed(2)}`}</span>
            <span className={`font-bold ${rtdsMetrics.leadingOutcome === 'UP' ? 'text-green-400' : rtdsMetrics.leadingOutcome === 'DOWN' ? 'text-red-400' : 'text-gray-400'}`}>
              LEADING: {rtdsMetrics.leadingOutcome || 'NONE'}
            </span>
          </div>
        )}
      </div>

      {/* Market Prices Overview */}
      {marketInfo && (
        <div className="bg-gray-800 p-2 rounded border border-gray-700 flex justify-between items-center text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-green-400 font-bold">UP</span>
            <span>BID: {marketInfo.upBid || marketInfo.yesBid || '0.00'}</span>
            <span>ASK: {marketInfo.upAsk || marketInfo.yesAsk || '0.00'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-bold">DOWN</span>
            <span>BID: {marketInfo.downBid || marketInfo.noBid || '0.00'}</span>
            <span>ASK: {marketInfo.downAsk || marketInfo.noAsk || '0.00'}</span>
          </div>
        </div>
      )}

      {/* Outcome Switcher */}
      <div className="flex gap-1.5">
        <button 
          onClick={() => setActiveOutcome('UP')}
          className={`flex-1 py-1.5 rounded font-bold text-xs border transition-colors ${
            activeOutcome === 'UP' ? 'bg-green-700 border-green-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
          }`}
        >
          UP OUTCOME
        </button>
        <button 
          onClick={() => setActiveOutcome('DOWN')}
          className={`flex-1 py-1.5 rounded font-bold text-xs border transition-colors ${
            activeOutcome === 'DOWN' ? 'bg-red-700 border-red-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
          }`}
        >
          DOWN OUTCOME
        </button>
      </div>

      {/* BUY Sizing Section */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex justify-between items-center text-[11px]">
          <span className="font-bold text-green-400 uppercase">BUY SIZING (USD)</span>
          <span className="text-gray-400 font-mono">BAL: ${balance.toFixed(2)}</span>
        </div>
        <div className="flex gap-1">
          {['10', '25', '50', '100'].map(usd => (
            <button
              key={usd}
              onClick={() => setBuyUsdSpend(usd)}
              disabled={parseFloat(usd) > walletBalance}
              className={`flex-1 py-1 rounded text-xs font-mono border ${
                buyUsdSpend === usd ? 'bg-green-800 border-green-500 text-white font-bold' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ${usd}
            </button>
          ))}
          <button
            onClick={() => setBuyUsdSpend(maxBuySpend)}
            disabled={walletBalance <= 0}
            className={`flex-1 py-1 rounded text-xs font-mono border ${
              buyUsdSpend === maxBuySpend ? 'bg-green-800 border-green-500 text-white font-bold' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            } disabled:opacity-40 disabled:hover:bg-gray-700`}
            title={`Use full available balance: $${maxBuySpend}`}
          >
            MAX
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400">Custom USD:</label>
          <input 
            type="number"
            value={buyUsdSpend}
            onChange={e => setBuyUsdSpend(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:border-blue-500"
            placeholder="Spend USD"
          />
        </div>
        {!hasEnoughBalance && buySpendNum > 0 && (
          <div className="text-[10px] text-yellow-300 font-mono">Spend must be between $0.01 and ${maxBuySpend}.</div>
        )}

        {/* Dynamic BUY Price Buttons */}
        <div className="text-[10px] text-gray-400 font-bold pt-1 border-t border-gray-700">BUY {activeOutcome} MAKER PRESETS</div>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.filter(p => p.side === 'BUY' && p.active).map(preset => {
            const price = calculatePresetPrice(preset);
            const priceNum = price ? parseFloat(price) : 0.5;
            const shares = priceNum > 0 ? (buySpendNum / priceNum).toFixed(1) : '0';
            const sharesNum = parseFloat(shares);
            const priceCents = price ? Math.round(parseFloat(price) * 100) : '-';
            const meetsMinimumSize = minimumOrderSize <= 0 || sharesNum >= minimumOrderSize;

            return (
              <button
                key={preset.id}
                onPointerDown={() => price && handlePlaceOrder('BUY', price, shares, buyUsdSpend)}
                disabled={isExecutionBlocked || !price || isSubmitting || !hasEnoughBalance || !meetsMinimumSize}
                className="bg-green-700 hover:bg-green-600 disabled:opacity-40 py-2 rounded text-center font-mono font-bold text-white border border-green-500/50 shadow flex flex-col items-center justify-center"
                title={`${preset.name} - Est Shares: ${shares}${!meetsMinimumSize ? `; minimum ${minimumOrderSize} shares` : ''}`}
              >
                <span className="text-sm">[{priceCents}¢]</span>
                <span className="text-[9px] text-green-200 font-normal">(${buyUsdSpend})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SELL Sizing Section */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex justify-between items-center text-[11px]">
          <span className="font-bold text-red-400 uppercase">SELL SIZING ({activeOutcome} POSITION)</span>
          <span className="text-gray-400 font-mono">HELD: {availableShares.toFixed(1)} SHARES</span>
        </div>
        <div className="flex gap-1">
          {['25', '50', '100'].map(pct => (
            <button
              key={pct}
              onClick={() => {
                const calculated = (availableShares * (parseFloat(pct) / 100)).toFixed(1);
                setSellShares(calculated);
              }}
              disabled={availableShares <= 0}
              className="flex-1 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded text-xs font-mono text-gray-300"
            >
              {pct}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400">Custom Shares:</label>
          <input 
            type="number"
            value={sellShares}
            onChange={e => setSellShares(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:border-blue-500"
            placeholder="Shares to sell"
          />
        </div>

        {/* Dynamic SELL Price Buttons */}
        <div className="text-[10px] text-gray-400 font-bold pt-1 border-t border-gray-700">SELL {activeOutcome} MAKER PRESETS</div>
        <div className="grid grid-cols-3 gap-1.5">
          {presets.filter(p => p.side === 'SELL' && p.active).map(preset => {
            const price = calculatePresetPrice(preset);
            const sharesToSell = sellShares || availableShares.toFixed(1);
            const sharesToSellNum = parseFloat(sharesToSell) || 0;
            const priceCents = price ? Math.round(parseFloat(price) * 100) : '-';
            const sellSizeValid = sharesToSellNum > 0 && sharesToSellNum <= availableShares && (minimumOrderSize <= 0 || sharesToSellNum >= minimumOrderSize);

            return (
              <button
                key={preset.id}
                onPointerDown={() => price && sellSizeValid && handlePlaceOrder('SELL', price, sharesToSell)}
                disabled={isExecutionBlocked || !price || !sellSizeValid || isSubmitting}
                className="bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2 rounded text-center font-mono font-bold text-white border border-red-500/50 shadow flex flex-col items-center justify-center"
                title={`${preset.name} - Shares: ${sharesToSell}${sharesToSellNum > availableShares ? '; exceeds held shares' : ''}${minimumOrderSize > 0 && sharesToSellNum < minimumOrderSize ? `; minimum ${minimumOrderSize} shares` : ''}`}
              >
                <span className="text-sm">[{priceCents}¢]</span>
                <span className="text-[9px] text-red-200 font-normal">({sharesToSell} sh)</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/80 border border-red-500 text-red-200 p-2 rounded text-xs font-mono">
          {error}
        </div>
      )}
    </div>
  );
};

export default TradingPanel;
