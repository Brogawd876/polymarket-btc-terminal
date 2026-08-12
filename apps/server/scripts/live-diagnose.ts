import { ClobClient } from '@polymarket/clob-client-v2';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import crypto from 'crypto';

async function runLiveDiagnose() {
  console.log('=== RUNNING LIVE DIAGNOSTICS ===');
  let exitCode = 0;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('[NOT RUN] PRIVATE_KEY is not configured in environment. Live diagnostics skipped.');
    process.exit(0);
  }

  try {
    const wallet = new ethers.Wallet(privateKey);
    const funderAddress = process.env.POLY_FUNDER_ADDRESS || wallet.address;
    const signatureType = parseInt(process.env.POLY_SIGNATURE_TYPE || '1', 10);
    console.log(`[PASS] Configured Signer EOA: ${wallet.address}`);
    console.log(`[PASS] Configured Funder Address: ${funderAddress}`);
    console.log(`[PASS] Configured Signature Type: ${signatureType}`);

    const clobClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet,
      signatureType,
      funderAddress
    });

    const creds = await clobClient.createOrDeriveApiKey();
    console.log(`[PASS] Derived L2 API Key: ${creds.key.substring(0, 8)}...`);

    const authClient = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet,
      creds,
      signatureType,
      funderAddress
    });

    const openOrders = await authClient.getOpenOrders();
    console.log(`[PASS] Authenticated CLOB query open orders: ${openOrders.length} active orders found`);

    const userWsPassed = await new Promise<boolean>((resolve) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sigString = `${timestamp}GET/ws/user`;
      const signature = crypto.createHmac('sha256', Buffer.from(creds.secret, 'base64'))
                              .update(sigString)
                              .digest('base64');

      const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user');
      const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          assets: ["user"],
          type: "auth",
          key: creds.key,
          secret: creds.secret,
          passphrase: creds.passphrase,
          timestamp,
          signature
        }));
      });

      ws.on('message', (msg) => {
        const parsed = JSON.parse(msg.toString());
        if (parsed.event === 'auth' && (parsed.status === 'ok' || parsed.status === true)) {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        }
      });

      ws.on('error', () => { clearTimeout(timer); resolve(false); });
    });

    if (userWsPassed) {
      console.log('[PASS] Authenticated L2 User WebSocket channel operational');
    } else {
      console.error('[FAIL] Authenticated L2 User WebSocket failed handshake');
      exitCode = 1;
    }

  } catch (e: any) {
    console.error('[FAIL] Live diagnostics error:', e.message);
    exitCode = 1;
  }

  console.log(`=== LIVE DIAGNOSTICS COMPLETE (Exit Code: ${exitCode}) ===`);
  process.exit(exitCode);
}

runLiveDiagnose();
