import { describe, expect, it, vi } from 'vitest';
import { createClientCommand, parseServerEvent, protocolVersion } from './protocol';

describe('extension protocol boundary', () => {
  it('adds the current protocol version and a request id to valid commands', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });
    const result = createClientCommand({ type: 'DISARM_LIVE' });
    expect(result).toEqual({ success: true, data: { protocolVersion, id: 'request-1', type: 'DISARM_LIVE' } });
    vi.unstubAllGlobals();
  });

  it('rejects malformed command payloads', () => {
    expect(createClientCommand({ type: 'CANCEL_ORDER', payload: {} }).success).toBe(false);
  });

  it('rejects missing and incompatible backend protocol versions', () => {
    expect(parseServerEvent(JSON.stringify({ type: 'ERROR', payload: { message: 'x' } })).success).toBe(false);
    expect(parseServerEvent(JSON.stringify({ protocolVersion: 99, type: 'ERROR', payload: { message: 'x' } })).success).toBe(false);
  });

  it('accepts a valid versioned server event', () => {
    const result = parseServerEvent(JSON.stringify({ protocolVersion, type: 'ERROR', payload: { message: 'rejected' } }));
    expect(result.success).toBe(true);
  });
});
