import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { setupDb } from './db';
import { registerRoutes } from './routes';
import { createTradingAdapter } from './integrations/polymarket/adapters';
import { DiscoveryService } from './integrations/polymarket/discovery';
import crypto from 'crypto';
import type { TradingAdapter } from './integrations/polymarket/adapters/TradingAdapter';

export let LOCAL_AUTH_TOKEN = process.env.WS_AUTH_TOKEN;
if (!LOCAL_AUTH_TOKEN) {
  LOCAL_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
}

export let adapter: TradingAdapter;

const app = Fastify({ logger: true });

let db: ReturnType<typeof setupDb>;
let discoveryService: DiscoveryService;

async function start() {
  try {
    await app.register(cors, {
      origin: [
        'http://localhost',
        'http://127.0.0.1',
        /^chrome-extension:\/\//,
        /^https?:\/\/(.*?\.)?polymarket\.com$/
      ],
      methods: ['GET', 'POST']
    });
    await app.register(rateLimit);
    await app.register(fastifyWebsocket);
    db = setupDb();
    adapter = createTradingAdapter();
    await adapter.initialize();

    discoveryService = new DiscoveryService((markets) => {
      markets.forEach(m => adapter.updateMarketDiscovery(m));
      console.log(`Broadcasting DISCOVERY_UPDATE to ${app.websocketServer.clients.size} clients`);
      for (const client of app.websocketServer.clients) {
        if (client.readyState === 1) { // WebSocket.OPEN is usually 1
           client.send(JSON.stringify({
             type: 'DISCOVERY_UPDATE',
             payload: markets
           }));
        }
      }
    });

    (global as any).discoveryService = discoveryService;
    discoveryService.start();

    await registerRoutes(app);
    const { startRtds } = require('./integrations/polymarket/rtds');
    startRtds(app);
    await app.listen({ port: 3001, host: '127.0.0.1' });
    app.log.info('Server started on port 3001');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();

const shutdown = async () => {
  console.log('Shutting down gracefully...');
  try { adapter.shutdown(); } catch(e) {}
  try { if (db) db.close(); } catch(e) {}
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
