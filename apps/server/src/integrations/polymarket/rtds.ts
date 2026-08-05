import WebSocket from 'ws';
import { FastifyInstance } from 'fastify';

let rtdsWs: WebSocket | null = null;
const subscribedTokenIds = new Set<string>();

export const rtdsMetrics = {
  connected: false,
  source_timestamp: 0,
  receive_timestamp: 0,
  current_value: 0,
  price_to_beat: 0,
  difference: 0,
  leading_direction: 'NONE' as 'UP' | 'DOWN' | 'NONE'
};

export function isRtdsStale(): boolean {
  if (!rtdsMetrics.connected) return true;
  if (rtdsMetrics.receive_timestamp === 0) return true; // never received
  const age = Date.now() - rtdsMetrics.receive_timestamp;
  return age > 5000; // 5 seconds threshold
}

// Keep export for API compatibility but do nothing for Chainlink
export function addRtdsSubscription(tokenIds: string[]): void {
  tokenIds.forEach(id => subscribedTokenIds.add(id));
  // In the real Chainlink stream, we may not need to subscribe by token ID
  // But let's send a subscribe just in case if connected
}

export function startRtds(app: FastifyInstance) {
  const url = process.env.CHAINLINK_RTDS_URL || 'wss://ws-live-data.polymarket.com';
  const ws = new WebSocket(url);
  rtdsWs = ws;

  ws.on('open', () => {
    console.log('Connected to Polymarket Chainlink RTDS channel');
    rtdsMetrics.connected = true;
    
    app.websocketServer.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'RTDS_STATUS', payload: { connected: true } }));
      }
    });

    // Send subscribe message (best effort for Polymarket)
    ws.send(JSON.stringify({
      type: 'subscribe',
      topic: 'crypto_prices_chainlink',
      symbols: ['BTC/USD']
    }));
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msgs = JSON.parse(data.toString());
      const msgList = Array.isArray(msgs) ? msgs : (msgs.data && Array.isArray(msgs.data) ? msgs.data : [msgs]);
      
      let updated = false;
      
      for (const msg of msgList) {
        // Handle various payload structures gracefully
        const priceStr = msg?.price || msg?.current_price;
        if (priceStr !== undefined) {
          const price = parseFloat(priceStr);
          if (!isNaN(price)) {
            const previousValue = rtdsMetrics.current_value;
            rtdsMetrics.current_value = price;
            rtdsMetrics.receive_timestamp = Date.now();
            rtdsMetrics.source_timestamp = msg.timestamp || rtdsMetrics.receive_timestamp;
            rtdsMetrics.price_to_beat = previousValue > 0 ? previousValue : price;
            rtdsMetrics.difference = price - rtdsMetrics.price_to_beat;
            if (price > rtdsMetrics.price_to_beat) rtdsMetrics.leading_direction = 'UP';
            else if (price < rtdsMetrics.price_to_beat) rtdsMetrics.leading_direction = 'DOWN';
            else rtdsMetrics.leading_direction = 'NONE';
            
            updated = true;
          }
        }
      }

      if (updated) {
        const dataAge = Date.now() - rtdsMetrics.receive_timestamp;
        const stale = isRtdsStale();
        const broadcastMsg = JSON.stringify({ 
          type: 'RTDS_UPDATE', 
          payload: { 
            price: rtdsMetrics.current_value,
            source_timestamp: rtdsMetrics.source_timestamp,
            data_age: dataAge,
            stale
          } 
        });
        
        app.websocketServer.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMsg);
          }
        });
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    rtdsWs = null;
    rtdsMetrics.connected = false;
    console.log('RTDS WebSocket closed, reconnecting in 5s...');
    
    app.websocketServer.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'RTDS_STATUS', payload: { connected: false } }));
      }
    });

    setTimeout(() => startRtds(app), 5000);
  });

  ws.on('error', (err) => {
    console.error('RTDS WebSocket error', err);
  });
}
