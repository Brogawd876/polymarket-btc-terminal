import { describe, expect, it } from 'vitest';
import {
  ClientCommandEnvelopeSchema,
  OrderIntentSchema,
  PROTOCOL_VERSION,
  ServerEventEnvelopeSchema,
  SubmissionResultSchema,
  WsEventSchema,
} from '../../packages/shared/src';

describe('versioned protocol direction and payload validation', () => {
  it('rejects server-only event types on the client command channel', () => {
    expect(ClientCommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION, id: 'm1', type: 'ORDER_RESULT', payload: {},
    }).success).toBe(false);
  });

  it('rejects client-only commands on the server event channel', () => {
    expect(ServerEventEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION, id: 'm2', type: 'PLACE_ORDER_INTENT', payload: {},
    }).success).toBe(false);
  });

  it('rejects incompatible protocol versions and unknown envelope fields', () => {
    expect(ClientCommandEnvelopeSchema.safeParse({ protocolVersion: 1, id: 'm3', type: 'PING' }).success).toBe(false);
    expect(ClientCommandEnvelopeSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, id: 'm4', type: 'PING', raw: true }).success).toBe(false);
  });

  it('requires side-specific sizing and quote binding in order intents', () => {
    expect(OrderIntentSchema.safeParse({
      requestId: 'buy-1', conditionId: 'condition', outcome: 'UP', side: 'BUY',
      executionMode: 'MAKER', orderType: 'GTC', marketRevision: 3,
    }).success).toBe(false);
    expect(OrderIntentSchema.safeParse({
      requestId: 'sell-1', conditionId: 'condition', outcome: 'DOWN', side: 'SELL',
      executionMode: 'IMMEDIATE', orderType: 'FAK', marketRevision: 3,
    }).success).toBe(false);
  });

  it('preserves the authoritative token binding on a valid intent', () => {
    const parsed = OrderIntentSchema.parse({
      requestId: 'buy-2', conditionId: 'condition', tokenId: 'token-up', outcome: 'UP', side: 'BUY',
      executionMode: 'MAKER', orderType: 'GTC', quoteId: 'quote-1', marketRevision: 3, dollarSpend: '3',
    });
    expect((parsed as any).tokenId).toBe('token-up');
  });

  it('rejects malformed payloads at the directional command boundary', () => {
    expect(ClientCommandEnvelopeSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION, id: 'm5', type: 'AUTH', payload: { token: 42 },
    }).success).toBe(false);
  });

  it('validates command payloads through the discriminated message schema', () => {
    expect(WsEventSchema.safeParse({
      type: 'PLACE_ORDER_INTENT', protocolVersion: PROTOCOL_VERSION,
      payload: { requestId: 'bad', conditionId: 'condition', outcome: 'UP', side: 'BUY', executionMode: 'MAKER', orderType: 'GTC', marketRevision: 1 },
    }).success).toBe(false);
  });

  it('accepts only the canonical submission result shape', () => {
    expect(SubmissionResultSchema.safeParse({
      requestId: 'r1', orderId: 'local-1', remoteOrderId: 'remote-1', result: 'ACCEPTED',
      requestedAmount: '3', executedAmount: '0', unfilledAmount: '3', remoteTradeIds: [],
    }).success).toBe(true);
    expect(SubmissionResultSchema.safeParse({
      requestId: 'r1', localOrderId: 'local-1', status: 'ACCEPTED', remoteOrderIds: ['remote-1'],
    }).success).toBe(false);
  });
});
