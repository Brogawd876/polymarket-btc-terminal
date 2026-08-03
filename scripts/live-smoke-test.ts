import { PolymarketAdapter } from '../apps/server/src/integrations/polymarket/adapter';

async function runSmokeTest() {
  console.log('Starting Live Smoke Test for Polymarket Adapter...');
  const adapter = new PolymarketAdapter();

  try {
    await adapter.initialize();
    
    // Max $1 limit order as requested for safety
    console.log('Placing $1 limit order (Smoke Test)...');
    const order = await adapter.placeOrder('btc-5min-market-1', 'YES', '1.00', '0.50');
    console.log('Order successful:', order);

    console.log('Cancelling order...');
    await adapter.cancelOrder(order.id);
    
    console.log('Smoke test completed successfully!');
  } catch (error) {
    console.error('Smoke test failed:', error);
    process.exit(1);
  } finally {
    await adapter.shutdown();
  }
}

if (require.main === module) {
  runSmokeTest();
}
