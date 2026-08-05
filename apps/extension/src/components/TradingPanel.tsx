import React, { useState, useEffect } from 'react';
import type { MarketState, Side, Order, PresetConfig } from '@polymarket-btc/shared';
import { Loader2 } from 'lucide-react';

interface Props {
  marketInfo: MarketState | null;
  discoveredMarkets?: MarketState[];
  sendMessage: (msg: any) => void;
  orders?: Order[];
  rtdsMetrics?: any;
  balance?: number;
}

const TradingPanel: React.FC<Props> = ({ marketInfo, discoveredMarkets = [], sendMessage, orders = [], rtdsMetrics, balance = 0 }) => {
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('0.50');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dataAge, setDataAge] = useState<number>(0);
  const [countdown, setCountdown] = useState<string>('');
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [activeSide, setActiveSide] = useState<'YES'|'NO'>('YES');
  const [autoSizeFromBalance, setAutoSizeFromBalance] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3001/api/v1/presets')
      .then(r => r.json())
      .then(data => setPresets(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!marketInfo?.lastUpdated) return;
    const interval = setInterval(() => {
      setDataAge(Date.now() - marketInfo.lastUpdated);
      if (marketInfo.targetTime) {
        const diff = marketInfo.targetTime - Date.now();
        if (diff > 0) {
          const m = Math.floor(diff / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          setCountdown(`${m}m ${s}s`);
        } else {
          setCountdown('Resolved');
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [marketInfo]);

  useEffect(() => {
    setIsSubmitting(false);
  }, [orders]);

  useEffect(() => {
    if (!autoSizeFromBalance || balance <= 0) return;
    setSize(formatUsdSize(balance));
  }, [autoSizeFromBalance, balance]);

  useEffect(() => {
    const currentMarket = discoveredMarkets.find(m => m.type === 'CURRENT');
    if (!currentMarket) return;
    if (marketInfo?.marketId === currentMarket.marketId && Date.now() < (marketInfo.targetTime || 0)) return;

    sendMessage({
      type: 'SUBSCRIBE_MARKET',
      payload: {
        conditionId: currentMarket.conditionId,
        yesTokenId: currentMarket.yesTokenId,
        noTokenId: currentMarket.noTokenId
      }
    });
  }, [discoveredMarkets, marketInfo?.marketId, marketInfo?.targetTime, sendMessage]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'WS_EVENT' && (message.payload.type === 'ORDER_UPDATE' || message.payload.type === 'ERROR')) {
        setIsSubmitting(false);
        if (message.payload.type === 'ERROR') {
          setError(message.payload.error || 'An error occurred');
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleTrade = (side: Side, tokenId?: string, overridePrice?: string) => {
    if (!tokenId) return;
    setError('');
    setIsSubmitting(true);
    sendMessage({
      type: 'PLACE_ORDER',
      id: crypto.randomUUID(),
      payload: {
        tokenId,
        side,
        size,
        price: overridePrice || price
      }
    });
  };

  const updateManualSize = (value: string) => {
    setAutoSizeFromBalance(false);
    setSize(value);
  };

  const setSizeFromBalancePercent = (pct: string) => {
    const pctVal = parseFloat(pct) / 100;
    setAutoSizeFromBalance(false);
    setSize(formatUsdSize(balance * pctVal));
  };

  const getPresetPrice = (preset: PresetConfig, tokenId: string) => {
    if (!marketInfo) return null;
    const isYes = tokenId === marketInfo.yesTokenId;
    const bidStr = isYes ? marketInfo.yesBid : marketInfo.noBid;
    const askStr = isYes ? marketInfo.yesAsk : marketInfo.noAsk;
    const priceStr = isYes ? marketInfo.yesPrice : marketInfo.noPrice;

    let refPrice = parseFloat(priceStr || '0');
    if (preset.reference === 'BEST_BID') refPrice = parseFloat(bidStr || priceStr || '0');
    if (preset.reference === 'BEST_ASK') refPrice = parseFloat(askStr || priceStr || '0');
    if (preset.reference === 'MIDPOINT') {
       const b = parseFloat(bidStr || priceStr || '0');
       const a = parseFloat(askStr || priceStr || '0');
       refPrice = (b + a) / 2;
    }

    if (refPrice <= 0) return null;

    let targetPrice = refPrice;
    if (preset.mode === 'CENT_OFFSET') {
      targetPrice = refPrice + (preset.value / 100);
    } else if (preset.mode === 'PERCENT_OFFSET') {
      targetPrice = refPrice * (1 + (preset.value / 100));
    } else if (preset.mode === 'ABSOLUTE_PRICE') {
      targetPrice = preset.value;
    }

    const ask = parseFloat(askStr || '1');
    const bid = parseFloat(bidStr || '0');

    if (preset.side === 'BUY') {
      const maxBuy = Math.max(0.01, ask - 0.01);
      if (targetPrice > maxBuy) targetPrice = maxBuy;
    } else {
      const minSell = Math.min(0.99, bid + 0.01);
      if (targetPrice < minSell) targetPrice = minSell;
    }

    targetPrice = Math.round(targetPrice * 100) / 100;
    
    if (targetPrice < 0.01 || targetPrice > 0.99) return null;
    
    return targetPrice.toFixed(2);
  };
  
  const isStale = !rtdsMetrics?.connected || rtdsMetrics?.stale;

  return (
    <div className="flex flex-col gap-4">
      {discoveredMarkets.length > 0 && (
        <div className="bg-gray-800 p-2 rounded text-xs flex gap-2 overflow-x-auto">
          {discoveredMarkets.map(m => (
            <div key={m.marketId} className={`p-1 px-2 rounded border cursor-pointer whitespace-nowrap ${(marketInfo && m.marketId === marketInfo.marketId) ? 'bg-blue-900 border-blue-500' : 'bg-gray-700 border-gray-600'} `} onClick={() => {
              sendMessage({
                type: 'SUBSCRIBE_MARKET',
                payload: {
                  conditionId: m.conditionId,
                  yesTokenId: m.yesTokenId,
                  noTokenId: m.noTokenId
                }
              });
            }}>
              {m.type === 'CURRENT' && <span className="text-green-400 font-bold mr-1">•</span>}
              {m.type === 'NEXT' && <span className="text-yellow-400 font-bold mr-1">•</span>}
              {m.title ? m.title.substring(0, 20) + '...' : m.marketId.substring(0, 8)}
            </div>
          ))}
        </div>
      )}

      {!marketInfo ? (
        <div className="text-center text-gray-500 mt-10">Select a market from above or wait for discovery...</div>
      ) : (
        <>
          <div className="bg-gray-800 p-3 rounded">
            {countdown && <div className="text-center text-xs font-mono text-yellow-400 mb-2">{countdown}</div>}
            <div className="flex justify-between text-xs mt-2 border-t border-gray-700 pt-2">
              <div className="flex flex-col">
                <span className="text-gray-400 mb-1">YES</span>
                <div className="flex gap-2">
                  <span className="text-green-400 cursor-pointer hover:underline" onClick={() => setPrice(marketInfo.yesBid || marketInfo.yesPrice)}>Bid: {marketInfo.yesBid || marketInfo.yesPrice}</span>
                  <span className="text-red-400 cursor-pointer hover:underline" onClick={() => setPrice(marketInfo.yesAsk || marketInfo.yesPrice)}>Ask: {marketInfo.yesAsk || marketInfo.yesPrice}</span>
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-gray-400 mb-1">NO</span>
                <div className="flex gap-2">
                  <span className="text-green-400 cursor-pointer hover:underline" onClick={() => setPrice(marketInfo.noBid || marketInfo.noPrice)}>Bid: {marketInfo.noBid || marketInfo.noPrice}</span>
                  <span className="text-red-400 cursor-pointer hover:underline" onClick={() => setPrice(marketInfo.noAsk || marketInfo.noPrice)}>Ask: {marketInfo.noAsk || marketInfo.noPrice}</span>
                </div>
              </div>
            </div>
          </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Size (USD)</label>
          <input 
            type="number" 
            value={size} 
            placeholder={balance > 0 ? formatUsdSize(balance) : '0.00'}
            onChange={e => updateManualSize(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded p-1 text-white outline-none focus:border-blue-500"
            disabled={isSubmitting}
          />
          <div className="flex gap-1 mt-1">
            {['25', '50', '75', '100'].map(pct => (
              <button 
                key={pct} 
                onClick={() => {
                  setSizeFromBalancePercent(pct);
                }} 
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-[10px] py-1 rounded"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Limit Price</label>
          <input 
            type="number" 
            step="0.01" 
            value={price} 
            onChange={e => setPrice(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded p-1 text-white outline-none focus:border-blue-500"
            disabled={isSubmitting}
          />
          <div className="flex gap-1 mt-1">
            <button onClick={() => setPrice(p => Math.max(0.01, parseFloat(p) - 0.01).toFixed(2))} className="flex-1 bg-gray-700 hover:bg-gray-600 text-[10px] py-1 rounded">-1c</button>
            <button onClick={() => setPrice(p => Math.min(0.99, parseFloat(p) + 0.01).toFixed(2))} className="flex-1 bg-gray-700 hover:bg-gray-600 text-[10px] py-1 rounded">+1c</button>
          </div>
        </div>
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}
      {isStale && <p className="text-red-500 text-xs">Trading disabled: Reference price is stale or disconnected</p>}

      <div className="flex gap-2 mt-2">
         <button onClick={() => setActiveSide('YES')} className={`flex-1 py-1 rounded font-bold text-sm ${activeSide === 'YES' ? 'bg-green-600' : 'bg-gray-700'}`}>YES</button>
         <button onClick={() => setActiveSide('NO')} className={`flex-1 py-1 rounded font-bold text-sm ${activeSide === 'NO' ? 'bg-red-600' : 'bg-gray-700'}`}>NO</button>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-gray-400 font-bold text-center border-b border-gray-700 pb-1">BUY PRESETS</div>
          {presets.filter(p => p.side === 'BUY' && p.active).map(p => {
             const activeTokenId = activeSide === 'YES' ? marketInfo.yesTokenId : marketInfo.noTokenId;
             const pr = getPresetPrice(p, activeTokenId);
             return (
               <button 
                 key={p.id}
                 onPointerDown={() => pr && handleTrade('BUY', activeTokenId, pr)} 
                 disabled={!pr || isSubmitting || isStale}
                 className="flex items-center justify-between px-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 py-2 rounded text-xs font-bold"
               >
                 <span>{p.name}</span>
                 <span>[{pr ? `${Math.round(parseFloat(pr)*100)}¢` : '-'}]</span>
               </button>
             )
          })}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs text-gray-400 font-bold text-center border-b border-gray-700 pb-1">SELL PRESETS</div>
          {presets.filter(p => p.side === 'SELL' && p.active).map(p => {
             const activeTokenId = activeSide === 'YES' ? marketInfo.yesTokenId : marketInfo.noTokenId;
             const pr = getPresetPrice(p, activeTokenId);
             return (
               <button 
                 key={p.id}
                 onPointerDown={() => pr && handleTrade('SELL', activeTokenId, pr)} 
                 disabled={!pr || isSubmitting || isStale}
                 className="flex items-center justify-between px-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 py-2 rounded text-xs font-bold"
               >
                 <span>{p.name}</span>
                 <span>[{pr ? `${Math.round(parseFloat(pr)*100)}¢` : '-'}]</span>
               </button>
             )
          })}
        </div>
        </div>
      </>
      )}
    </div>
  );
};

function formatUsdSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Math.min(value, 1000).toFixed(2);
}

export default TradingPanel;
