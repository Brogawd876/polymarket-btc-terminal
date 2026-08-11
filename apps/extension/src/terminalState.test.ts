import { describe, expect, it } from 'vitest';
import { initialTerminalState, terminalReducer } from './terminalState';

const marketEvent = (revision: number, marketId: string) => ({
  type: 'SERVER_EVENT' as const,
  parsed: {
    revision,
    event: {
      protocolVersion: 2,
      type: 'MARKET_UPDATED',
      payload: {
        marketId,
        conditionId: `condition-${marketId}`,
        title: marketId,
        status: 'OPEN',
        upPrice: '0.50',
        downPrice: '0.50',
        lastUpdated: revision,
      },
    },
  },
}) as any;

describe('terminal reducer revisions', () => {
  it('applies newer events and ignores stale or duplicate revisions', () => {
    const current = terminalReducer(initialTerminalState, marketEvent(10, 'current'));
    expect(current.marketInfo?.marketId).toBe('current');
    expect(terminalReducer(current, marketEvent(9, 'stale'))).toBe(current);
    expect(terminalReducer(current, marketEvent(10, 'duplicate'))).toBe(current);
    expect(terminalReducer(current, marketEvent(11, 'next')).marketInfo?.marketId).toBe('next');
  });

  it('retains last-good market data when disconnected', () => {
    const current = terminalReducer(initialTerminalState, marketEvent(1, 'kept'));
    const offline = terminalReducer(current, { type: 'CONNECTION', connected: false });
    expect(offline.marketInfo?.marketId).toBe('kept');
    expect(offline.operationalState).toBe('OFFLINE');
  });

  it('records the exact command response ID for keyed request completion', () => {
    const next = terminalReducer(initialTerminalState, {
      type: 'SERVER_EVENT',
      parsed: {
        revision: 1,
        event: {
          protocolVersion: 2,
          type: 'ORDER_RESULT',
          id: 'order-request-7',
          payload: { result: 'ACCEPTED', requestId: 'order-request-7', orderId: 'local-7', remoteTradeIds: [] },
        },
      },
    } as any);
    expect(next.lastResponseId).toBe('order-request-7');
    expect(next.lastResponseType).toBe('ORDER_RESULT');
  });
});
