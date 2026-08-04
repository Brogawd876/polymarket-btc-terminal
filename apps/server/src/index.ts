import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { setupDb } from './db';
import { registerRoutes } from './routes';
import { PolymarketAdapter } from './integrations/polymarket/adapter';

export const adapter = new PolymarketAdapter();

const app = Fastify({ logger: true });

let db: ReturnType<typeof setupDb>;

async function start() {
  try {
    await app.register(cors, {
      origin: ['http://localhost', 'http://127.0.0.1'],
      methods: ['GET', 'POST']
    });
    await app.register(rateLimit);
    await app.register(fastifyWebsocket);
    db = setupDb();
    await adapter.initialize();
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
