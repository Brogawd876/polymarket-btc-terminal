import { describe, it, expect } from 'vitest';

type Fill = { side: 'BUY' | 'SELL'; price: string; size: string; fee?: string };

function computePositionFromFills(fills: Fill[]) {
  let netSize = 0;
  let totalCost = 0;
  let totalFees = 0;
  let realizedPnl = 0;

  for (const f of fills) {
    const fSize = parseFloat(f.size);
    const fPrice = parseFloat(f.price);
    const fFee = parseFloat(f.fee || '0');
    totalFees += fFee;

    if (f.side === 'BUY') {
      totalCost += (fSize * fPrice);
      netSize += fSize;
    } else if (f.side === 'SELL') {
      const avgCostBeforeSell = netSize > 0 ? (totalCost / netSize) : 0;
      const sellProceeds = fSize * fPrice;
      const costBasis = fSize * avgCostBeforeSell;
      realizedPnl += (sellProceeds - costBasis - fFee);

      netSize = Math.max(0, netSize - fSize);
      if (netSize === 0) totalCost = 0;
      else totalCost = netSize * avgCostBeforeSell;
    }
  }

  const avgPrice = netSize > 0 ? (totalCost / netSize).toFixed(4) : '0';

  return { netSize, avgPrice, totalFees, realizedPnl };
}

describe('Fill-Based Position & PnL Accounting', () => {
  it('calculates average entry price for multiple BUY fills', () => {
    const fills: Fill[] = [
      { side: 'BUY', price: '0.40', size: '10' }, // cost $4.00
      { side: 'BUY', price: '0.60', size: '10' }, // cost $6.00
    ];
    const pos = computePositionFromFills(fills);
    expect(pos.netSize).toBe(20);
    expect(pos.avgPrice).toBe('0.5000'); // total cost $10.00 / 20 shares = $0.50
    expect(pos.realizedPnl).toBe(0);
  });

  it('calculates realized PnL on partial SELL fill', () => {
    const fills: Fill[] = [
      { side: 'BUY', price: '0.40', size: '10' },  // buy 10 @ 0.40 = $4.00
      { side: 'SELL', price: '0.70', size: '5' },  // sell 5 @ 0.70 = $3.50 (cost $2.00) -> PnL +$1.50
    ];
    const pos = computePositionFromFills(fills);
    expect(pos.netSize).toBe(5);
    expect(pos.avgPrice).toBe('0.4000');
    expect(pos.realizedPnl).toBe(1.50);
  });

  it('resets average price when position is fully closed', () => {
    const fills: Fill[] = [
      { side: 'BUY', price: '0.40', size: '10' },
      { side: 'SELL', price: '0.60', size: '10' },
    ];
    const pos = computePositionFromFills(fills);
    expect(pos.netSize).toBe(0);
    expect(pos.avgPrice).toBe('0');
    expect(pos.realizedPnl).toBe(2.00);
  });
});
