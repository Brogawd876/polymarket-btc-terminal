import Fastify from 'fastify';
import pino from 'pino';
import { setupDb } from './db';
import { registerRoutes } from './routes';

const app = Fastify({ logger: true });

async function start() {
  try {
    setupDb();
    await registerRoutes(app);
    await app.listen({ port: 3001, host: '0.0.0.0' });
    app.log.info('Server started on port 3001');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
start();
