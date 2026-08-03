import React, { useState } from 'react';
import type { MarketState, WsEvent, Side } from '@polymarket-btc/shared';
import { Loader2 } from 'lucide-react';

interface Props {
  marketInfo: MarketState | null;
  sendMessage: (msg: any) => void;
}

const TradingPanel: React.FC<Props> = ({ marketInfo, sendMessage }) => {
  const [size, setSize] = useState('100');
  const [price, setPrice] = useState('0.50');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  if (!marketInfo) {
    return <div className="text-center text-gray-500 mt-10">Waiting for market data...</div>;
  }

  const handleTrade = (side: Side) => {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0.01 || numPrice > 0.99) {
      alert("Price must be between 0.01 and 0.99");
      return;
    }

    setIsSubmitting(true);
    sendMessage({
      type: 'PLACE_ORDER',
      payload: { marketId: marketInfo.marketId, side, size, price }
    });

    setTimeout(() => {
      setIsSubmitting(false);
    }, 1000);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-800 p-3 rounded">
        <h3 className="font-bold text-sm mb-2">{marketInfo.marketId}</h3>
        <div className="flex justify-between text-xs">
          <span className="text-green-400">Yes: {marketInfo.yesPrice}</span>
          <span className="text-red-400">No: {marketInfo.noPrice}</span>
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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-2">
        <div className="flex flex-col gap-2">
          <button 
            onClick={() => handleTrade('YES')} 
            disabled={isSubmitting}
            className="flex items-center justify-center bg-green-600 hover:bg-green-500 disabled:opacity-50 py-2 rounded font-bold"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Buy YES
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button 
            onClick={() => handleTrade('NO')} 
            disabled={isSubmitting}
            className="flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:opacity-50 py-2 rounded font-bold"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Buy NO
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingPanel;
