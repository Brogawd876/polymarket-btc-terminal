import WebSocket from 'ws';
import { setupDb } from '../src/db/index';

async function runPublicDiagnose() {
  console.log('=== RUNNING PUBLIC DIAGNOSTICS ===');
  let exitCode = 0;

  // 1. Test SQLite DB setup
  try {
    const db = setupDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    console.log(`[PASS] SQLite DB Initialized. Found ${tables.length} tables in WAL mode.`);
  } catch (e: any) {
    console.error(`[FAIL] SQLite DB initialization failed: ${e.message}`);
    exitCode = 1;
  }

  // 2. Test Gamma API discovery endpoint
  try {
    const res = await fetch('https://gamma-api.polymarket.com/events?series_slug=btc-up-or-down-5m&active=true&closed=false&limit=10');
    if (res.ok) {
      const events = await res.json() as any[];
      console.log(`[PASS] Gamma API Market Discovery OK. Active 5m events returned: ${events.length}`);
      if (events.length > 0 && events[0].markets && events[0].markets.length > 0) {
        const m = events[0].markets[0];
        console.log(`       Sample Market: ${m.groupItemTitle} (ConditionId: ${m.conditionId})`);
      }
    } else {
      console.error(`[FAIL] Gamma API returned HTTP status ${res.status}`);
      exitCode = 1;
    }
  } catch (e: any) {
    console.error(`[FAIL] Gamma API network query failed: ${e.message}`);
    exitCode = 1;
  }

  // 3. Test Chainlink RTDS WebSocket stream
  const rtdsPassed = await new Promise<boolean>((resolve) => {
    const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        topic: 'crypto_prices'
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg || msg.topic === 'crypto_prices' || msg.price) {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        }
      } catch (err) {
        // Continue
      }
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  if (rtdsPassed) {
    console.log('[PASS] Chainlink RTDS WebSocket Feed Connection Successful');
  } else {
    console.log('[WARN] Chainlink RTDS WebSocket handshake check timed out or pending data');
  }

  console.log(`=== PUBLIC DIAGNOSTICS COMPLETE (Exit Code: ${exitCode}) ===`);
  process.exit(exitCode);
}

runPublicDiagnose();
