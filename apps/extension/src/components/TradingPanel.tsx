import React, { useState, useEffect } from 'react';
import type { MarketState, Side, Order } from '@polymarket-btc/shared';
import { Loader2 } from 'lucide-react';

interface Props {
  marketInfo: MarketState | null;
  sendMessage: (msg: any) => void;
  orders?: Order[];
}

const TradingPanel: React.FC<Props> = ({ marketInfo, sendMessage, orders = [] }) => {
  const [size, setSize] = useState('100');
  const [price, setPrice] = useState('0.50');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState<number>(0);
  const [dataAge, setDataAge] = useState<number>(0);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_BALANCE' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.balance !== undefined) {
        setBalance(response.balance);
      }
    });
  }, []);

  useEffect(() => {
    if (!marketInfo?.lastUpdated) return;
    const interval = setInterval(() => {
      setDataAge(Date.now() - marketInfo.lastUpdated);
    }, 100);
    return () => clearInterval(interval);
  }, [marketInfo]);

  useEffect(() => {
    setIsSubmitting(false);
  }, [orders]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'WS_EVENT' && (message.payload.type === 'ORDER_UPDATE' || message.payload.type === 'ERROR')) {
        setIsSubmitting(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  
  if (!marketInfo) {
    return <div className="text-center text-gray-500 mt-10">Waiting for market data...</div>;
  }

  const handleTrade = (side: Side, tokenId: string) => {
    if (!tokenId) {
      setError("Token ID is missing");
      return;
    }
    if (!/^(0\.[0-9]+)$/.test(price) || price === '0.00' || price === '0.0') {
      setError("Price must be between 0.01 and 0.99");
      return;
    }
    const parsedSize = parseFloat(size);
    if (isNaN(parsedSize) || parsedSize <= 0 || parsedSize > 10000) {
      setError("Size must be between 0 and 10000");
      return;
    }
    setError('');

    setIsSubmitting(true);
    sendMessage({
      type: 'PLACE_ORDER',
      payload: { tokenId, side, size, price }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-800 p-3 rounded">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold text-sm truncate" title={marketInfo.marketId}>{marketInfo.marketId}</h3>
          <span className="text-[10px] text-gray-400 font-mono">Data Age: {dataAge}ms</span>
        </div>
        <div className="flex justify-between text-xs">
          <span 
            className="text-green-400 cursor-pointer hover:underline"
            onClick={() => setPrice(marketInfo.yesPrice)}
          >
            Yes: {marketInfo.yesPrice}
          </span>
          <span 
            className="text-red-400 cursor-pointer hover:underline"
            onClick={() => setPrice(marketInfo.noPrice)}
          >
            No: {marketInfo.noPrice}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Size (USD)</label>
          <input 
            type="number" 
            value={size} 
            onChange={e => setSize(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded p-1 text-white outline-none focus:border-blue-500"
            disabled={isSubmitting}
          />
          <div className="flex gap-1 mt-1">
            {['25', '50', '75', '100'].map(pct => (
              <button 
                key={pct} 
                onClick={() => {
                  const pctVal = parseFloat(pct) / 100;
                  setSize((balance * pctVal).toFixed(2));
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

      <div className="grid grid-cols-2 gap-4 mt-2">
        <div className="flex flex-col gap-2">
          <button 
            onPointerDown={() => handleTrade('BUY', marketInfo.yesTokenId)} 
            disabled={isSubmitting || !marketInfo.yesTokenId}
            className="flex items-center justify-center bg-green-600 hover:bg-green-500 disabled:opacity-50 py-2 rounded font-bold"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Buy YES
          </button>
          <button 
            onPointerDown={() => handleTrade('SELL', marketInfo.yesTokenId)} 
            disabled={isSubmitting || !marketInfo.yesTokenId}
            className="flex items-center justify-center bg-green-900 hover:bg-green-800 disabled:opacity-50 py-2 rounded font-bold text-xs"
          >
            Sell YES
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button 
            onPointerDown={() => handleTrade('BUY', marketInfo.noTokenId)} 
            disabled={isSubmitting || !marketInfo.noTokenId}
            className="flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:opacity-50 py-2 rounded font-bold"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Buy NO
          </button>
          <button 
            onPointerDown={() => handleTrade('SELL', marketInfo.noTokenId)} 
            disabled={isSubmitting || !marketInfo.noTokenId}
            className="flex items-center justify-center bg-red-900 hover:bg-red-800 disabled:opacity-50 py-2 rounded font-bold text-xs"
          >
            Sell NO
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingPanel;
