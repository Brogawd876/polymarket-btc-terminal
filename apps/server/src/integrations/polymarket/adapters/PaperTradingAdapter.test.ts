import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { PaperTradingAdapter } from './PaperTradingAdapter';
import { setupDb, getDb } from '../../../db';
import fs from 'fs';
import path from 'path';

// Mock ws
vi.mock('ws', () => {
  return {
    default: class MockWebSocket {
      on = vi.fn();
      send = vi.fn();
      close = vi.fn();
      readyState = 1;
    }
  };
});

describe('PaperTradingAdapter', () => {
  let adapter: PaperTradingAdapter;
  let db: any;

  beforeEach(() => {
    // use an in-memory db if possible or clear test db
    db = setupDb();
    db.prepare('DELETE FROM fills').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM positions').run();
    db.prepare('DELETE FROM paper_balance').run();

    adapter = new PaperTradingAdapter();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  test('initializes and creates paper_balance', async () => {
    await adapter.initialize();
    const balance = await adapter.getBalance();
    expect(balance).toBe(10000);
  });

  test('places order and simulates partial fill', async () => {
    await adapter.initialize();
    
    // Subscribe to a condition
    adapter.subscribeToMarket('cond1', 'tokenYes', 'tokenNo');
    
    // Simulate incoming orderbook updates
    const wsOnCallback = vi.mocked((adapter as any).wsMarket.on).mock.calls.find((call: any) => call[0] === 'message')?.[1];
    
    expect(wsOnCallback).toBeDefined();

    // Place a buy order for 100 shares at $0.50
    const order = await adapter.placeOrder('tokenYes', 'BUY', '100', '0.50');
    expect(order.status).toBe('PENDING');

    // Simulate WS market message with an ask at 0.49 (favorable) for 40 shares
    if (wsOnCallback) {
      wsOnCallback(JSON.stringify({
        event: 'market',
        asset_id: 'tokenYes',
        bids: [],
        asks: [{ price: '0.49', size: '40' }]
      }));
    }

    // Check fills
    const fills = db.prepare('SELECT * FROM fills WHERE orderId = ?').all(order.id);
    expect(fills.length).toBe(1);
    expect(fills[0].size).toBe('40');
    expect(fills[0].price).toBe('0.49');

    // Check positions
    const pos = db.prepare('SELECT * FROM positions WHERE tokenId = ?').get('tokenYes');
    expect(pos.netSize).toBe('40');
    expect(pos.avgPrice).toBe('0.49');

    // Check remaining size
    const resting = (adapter as any).restingOrders.get('tokenYes');
    expect(resting.length).toBe(1);
    expect(resting[0].remainingSize).toBe(60);
    
    // Simulate another fill for the rest at exactly 0.50
    if (wsOnCallback) {
      wsOnCallback(JSON.stringify({
        event: 'market',
        asset_id: 'tokenYes',
        bids: [],
        asks: [{ price: '0.50', size: '100' }] // 100 available, we need 60
      }));
    }

    const fills2 = db.prepare('SELECT * FROM fills WHERE orderId = ?').all(order.id);
    expect(fills2.length).toBe(2);
    
    const dbOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    expect(dbOrder.status).toBe('FILLED');

    const resting2 = (adapter as any).restingOrders.get('tokenYes');
    expect(resting2.length).toBe(0);
    
    // Balance check: started with 10000. Spent (40 * 0.49) + (60 * 0.50) = 19.6 + 30 = 49.6
    const balance = await adapter.getBalance();
    expect(balance).toBeCloseTo(10000 - 49.6);
  });
});
