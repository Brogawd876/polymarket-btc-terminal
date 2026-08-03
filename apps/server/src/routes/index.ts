import { FastifyInstance } from 'fastify';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/v1/health', async () => {
    return { status: 'ok' };
  });

  // Example placeholders for actual routes
  app.post('/api/v1/orders', async (request, reply) => {
    // integration with order state machine and Polymarket adapter
    return { id: 'order-123', status: 'pending' };
  });

  app.get('/api/v1/presets', async () => {
    return [];
  });
}
