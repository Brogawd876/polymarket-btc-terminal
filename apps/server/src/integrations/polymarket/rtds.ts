import WebSocket from 'ws';
import { FastifyInstance } from 'fastify';
import { MarketAnchor } from '@polymarket-btc/shared';

let rtdsWs: WebSocket | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

export const rtdsMetrics = {
  connected: false,
  currentPrice: 0,
  sourceTimestamp: 0,
  receiveTimestamp: 0,
  stale: true,
  dataAgeMs: 0,
};

const marketAnchors = new Map<string, MarketAnchor>();
let activeConditionId: string | null = null;

export function isRtdsStale(): boolean {
  if (!rtdsMetrics.connected) return true;
  if (rtdsMetrics.receiveTimestamp === 0) return true;
  const age = Date.now() - rtdsMetrics.receiveTimestamp;
  return age > 5000;
}

export function setActiveMarketAnchor(conditionId: string, windowStart: number, initialPrice?: string): MarketAnchor {
  activeConditionId = conditionId;
  let anchor = marketAnchors.get(conditionId);

  if (!anchor) {
    const val = initialPrice && parseFloat(initialPrice) > 0 
      ? initialPrice 
      : (rtdsMetrics.currentPrice > 0 ? String(rtdsMetrics.currentPrice) : '0');

    anchor = {
      conditionId,
      windowStart,
      value: val,
      sourceTimestamp: rtdsMetrics.sourceTimestamp || Date.now(),
      validated: parseFloat(val) > 0
    };
    marketAnchors.set(conditionId, anchor);
  }

  return anchor;
}

export function getMarketAnchor(conditionId: string): MarketAnchor | undefined {
  return marketAnchors.get(conditionId);
}

export function getRtdsMetrics() {
  const age = rtdsMetrics.receiveTimestamp > 0 ? Date.now() - rtdsMetrics.receiveTimestamp : 999999;
  const stale = !rtdsMetrics.connected || age > 5000;

  let priceToBeat = '0';
  let difference = 0;
  let leadingOutcome: 'UP' | 'DOWN' | undefined = undefined;

  if (activeConditionId) {
    const anchor = marketAnchors.get(activeConditionId);
    if (anchor && anchor.validated) {
      priceToBeat = anchor.value;
      const beatVal = parseFloat(anchor.value);
      if (rtdsMetrics.currentPrice > 0 && beatVal > 0) {
        difference = rtdsMetrics.currentPrice - beatVal;
        if (difference > 0) leadingOutcome = 'UP';
        else if (difference < 0) leadingOutcome = 'DOWN';
      }
    }
  }

  return {
    currentPrice: rtdsMetrics.currentPrice,
    sourceTimestamp: rtdsMetrics.sourceTimestamp,
    dataAgeMs: age,
    connected: rtdsMetrics.connected,
    stale,
    priceToBeat,
    difference,
    leadingOutcome,
  };
}

export function startRtds(app: FastifyInstance) {
  const url = process.env.CHAINLINK_RTDS_URL || 'wss://ws-live-data.polymarket.com';
  const ws = new WebSocket(url);
  rtdsWs = ws;

  ws.on('open', () => {
    console.log('Connected to Polymarket Chainlink RTDS channel');
    rtdsMetrics.connected = true;
    startHeartbeat(ws);
    
    app.websocketServer.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'RTDS_STATUS', payload: { connected: true } }));
      }
    });

    ws.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [
        {
          topic: 'crypto_prices_chainlink',
          type: '*',
          filters: JSON.stringify({ symbol: 'btc/usd' })
        }
      ]
    }));
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msgs = JSON.parse(data.toString());
      const msgList = Array.isArray(msgs) ? msgs : (msgs.data && Array.isArray(msgs.data) ? msgs.data : [msgs]);
      
      let updated = false;
      
      for (const msg of msgList) {
        const priceStr = getPriceValue(msg);
        if (priceStr !== undefined) {
          const price = parseFloat(String(priceStr));
          if (!isNaN(price) && price > 0) {
            rtdsMetrics.currentPrice = price;
            rtdsMetrics.receiveTimestamp = Date.now();
            rtdsMetrics.sourceTimestamp = getSourceTimestamp(msg) || rtdsMetrics.receiveTimestamp;
            rtdsMetrics.stale = false;
            rtdsMetrics.dataAgeMs = Date.now() - rtdsMetrics.receiveTimestamp;

            if (activeConditionId) {
              const anchor = marketAnchors.get(activeConditionId);
              if (anchor && (!anchor.validated || parseFloat(anchor.value) <= 0)) {
                anchor.value = String(price);
                anchor.sourceTimestamp = rtdsMetrics.sourceTimestamp;
                anchor.validated = true;
              }
            }

            updated = true;
          }
        }
      }

      if (updated) {
        const metrics = getRtdsMetrics();
        const broadcastMsg = JSON.stringify({ 
          type: 'REFERENCE_UPDATED', 
          payload: metrics 
        });
        
        app.websocketServer.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMsg);
          }
        });
      }
    } catch (e) {
      // Ignore parse noise
    }
  });

  ws.on('close', () => {
    rtdsWs = null;
    rtdsMetrics.connected = false;
    rtdsMetrics.stale = true;
    stopHeartbeat();
    console.log('RTDS WebSocket closed, reconnecting in 3s...');
    
    app.websocketServer.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'RTDS_STATUS', payload: { connected: false } }));
      }
    });

    setTimeout(() => startRtds(app), 3000);
  });

  ws.on('error', (err) => {
    console.error('RTDS WebSocket error', err);
  });
}

function startHeartbeat(ws: WebSocket): void {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('PING');
    }
  }, 5000);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function getPriceValue(msg: any): string | number | undefined {
  return msg?.payload?.value
    ?? msg?.payload?.price
    ?? msg?.payload?.current_price
    ?? msg?.value
    ?? msg?.price
    ?? msg?.current_price;
}

function getSourceTimestamp(msg: any): number | undefined {
  const timestamp = msg?.payload?.timestamp ?? msg?.timestamp;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp === 'string') {
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric)) return numeric;

    const parsed = new Date(timestamp).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}
