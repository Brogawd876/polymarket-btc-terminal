import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { closeDb, setupDb } from './db';
import { registerRoutes } from './routes';
import { createTradingAdapter } from './integrations/polymarket/adapters';
import { DiscoveryService } from './integrations/polymarket/discovery';
import { setActiveMarketAnchor } from './integrations/polymarket/rtds';
import crypto from 'crypto';
import type { TradingAdapter } from './integrations/polymarket/adapters/TradingAdapter';
import { getAllowedExtensionOrigin, loadConfig } from './config';
import { stopRtds } from './integrations/polymarket/rtds';

let LOCAL_AUTH_TOKEN = process.env.WS_AUTH_TOKEN && process.env.WS_AUTH_TOKEN.length >= 24
  ? process.env.WS_AUTH_TOKEN
  : undefined;

export function getLocalAuthToken(): string {
  if (!LOCAL_AUTH_TOKEN) {
    const configured = process.env.WS_AUTH_TOKEN;
    LOCAL_AUTH_TOKEN = configured && configured.length >= 24
      ? configured
      : crypto.randomBytes(32).toString('hex');
  }
  return LOCAL_AUTH_TOKEN;
}

export let adapter: TradingAdapter;

const app = Fastify({
  logger: {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.privateKey',
        '*.secret',
        '*.passphrase',
        '*.apiKey',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
  },
});

let db: ReturnType<typeof setupDb>;
let discoveryService: DiscoveryService;
let lastExecutionConditionId: string | null = null;

export async function startServer() {
  try {
    const config = loadConfig();
    await app.register(cors, {
      origin: [getAllowedExtensionOrigin(config)],
      methods: ['GET', 'POST']
    });
    await app.register(rateLimit);
    await app.register(fastifyWebsocket);
    db = setupDb();
    adapter = createTradingAdapter();
    await adapter.initialize();

    discoveryService = new DiscoveryService((markets) => {
      markets.forEach(m => adapter.updateMarketDiscovery(m));
      const currentMarket = markets.find(m => m.type === 'CURRENT');
      if (currentMarket) {
        if (lastExecutionConditionId && lastExecutionConditionId !== currentMarket.conditionId) {
          (globalThis as any).disarmLive?.('MARKET_ROLLOVER');
        }
        lastExecutionConditionId = currentMarket.conditionId;
        setActiveMarketAnchor(currentMarket.conditionId, currentMarket.startTime || Date.now());
        adapter.subscribeToMarket(currentMarket.conditionId, currentMarket.upTokenId, currentMarket.downTokenId);
      }
      const nextMarket = markets.find(m => m.type === 'NEXT');
      if (nextMarket) {
        adapter.subscribeToMarket(nextMarket.conditionId, nextMarket.upTokenId, nextMarket.downTokenId);
        setActiveMarketAnchor(nextMarket.conditionId, nextMarket.startTime || 0);
        if (currentMarket) setActiveMarketAnchor(currentMarket.conditionId, currentMarket.startTime || 0);
      }
      // Discovery is published as part of the atomic revisioned terminal snapshot.
    });

    (global as any).discoveryService = discoveryService;
    discoveryService.start();

    await registerRoutes(app);
    app.post('/api/v1/shutdown', async (request, reply) => {
      const supplied = String(request.headers['x-terminal-shutdown'] || '');
      const expected = String(process.env.TERMINAL_SHUTDOWN_TOKEN || '');
      if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
        return reply.code(401).send({ error: 'Invalid shutdown credential' });
      }
      reply.send({ success: true, message: 'Graceful shutdown started' });
      setTimeout(() => void shutdown('api'), 25);
    });
    const { startRtds } = require('./integrations/polymarket/rtds');
    startRtds(app);
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info({ port: config.PORT, host: config.HOST }, 'Server started');
  } catch (err) {
    app.log.error(err);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  startServer();
}

let shutdownPromise: Promise<void> | null = null;

const shutdown = async (reason: string = 'signal') => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    app.log.info({ reason }, 'Shutting down gracefully');
    try { (globalThis as any).disarmLive?.('SHUTDOWN'); } catch (error) { app.log.warn(error); }
    try {
      const row = db?.prepare("SELECT value FROM settings WHERE key='cancelOnShutdown'").get() as { value?: string } | undefined;
      if (row?.value === 'true' && adapter) {
        const cancellation = await adapter.cancelAll();
        if (cancellation.unresolvedOrderIds.length > 0) {
          app.log.warn({ unresolved: cancellation.unresolvedOrderIds.length }, 'Shutdown cancellation was not fully confirmed');
        }
      }
    } catch (error) { app.log.warn(error); }
    try { discoveryService?.stop(); } catch (error) { app.log.warn(error); }
    try { stopRtds(); } catch (error) { app.log.warn(error); }
    try { if (adapter) await adapter.shutdown(); } catch (error) { app.log.warn(error); }
    try { closeDb(); } catch (error) { app.log.warn(error); }
    try { await app.close(); } catch (error) { app.log.warn(error); }
    if (process.env.NODE_ENV !== 'test') process.exit(0);
  })();
  return shutdownPromise;
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
