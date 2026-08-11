import { describe, expect, it } from 'vitest';
import { PresetEngine } from '../../apps/server/src/routes/trading';

describe('PresetEngine production price math', () => {
  const engine = new PresetEngine();

  it('calculates cent and percent offsets', () => {
    expect(engine.calculate(0.51, 'CENT_OFFSET', -0.01)).toBeCloseTo(0.50, 8);
    expect(engine.calculate(0.51, 'PERCENT_OFFSET', -15)).toBeCloseTo(0.4335, 8);
  });

  it('rounds buys down and sells up to the actual market tick', () => {
    expect(engine.round(0.437, 0.01, 'BUY')).toBe(0.43);
    expect(engine.round(0.437, 0.01, 'SELL')).toBe(0.44);
    expect(engine.round(0.437, 0.005, 'BUY')).toBe(0.435);
    expect(engine.round(0.437, 0.005, 'SELL')).toBe(0.44);
  });

  it('rejects an invalid tick instead of silently assuming one cent', () => {
    expect(() => engine.round(0.50, 0, 'BUY')).toThrow(/valid market tick/i);
  });
});
