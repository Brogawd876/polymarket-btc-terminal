import { FastifyInstance } from 'fastify';
import { adapter } from '../index.js';
import { getDb } from '../db/index.js';
import { z } from 'zod';
import { SocketStream } from '@fastify/websocket';

const PlaceOrderSchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().regex(/^0\.(\d+)$/).refine(v => parseFloat(v) > 0 && parseFloat(v) < 1),
  size: z.string().refine(v => parseFloat(v) > 0 && parseFloat(v) <= 1000)
});

const MAX_LOSS = parseFloat(process.env.MAX_SESSION_LOSS || '10');
const MAX_PROFIT = parseFloat(process.env.MAX_SESSION_PROFIT || '150');

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

  app.get('/ws', { websocket: true }, (connection: SocketStream, req) => {
    let activeMarketId: string | null = null;
    let isAuthenticated = false;
    let lastOrderTime = 0;

    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) connection.socket.close();
    }, 2000);
    
    // Polling mechanism to bridge adapter's cached MarketState to the WS client
    const intervalId = setInterval(async () => {
      if (activeMarketId) {
        try {
          const state = await adapter.getMarketState(activeMarketId);
          // Send formatted for the extension hook expectation
          connection.socket.send(JSON.stringify({ 
            type: 'WS_EVENT', 
            payload: { type: 'MARKET_UPDATE', payload: state } 
          }));
        } catch (err) {
          // Ignore error if market is not yet cached or stale
        }
      }
    }, 1000);

    connection.socket.on('message', async (message: any) => {
      try {
        const payload = JSON.parse(message.toString());
        
        if (payload.type === 'AUTH') {
          if (payload.token === process.env.WS_AUTH_TOKEN) {
            isAuthenticated = true;
            clearTimeout(authTimeout);
          } else {
            connection.socket.close();
          }
          return;
        }

        if (payload.type === 'PLACE_ORDER') {
          if (!isAuthenticated) return;
          
          const now = Date.now();
          if (now - lastOrderTime < 1000) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Rate limit: max 1 order per second' }));
            return;
          }
          lastOrderTime = now;

          const validation = PlaceOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters' }));
            return;
          }

          const { marketId, side, size, price } = validation.data;
          
          const db = getDb();
          const sessionStart = new Date();
          sessionStart.setHours(0, 0, 0, 0);
          const stats = db.prepare(`SELECT SUM(CASE WHEN status='FILLED' AND side='BUY' THEN -CAST(price AS REAL)*CAST(size AS REAL) WHEN status='FILLED' AND side='SELL' THEN CAST(price AS REAL)*CAST(size AS REAL) ELSE 0 END) as pnl FROM orders WHERE createdAt >= ?`).get(sessionStart.toISOString()) as { pnl: number };
          const sessionPnl = stats?.pnl ?? 0;
          if (sessionPnl <= -MAX_LOSS) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session max loss of $${MAX_LOSS} reached. Trading halted.` }));
            return;
          }
          if (sessionPnl >= MAX_PROFIT) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session profit target of $${MAX_PROFIT} reached. Trading halted.` }));
            return;
          }

          try {
            const order = await adapter.placeOrder(marketId, side, size, price);
            const db = getDb();
            db.prepare(`INSERT OR REPLACE INTO orders (id, marketId, side, price, size, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(order.id, order.marketId, order.side, String(order.price), String(order.size), order.status, new Date().toISOString());
            connection.socket.send(JSON.stringify({ 
               type: 'WS_EVENT', 
               payload: { type: 'ORDER_UPDATE', payload: order } 
            }));
          } catch (err: any) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
          }
        }
        else if (payload.type === 'CANCEL_ORDER') {
          const { orderId } = payload.payload;
          const success = await adapter.cancelOrder(orderId);
          if (success) {
            const db = getDb();
            db.prepare(`UPDATE orders SET status='CANCELLED' WHERE id=?`).run(orderId);
          }
          connection.socket.send(JSON.stringify({ type: 'ORDER_UPDATE', payload: { id: orderId, status: success ? 'CANCELLED' : 'ERROR' } }));
        }
        else if (payload.type === 'SUBSCRIBE_MARKET') {
          activeMarketId = payload.payload.marketId;
        }
      } catch (err: any) {
        connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
      }
    });

    connection.socket.on('close', () => {
      clearInterval(intervalId);
    });
  });
}
