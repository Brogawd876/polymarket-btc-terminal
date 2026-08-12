import React, { useState } from 'react';
import type { Position, MarketState } from '@polymarket-btc/shared';

interface Props {
  positions: Position[];
  balance: number;
  realizedPnl: number;
  marketInfo: MarketState | null;
}

const PositionsTab: React.FC<Props> = ({ positions = [], balance = 0, realizedPnl = 0, marketInfo }) => {
  const activePositions = positions.filter(p => parseFloat(p.netSize || p.netShares || '0') > 0);
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const currentPositions = marketInfo
    ? activePositions.filter(p => p.conditionId === marketInfo.conditionId || p.tokenId === marketInfo.upTokenId || p.tokenId === marketInfo.downTokenId || p.tokenId === marketInfo.yesTokenId || p.tokenId === marketInfo.noTokenId)
    : [];
  const visiblePositions = scope === 'current' ? currentPositions : activePositions;

  return (
    <div className="flex flex-col gap-3 text-xs font-sans">
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 grid grid-cols-2 gap-2 font-mono">
        <div>
          <span className="text-gray-400 text-[10px] block">COLLATERAL BAL</span>
          <span className="text-sm font-bold text-white">${balance.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <span className="text-gray-400 text-[10px] block">REALIZED P&L</span>
          <span className={`text-sm font-bold ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {realizedPnl >= 0 ? `+$${realizedPnl.toFixed(2)}` : `-$${Math.abs(realizedPnl).toFixed(2)}`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="font-bold text-gray-200 uppercase tracking-wider">
          {scope === 'current' ? 'CURRENT MARKET' : 'ALL POSITIONS'} ({visiblePositions.length})
        </div>
        <div className="flex gap-1 font-mono text-[10px]">
          <button
            onClick={() => setScope('current')}
            className={`px-2 py-1 rounded border ${scope === 'current' ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
          >
            CURRENT
          </button>
          <button
            onClick={() => setScope('all')}
            className={`px-2 py-1 rounded border ${scope === 'all' ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
          >
            ALL
          </button>
        </div>
      </div>

      {visiblePositions.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          {scope === 'current' ? 'No current-market position' : 'No open positions'}
        </div>
      ) : (
        <div className="flex flex-col gap-2 font-mono">
          {visiblePositions.map(pos => {
            const isUp = marketInfo && (pos.tokenId === marketInfo.upTokenId || pos.tokenId === marketInfo.yesTokenId);
            const isDown = marketInfo && (pos.tokenId === marketInfo.downTokenId || pos.tokenId === marketInfo.noTokenId);
            const outcomeText = isUp ? 'UP' : isDown ? 'DOWN' : (pos.outcome || 'SHARES');

            const currentBidStr = isUp 
              ? (marketInfo?.upBid || marketInfo?.yesBid) 
              : isDown ? (marketInfo?.downBid || marketInfo?.noBid) : undefined;
            const currentBid = parseFloat(currentBidStr || '0');

            const netShares = parseFloat(pos.netSize || pos.netShares || '0');
            const avgEntry = parseFloat(pos.avgPrice || pos.averageEntry || '0');
            const costBasis = netShares * avgEntry;
            const estLiqVal = currentBid > 0 ? netShares * currentBid : costBasis;
            const unrealized = currentBid > 0 ? (estLiqVal - costBasis) : 0;

            return (
              <div key={pos.tokenId} className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${isUp ? 'bg-green-950 text-green-400 border border-green-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
                      {outcomeText}
                    </span>
                    <span className="text-white font-bold">{netShares.toFixed(1)} SHARES</span>
                  </div>
                  <span className="text-[10px] text-gray-400">AVG: @${avgEntry.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[10px] pt-1.5 border-t border-gray-700/60 text-gray-300">
                  <div>COST BASIS: ${costBasis.toFixed(2)}</div>
                  <div className="text-right">EST LIQ: ${estLiqVal.toFixed(2)}</div>
                  <div>FEES: ${parseFloat(pos.fees || '0').toFixed(2)}</div>
                  <div className={`text-right font-bold ${unrealized >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    UNREALIZED: {unrealized >= 0 ? `+$${unrealized.toFixed(2)}` : `-$${Math.abs(unrealized).toFixed(2)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PositionsTab;
