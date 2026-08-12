import { describe, expect, it } from 'vitest';
import { BookStateSchema } from '@polymarket-btc/shared';
import {
  applyBookDelta,
  applyBookSnapshot,
  bookStaleReason,
  privateEventKey,
  toPublicBookState,
} from './streamUtils';

describe('Polymarket stream book handling', () => {
  it('applies price-level deltas and removes zero-size levels', () => {
    const snapshot = applyBookSnapshot(undefined, {
      timestamp: 1_700_000_000_000,
      tick_size: '0.01',
      bids: [{ price: '0.48', size: '10' }, { price: '0.47', size: '4' }],
      asks: [{ price: '0.52', size: '8' }],
    }, 1_700_000_000_100);

    const changed = applyBookDelta(snapshot, {
      timestamp: 1_700_000_000_200,
      side: 'BUY',
      price: '0.48',
      size: '0',
    }, undefined, 1_700_000_000_250);

    expect(changed.bids).toEqual([{ price: '0.47', size: '4' }]);
    expect(changed.asks).toEqual(snapshot.asks);
    expect(changed.version).toBe(snapshot.version + 1);
  });

  it('rejects out-of-order snapshots and deltas', () => {
    const latest = applyBookSnapshot(undefined, {
      timestamp: 1_700_000_010_000,
      bids: [{ price: '0.49', size: '2' }],
      asks: [{ price: '0.51', size: '2' }],
    });
    const oldSnapshot = applyBookSnapshot(latest, {
      timestamp: 1_700_000_000_000,
      bids: [{ price: '0.10', size: '99' }],
      asks: [{ price: '0.90', size: '99' }],
    });
    const oldDelta = applyBookDelta(latest, {
      timestamp: 1_700_000_000_000,
      side: 'BUY',
      price: '0.49',
      size: '0',
    });

    expect(oldSnapshot).toBe(latest);
    expect(oldDelta).toBe(latest);
  });

  it('uses source time for stale state while retaining the book', () => {
    const book = applyBookSnapshot(undefined, {
      timestamp: 1_700_000_000_000,
      bids: [{ price: '0.49', size: '2' }],
      asks: [{ price: '0.51', size: '2' }],
    }, 1_700_000_020_000);

    expect(bookStaleReason(book, 1_700_000_005_000, 10_000)).toBeUndefined();
    expect(bookStaleReason(book, 1_700_000_020_000, 10_000)).toBe('BOOK_SOURCE_STALE');
    expect(book.bids[0].price).toBe('0.49');
  });

  it('builds stable private-event dedupe keys from actual event_type fields', () => {
    const event = { event_type: 'trade', id: 'trade-1', status: 'MATCHED', last_update: '123' };
    expect(privateEventKey(event)).toBe('trade:trade-1:MATCHED:123');
    expect(privateEventKey({ event_type: 'trade' })).toBeUndefined();
  });

  it('publishes canonical protocol book state', () => {
    const book = applyBookSnapshot(undefined, {
      timestamp: 1_700_000_000_000,
      tick_size: '0.01',
      last_trade_price: '0.50',
      bids: [{ price: '0.49', size: '2' }],
      asks: [{ price: '0.51', size: '3' }],
    }, 1_700_000_000_100);

    const published = toPublicBookState(book, 'up-token', 'UP', '0.01', '5');

    expect(BookStateSchema.safeParse(published).success).toBe(true);
    expect(published).toMatchObject({
      tokenId: 'up-token',
      outcome: 'UP',
      spread: '0.02',
      tickSize: '0.01',
      minimumOrderSize: '5',
      quality: 'FRESH',
    });
  });
});
