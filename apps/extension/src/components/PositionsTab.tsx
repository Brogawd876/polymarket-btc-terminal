import React from 'react';
import type { MarketState } from '@polymarket-btc/shared';

interface Props {
  positions: any[];
  balance: number;
  realizedPnl: number;
  marketInfo: MarketState | null;
}

const PositionsTab: React.FC<Props> = ({ positions, balance, realizedPnl, marketInfo }) => {
  const calculateUnrealizedPnl = () => {
    if (!marketInfo) return 0;
    let upnl = 0;
    positions.forEach(p => {
      // Find the current market price for this asset
      let currentPrice = 0;
      if (p.asset === marketInfo.yesTokenId) currentPrice = parseFloat(marketInfo.yesPrice || '0');
      else if (p.asset === marketInfo.noTokenId) currentPrice = parseFloat(marketInfo.noPrice || '0');
      
      if (currentPrice > 0) {
        if (p.side === 'BUY') {
          upnl += (currentPrice - parseFloat(p.entry)) * parseFloat(p.size);
        } else if (p.side === 'SELL') {
          upnl += (parseFloat(p.entry) - currentPrice) * parseFloat(p.size);
        }
      }
    });
    return upnl;
  };

  const unrealizedPnl = calculateUnrealizedPnl();
  const totalPnl = realizedPnl + unrealizedPnl;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="grid grid-cols-3 gap-2 bg-gray-800 p-3 rounded text-center">
        <div>
          <div className="text-gray-400">Balance</div>
          <div className="font-bold font-mono">${balance.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-gray-400">Unrealized P&L</div>
          <div className={`font-bold font-mono ${unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-gray-400">Realized P&L</div>
          <div className={`font-bold font-mono ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {realizedPnl >= 0 ? '+' : ''}{realizedPnl.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-bold border-b border-gray-700 pb-1">Positions</h3>
        {positions.length === 0 ? (
          <div className="text-gray-500">No open positions</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-gray-400">
                <th className="font-normal">Asset</th>
                <th className="font-normal">Side</th>
                <th className="font-normal text-right">Size</th>
                <th className="font-normal text-right">Avg Entry</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={i} className="border-t border-gray-800">
                  <td className="py-2">
                    {marketInfo?.yesTokenId === p.asset ? 'YES' : marketInfo?.noTokenId === p.asset ? 'NO' : (p.asset.substring(0,6) || 'Unknown')}
                  </td>
                  <td className={`py-2 font-bold ${p.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{p.side}</td>
                  <td className="py-2 text-right">{parseFloat(p.size).toFixed(2)}</td>
                  <td className="py-2 text-right">${parseFloat(p.entry).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
export default PositionsTab;
