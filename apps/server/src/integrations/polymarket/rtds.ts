import WebSocket from 'ws';
import { FastifyInstance } from 'fastify';

let rtdsWs: WebSocket | null = null;
const subscribedTokenIds = new Set<string>();

export function addRtdsSubscription(tokenIds: string[]): void {
  tokenIds.forEach(id => subscribedTokenIds.add(id));
  if (rtdsWs && rtdsWs.readyState === WebSocket.OPEN && tokenIds.length > 0) {
    rtdsWs.send(JSON.stringify({
      assets_ids: tokenIds,
      type: 'market'
    }));
  }
}

export function startRtds(app: FastifyInstance) {
  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
  rtdsWs = ws;

  ws.on('open', () => {
    console.log('Connected to Polymarket RTDS market channel');
    // Re-subscribe all known token IDs on reconnect
    if (subscribedTokenIds.size > 0) {
      ws.send(JSON.stringify({
        assets_ids: Array.from(subscribedTokenIds),
        type: 'market'
      }));
    }
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msgs = JSON.parse(data.toString());
      const msgList = Array.isArray(msgs) ? msgs : (msgs.data && Array.isArray(msgs.data) ? msgs.data : [msgs]);
      for (const msg of msgList) {
        if (msg && msg.price !== undefined) {
          const broadcastMsg = JSON.stringify({ type: 'RTDS_UPDATE', payload: { asset_id: msg.asset_id, price: msg.price } });
          app.websocketServer.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(broadcastMsg);
            }
          });
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    rtdsWs = null;
    console.log('RTDS WebSocket closed, reconnecting in 5s...');
    setTimeout(() => startRtds(app), 5000);
  });

  ws.on('error', (err) => {
    console.error('RTDS WebSocket error', err);
  });
}
