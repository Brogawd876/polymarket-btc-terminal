import { ClobClient, OrderType } from '@polymarket-btc/server/node_modules/@polymarket/clob-client-v2';
import { ethers } from 'ethers';
import { Side as ClobSide } from '@polymarket/clob-client-v2';

async function runLiveSmoke() {
  console.log('=== RUNNING CONTROLLED LIVE SMOKE TEST ===');

  if (process.env.RUN_LIVE_SMOKE !== 'true') {
    console.log('[NOT RUN] RUN_LIVE_SMOKE is not set to true. Controlled live smoke test skipped.');
    process.exit(0);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('[NOT RUN] PRIVATE_KEY is missing. Live smoke test cannot execute.');
    process.exit(0);
  }

  try {
    const wallet = new ethers.Wallet(privateKey);
    const funderAddress = process.env.POLY_FUNDER_ADDRESS || wallet.address;
    const signatureType = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
    const maxUsd = parseFloat(process.env.LIVE_SMOKE_MAX_USD || '5.0');

    const clobClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet,
      signatureType,
      funderAddress
    });

    const creds = await clobClient.createOrDeriveApiKey();
    const authClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet,
      creds,
      signatureType,
      funderAddress
    });

    // 1. Discover active market
    const res = await fetch('https://gamma-api.polymarket.com/events?series_slug=btc-up-or-down-5m&active=true&closed=false&limit=1');
    if (!res.ok) {
      console.error('[FAIL] Unable to discover active BTC 5m market for smoke test');
      process.exit(1);
    }

    const events = await res.json() as any[];
    if (!events || events.length === 0 || !events[0].markets || events[0].markets.length === 0) {
      console.log('[NOT RUN] No active BTC 5m market currently open for trading.');
      process.exit(0);
    }

    const m = events[0].markets[0];
    const clobTokens = JSON.parse(m.clobTokenIds || '[]');
    if (clobTokens.length === 0) {
      console.error('[FAIL] Active market lacks clobTokenIds');
      process.exit(1);
    }

    const tokenId = clobTokens[0];
    const minSize = parseFloat(m.orderMinSize || '5');
    const farPrice = 0.05; // 5 cents (far from market, post-only maker)
    const requiredUsd = minSize * farPrice;

    if (requiredUsd > maxUsd) {
      console.log(`[NOT RUN]: EXCHANGE MINIMUM (${requiredUsd} USD) EXCEEDS SMOKE CAP (${maxUsd} USD)`);
      process.exit(0);
    }

    console.log(`Submitting 1 post-only limit order for token ${tokenId} @ $${farPrice} (${minSize} shares = $${requiredUsd.toFixed(2)} USD)...`);

    const orderArgs = {
      tokenID: tokenId,
      price: farPrice,
      side: ClobSide.BUY,
      size: minSize,
      feeRateBps: 0,
      nonce: 0,
      postOnly: true
    };

    const signedOrder = await authClient.createOrder(orderArgs);
    const postResponse = await authClient.postOrder(signedOrder, OrderType.GTC, true);

    if (!postResponse.success || !postResponse.orderID) {
      console.error('[FAIL] Post order returned unsuccessful response:', postResponse);
      process.exit(1);
    }

    const orderId = postResponse.orderID;
    console.log(`[PASS] Post-only limit order submitted successfully! Remote Order ID: ${orderId}`);

    // Confirm order state
    const orderDetails = await authClient.getOrder(orderId);
    console.log(`[PASS] Remote order query confirmed status: ${orderDetails.status}`);

    // Cancel order
    console.log(`Cancelling smoke order ${orderId}...`);
    await authClient.cancelOrder({ orderID: orderId });
    console.log(`[PASS] Remote order ${orderId} cancelled successfully!`);

    console.log('=== CONTROLLED LIVE SMOKE TEST PASSED ===');
  } catch (e: any) {
    console.error('[FAIL] Live smoke test error:', e.message);
    process.exit(1);
  }
}

runLiveSmoke();
