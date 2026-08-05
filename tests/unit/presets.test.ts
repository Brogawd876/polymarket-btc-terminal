import { describe, it, expect } from 'vitest';
import { PresetConfig } from '@polymarket-btc/shared';

function calculatePresetPrice(
  preset: PresetConfig, 
  priceStr: string, 
  bidStr?: string, 
  askStr?: string
): string | null {
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
}

describe('Preset Price Calculations & Clamping', () => {
  it('calculates 1c under ask correctly', () => {
    const preset: PresetConfig = {
      id: 'p1', name: '1c under ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: -0.01, active: true, clampMode: 'CLAMP'
    };
    const price = calculatePresetPrice(preset, '0.55', '0.54', '0.56');
    expect(price).toBe('0.55');
  });

  it('calculates 15% under ask correctly with maker clamping', () => {
    const preset: PresetConfig = {
      id: 'p2', name: '15% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -15, active: true, clampMode: 'CLAMP'
    };
    const price = calculatePresetPrice(preset, '0.50', '0.49', '0.51');
    // 0.51 * (1 - 0.15) = 0.4335 -> 0.43
    expect(price).toBe('0.43');
  });

  it('clamps BUY price below ask to avoid crossing book', () => {
    const preset: PresetConfig = {
      id: 'p3', name: 'Over ask buy', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: 0.10, active: true, clampMode: 'CLAMP'
    };
    const price = calculatePresetPrice(preset, '0.50', '0.49', '0.51');
    // 0.51 + 0.10 = 0.61 -> clamped to ask - 0.01 = 0.50
    expect(price).toBe('0.50');
  });

  it('clamps SELL price above bid to avoid crossing book', () => {
    const preset: PresetConfig = {
      id: 'p4', name: 'Under bid sell', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: -0.10, active: true, clampMode: 'CLAMP'
    };
    const price = calculatePresetPrice(preset, '0.50', '0.49', '0.51');
    // 0.49 - 0.10 = 0.39 -> clamped to bid + 0.01 = 0.50
    expect(price).toBe('0.50');
  });
});
