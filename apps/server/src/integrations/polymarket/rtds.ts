import WebSocket from 'ws';
import { FastifyInstance } from 'fastify';
import { MarketAnchor } from '@polymarket-btc/shared';
import { getDb } from '../../db';

const RTDS_STALE_AFTER_MS = 5000;
const RTDS_RECONNECT_MS = 3000;
const RTDS_HEARTBEAT_MS = 5000;

let rtdsWs: WebSocket | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let running = false;
let generation = 0;

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

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  let numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (numeric < 10_000_000_000) return Math.round(numeric * 1000);
  while (numeric > 10_000_000_000_000) numeric /= 1000;
  return Math.round(numeric);
}

function sourceAgeMs(now = Date.now()): number {
  return rtdsMetrics.sourceTimestamp > 0
    ? Math.max(0, now - rtdsMetrics.sourceTimestamp)
    : Number.MAX_SAFE_INTEGER;
}

export function isRtdsStale(): boolean {
  return !rtdsMetrics.connected || sourceAgeMs() > RTDS_STALE_AFTER_MS;
}

export function setActiveMarketAnchor(conditionId: string, windowStart: number, _initialPrice?: string): MarketAnchor {
  activeConditionId = conditionId;
  let anchor = marketAnchors.get(conditionId);

  if (!anchor) {
    try {
      const row = getDb().prepare('SELECT * FROM anchors WHERE conditionId=? AND windowStart=?').get(conditionId, windowStart) as any;
      if (row) {
        const restored = { ...row, validated: Boolean(row.validated) } as MarketAnchor;
        anchor = restored;
        marketAnchors.set(conditionId, restored);
      }
    } catch {}
  }

  if (!anchor) {
    anchor = {
      conditionId,
      windowStart,
      value: '0',
      sourceTimestamp: 0,
      validated: false,
    };
    marketAnchors.set(conditionId, anchor);
    persistAnchor(anchor);
  }

  return anchor;
}

export function setPageMarketAnchor(conditionId: string, windowStart: number, priceToBeat: string): MarketAnchor {
  void priceToBeat;
  return setActiveMarketAnchor(conditionId, windowStart);
}

export function getMarketAnchor(conditionId: string): MarketAnchor | undefined {
  return marketAnchors.get(conditionId);
}

export function getRtdsMetrics() {
  const age = sourceAgeMs();
  const stale = !rtdsMetrics.connected || age > RTDS_STALE_AFTER_MS;
  rtdsMetrics.dataAgeMs = age;
  rtdsMetrics.stale = stale;

  let priceToBeat = '0';
  let difference = 0;
  let leadingOutcome: 'UP' | 'DOWN' | undefined;

  if (activeConditionId) {
    const anchor = marketAnchors.get(activeConditionId);
    if (anchor?.validated) {
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
    receiveTimestamp: rtdsMetrics.receiveTimestamp,
    dataAgeMs: age,
    connected: rtdsMetrics.connected,
    stale,
    staleReason: !rtdsMetrics.connected
      ? 'RTDS_DISCONNECTED'
      : stale
        ? 'RTDS_SOURCE_STALE'
        : undefined,
    priceToBeat,
    difference,
    leadingOutcome,
  };
}

export function startRtds(app: FastifyInstance): void {
  running = true;
  const currentGeneration = ++generation;
  clearReconnectTimer();
  closeSocket();
  rtdsMetrics.connected = false;
  rtdsMetrics.stale = true;

  const url = process.env.CHAINLINK_RTDS_URL || 'wss://ws-live-data.polymarket.com';
  const ws = new WebSocket(url);
  rtdsWs = ws;

  ws.on('open', () => {
    if (!running || currentGeneration !== generation) return;
    console.log('Connected to Polymarket Chainlink RTDS channel');
    rtdsMetrics.connected = true;
    startHeartbeat(ws);
    ws.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{
        topic: 'crypto_prices_chainlink',
        type: '*',
        filters: JSON.stringify({ symbol: 'btc/usd' }),
      }],
    }));
  });

  ws.on('message', (data: WebSocket.RawData) => {
    if (!running || currentGeneration !== generation) return;
    try {
      const raw = data.toString();
      if (raw === 'PONG' || raw === 'PING') return;
      const messages = JSON.parse(raw);
      const messageList = Array.isArray(messages)
        ? messages
        : messages.data && Array.isArray(messages.data)
          ? messages.data
          : [messages];
      let updated = false;

      for (const message of messageList) {
        const priceValue = getPriceValue(message);
        const sourceTimestamp = getSourceTimestamp(message);
        const price = Number(priceValue);
        if (!Number.isFinite(price) || price <= 0 || !sourceTimestamp) continue;
        if (sourceTimestamp <= rtdsMetrics.sourceTimestamp) continue;

        rtdsMetrics.currentPrice = price;
        rtdsMetrics.receiveTimestamp = Date.now();
        rtdsMetrics.sourceTimestamp = sourceTimestamp;
        for (const anchor of marketAnchors.values()) {
          if (!anchor.validated && sourceTimestamp >= anchor.windowStart && sourceTimestamp <= anchor.windowStart + 5000) {
            anchor.value = String(price);
            anchor.sourceTimestamp = sourceTimestamp;
            anchor.validated = true;
            anchor.source = 'CHAINLINK_WINDOW';
            anchor.observedAt = Date.now();
            anchor.validationMethod = 'WINDOW_OPEN_TICK';
            anchor.validationEvidence = JSON.stringify({ sourceTimestamp, windowStart: anchor.windowStart });
            persistAnchor(anchor);
          }
        }
        updated = true;
      }

      if (updated) {
        getRtdsMetrics();
      }
    } catch {
      // The feed can include non-JSON heartbeat noise.
    }
  });

  ws.on('close', () => {
    if (rtdsWs === ws) rtdsWs = null;
    stopHeartbeat();
    rtdsMetrics.connected = false;
    rtdsMetrics.stale = true;
    if (!running || currentGeneration !== generation) return;

    console.log('RTDS WebSocket closed, reconnecting in 3s...');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (running && currentGeneration === generation) startRtds(app);
    }, RTDS_RECONNECT_MS);
  });

  ws.on('error', (error) => {
    console.error('RTDS WebSocket error', error);
  });
}

function persistAnchor(anchor: MarketAnchor): void {
  try {
    getDb().prepare(`INSERT INTO anchors
      (conditionId,windowStart,value,sourceTimestamp,validated,source,observedAt,validationMethod,validationEvidence)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conditionId) DO UPDATE SET windowStart=excluded.windowStart,value=excluded.value,
        sourceTimestamp=excluded.sourceTimestamp,validated=excluded.validated,source=excluded.source,
        observedAt=excluded.observedAt,validationMethod=excluded.validationMethod,validationEvidence=excluded.validationEvidence`)
      .run(anchor.conditionId, anchor.windowStart, anchor.value, anchor.sourceTimestamp, anchor.validated ? 1 : 0,
        anchor.source || null, anchor.observedAt || null, anchor.validationMethod || null, anchor.validationEvidence || null);
  } catch {}
}

export function stopRtds(): void {
  running = false;
  generation += 1;
  clearReconnectTimer();
  stopHeartbeat();
  closeSocket();
  rtdsMetrics.connected = false;
  rtdsMetrics.stale = true;
}

function closeSocket(): void {
  const socket = rtdsWs;
  rtdsWs = null;
  if (!socket) return;
  socket.removeAllListeners();
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startHeartbeat(ws: WebSocket): void {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('PING');
  }, RTDS_HEARTBEAT_MS);
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
  return normalizeTimestamp(msg?.payload?.timestamp ?? msg?.payload?.source_timestamp ?? msg?.timestamp);
}
