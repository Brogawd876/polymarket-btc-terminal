import { describe, expect, it } from 'vitest';
import { RequestGate } from './requestGate';

describe('RequestGate', () => {
  it('allows only one active request and releases on completion', () => {
    const gate = new RequestGate();
    expect(gate.begin('first')).toBe(true);
    expect(gate.begin('duplicate')).toBe(false);
    gate.complete('duplicate');
    expect(gate.active).toBe(true);
    gate.complete('first');
    expect(gate.begin('second')).toBe(true);
  });
});
