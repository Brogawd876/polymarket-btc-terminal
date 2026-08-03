import Fastify from 'fastify';
import pino from 'pino';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { setupDb } from './db';
import { registerRoutes } from './routes';

const app = Fastify({ logger: true });

async function start() {
  try {
    await app.register(cors);
    await app.register(rateLimit);
    setupDb();
    await registerRoutes(app);
    await app.listen({ port: 3001, host: '127.0.0.1' });
    app.log.info('Server started on port 3001');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();
