import { FastifyInstance } from 'fastify';
import { adapter } from '../index';
import { getDb } from '../db/index';
import { z } from 'zod';
import { SocketStream } from '@fastify/websocket';
import { addRtdsSubscription } from '../integrations/polymarket/rtds';

const PlaceOrderSchema = z.object({
  tokenId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().regex(/^0\.(\d+)$/).refine(v => parseFloat(v) > 0 && parseFloat(v) < 1),
  size: z.string().refine(v => parseFloat(v) > 0 && parseFloat(v) <= 1000)
});

const CancelOrderSchema = z.object({
  orderId: z.string().min(1)
});

const SubscribeMarketSchema = z.object({
  conditionId: z.string().min(1),
  yesTokenId: z.string().min(1),
  noTokenId: z.string().min(1),
});

const getMaxLoss = () => parseFloat(process.env.MAX_SESSION_LOSS || '10');
const getMaxProfit = () => parseFloat(process.env.MAX_SESSION_PROFIT || '150');

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/v1/health', async () => {
    return { status: 'ok' };
  });

  app.get('/api/v1/presets', async () => {
    return [];
  });

  app.delete('/api/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const success = await adapter.cancelOrder(id);
      if (success) {
        const db = getDb();
        db.prepare(`UPDATE orders SET status='CANCELLED' WHERE id=?`).run(id);
      }
      return { success, id };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.get('/api/balance', async () => {
    const balance = await adapter.getBalance();
    return { balance };
  });

  app.get('/api/positions', async () => {
    const db = getDb();
    // Simplified positions query grouping by token/side based on filled orders
    const rows = db.prepare(`
      SELECT tokenId as asset, side, SUM(CAST(size AS REAL)) as size, AVG(CAST(price AS REAL)) as entry
      FROM orders
      WHERE status = 'FILLED'
      GROUP BY tokenId, side
    `).all() as any[];
    return rows;
  });

  app.get('/api/settings', async () => {
    return {
      maxLoss: process.env.MAX_SESSION_LOSS || '10',
      maxProfit: process.env.MAX_SESSION_PROFIT || '150'
    };
  });

  app.post('/api/settings', async (request, reply) => {
    const body = request.body as any;
    if (body.maxLoss) process.env.MAX_SESSION_LOSS = body.maxLoss;
    if (body.maxProfit) process.env.MAX_SESSION_PROFIT = body.maxProfit;
    return { success: true };
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
          console.log('Sending MARKET_UPDATE to client:', state);
          // Send formatted for the extension hook expectation
          connection.socket.send(JSON.stringify({ 
            type: 'MARKET_UPDATE', 
            payload: state 
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
          const expectedToken = process.env.WS_AUTH_TOKEN;
          if (payload.token === expectedToken && expectedToken !== undefined) {
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

          const { tokenId, side, size, price } = validation.data;
          
          const db = getDb();
          const sessionStart = new Date();
          sessionStart.setHours(0, 0, 0, 0);
          
          const stats = db.prepare(`
            SELECT SUM(
              CASE 
                WHEN f.side = 'SELL' THEN (CAST(f.price AS REAL) - COALESCE(CAST(p.avgPrice AS REAL), 0)) * CAST(f.size AS REAL) 
                ELSE 0 
              END
            ) as pnl 
            FROM fills f
            LEFT JOIN positions p ON f.tokenId = p.tokenId
            WHERE f.createdAt >= ?
          `).get(sessionStart.getTime()) as { pnl: number | null };
          const sessionPnl = stats?.pnl ?? 0;
          const maxLoss = getMaxLoss();
          const maxProfit = getMaxProfit();
          if (sessionPnl <= -maxLoss) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session max loss of $${maxLoss} reached. Trading halted.` }));
            return;
          }
          if (sessionPnl >= maxProfit) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session profit target of $${maxProfit} reached. Trading halted.` }));
            return;
          }

          try {
            const order = await adapter.placeOrder(tokenId, side, size, price);
            const db = getDb();
            db.prepare(`INSERT INTO orders (id, tokenId, side, price, size, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(order.id, order.tokenId, order.side, String(order.price), String(order.size), order.status, Date.now());
            connection.socket.send(JSON.stringify({ 
               type: 'ORDER_UPDATE', 
               payload: order 
            }));
          } catch (err: any) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
          }
        }
        else if (payload.type === 'CANCEL_ORDER') {
          if (!isAuthenticated) return;
          
          const validation = CancelOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters' }));
            return;
          }

          const { orderId } = validation.data;
          const success = await adapter.cancelOrder(orderId);
          if (success) {
            const db = getDb();
            db.prepare(`UPDATE orders SET status='CANCELLED' WHERE id=?`).run(orderId);
          }
          connection.socket.send(JSON.stringify({ type: 'ORDER_UPDATE', payload: { id: orderId, status: success ? 'CANCELLED' : 'ERROR' } }));
        }
        else if (payload.type === 'SUBSCRIBE_MARKET') {
          if (!isAuthenticated) return;
          
          const validation = SubscribeMarketSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid market ID' }));
            return;
          }
          
          activeMarketId = validation.data.conditionId;
          adapter.subscribeToMarket(validation.data.conditionId, validation.data.yesTokenId, validation.data.noTokenId);
          addRtdsSubscription([validation.data.yesTokenId, validation.data.noTokenId]);
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
