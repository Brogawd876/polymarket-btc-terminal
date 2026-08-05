import { FastifyInstance } from 'fastify';
import { adapter, LOCAL_AUTH_TOKEN } from '../index';
import { getDb } from '../db/index';
import { z } from 'zod';
import { SocketStream } from '@fastify/websocket';
import { addRtdsSubscription, isRtdsStale } from '../integrations/polymarket/rtds';

const PlaceOrderSchema = z.object({
  tokenId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().regex(/^0\.(\d+)$/).refine(v => parseFloat(v) > 0 && parseFloat(v) < 1),
  size: z.string().refine(v => parseFloat(v) > 0 && parseFloat(v) <= 1000),
  orderType: z.enum(['GTC', 'FAK', 'FOK']).optional()
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

  app.get('/api/v1/token', async () => {
    return { token: LOCAL_AUTH_TOKEN };
  });

  app.get('/api/v1/presets', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM presets').all() as any[];
    if (rows.length === 0) {
      const crypto = require('crypto');
      const defaults = [
        // 5 Buy Presets
        { id: crypto.randomUUID(), name: 'Match Ask', config: JSON.stringify({ side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: 0, active: true }) },
        { id: crypto.randomUUID(), name: '1c under ask', config: JSON.stringify({ side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: -1, active: true }) },
        { id: crypto.randomUUID(), name: '15% under ask', config: JSON.stringify({ side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -15, active: true }) },
        { id: crypto.randomUUID(), name: '20% under ask', config: JSON.stringify({ side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -20, active: true }) },
        { id: crypto.randomUUID(), name: '50% under ask', config: JSON.stringify({ side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -50, active: true }) },
        
        // 5 Sell Presets
        { id: crypto.randomUUID(), name: 'Match Bid', config: JSON.stringify({ side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0, active: true }) },
        { id: crypto.randomUUID(), name: '1c over bid', config: JSON.stringify({ side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 1, active: true }) },
        { id: crypto.randomUUID(), name: '15% over bid', config: JSON.stringify({ side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 15, active: true }) },
        { id: crypto.randomUUID(), name: '20% over bid', config: JSON.stringify({ side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 20, active: true }) },
        { id: crypto.randomUUID(), name: '50% over bid', config: JSON.stringify({ side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 50, active: true }) },
      ];
      const insert = db.prepare('INSERT INTO presets (id, name, config) VALUES (?, ?, ?)');
      defaults.forEach(d => insert.run(d.id, d.name, d.config));
      return defaults.map(d => ({ id: d.id, name: d.name, ...JSON.parse(d.config) }));
    }
    return rows.map(r => ({ id: r.id, name: r.name, ...JSON.parse(r.config) }));
  });

  app.post('/api/v1/presets', async (request, reply) => {
    const db = getDb();
    const crypto = require('crypto');
    const body = request.body as any;
    const id = crypto.randomUUID();
    const { name, ...config } = body;
    db.prepare('INSERT INTO presets (id, name, config) VALUES (?, ?, ?)').run(id, name, JSON.stringify(config));
    return { id, name, ...config };
  });

  app.put('/api/v1/presets/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const { name, ...config } = body;
    db.prepare('UPDATE presets SET name = ?, config = ? WHERE id = ?').run(name, JSON.stringify(config), id);
    return { id, name, ...config };
  });

  app.delete('/api/v1/presets/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as { id: string };
    db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    return { success: true };
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
        const db = getDb();
        
        if (payload.type === 'AUTH') {
          const expectedToken = LOCAL_AUTH_TOKEN;
          if (payload.payload.token === expectedToken && expectedToken !== undefined) {
            isAuthenticated = true;
            clearTimeout(authTimeout);
            connection.socket.send(JSON.stringify({ type: 'AUTH_OK', id: payload.id }));
          } else {
            connection.socket.send(JSON.stringify({ type: 'AUTH_ERROR', payload: { message: 'Invalid token' }, id: payload.id }));
            connection.socket.close();
          }
          return;
        }

        if (payload.type === 'SNAPSHOT_REQUEST') {
          if (!isAuthenticated) return;
          const orders = db.prepare(`SELECT * FROM orders WHERE status IN ('PENDING', 'OPEN', 'NEW')`).all() as any[];
          const positions = db.prepare(`
            SELECT tokenId as asset, side, SUM(CAST(size AS REAL)) as size, AVG(CAST(price AS REAL)) as entry
            FROM orders
            WHERE status = 'FILLED'
            GROUP BY tokenId, side
          `).all() as any[];
          const balance = await adapter.getBalance();
          
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
          const realizedPnl = stats?.pnl ?? 0;

          connection.socket.send(JSON.stringify({
            type: 'SNAPSHOT',
            id: payload.id,
            payload: {
              orders,
              positions,
              balance,
              realizedPnl,
              settings: {
                maxLoss: process.env.MAX_SESSION_LOSS || '10',
                maxProfit: process.env.MAX_SESSION_PROFIT || '150'
              }
            }
          }));
          return;
        }

        if (payload.type === 'PLACE_ORDER') {
          if (!isAuthenticated) return;
          
          if (payload.id) {
            const existing = db.prepare(`SELECT response FROM idempotency WHERE requestId = ?`).get(payload.id) as any;
            if (existing) {
              connection.socket.send(existing.response);
              return;
            }
          }
          
          const now = Date.now();
          if (now - lastOrderTime < 1000) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Rate limit: max 1 order per second', id: payload.id }));
            return;
          }
          lastOrderTime = now;

          const validation = PlaceOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters', id: payload.id }));
            return;
          }

          if (isRtdsStale()) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Trading blocked: RTDS reference price is stale or disconnected', id: payload.id }));
            return;
          }

          const { tokenId, side, size, price, orderType } = validation.data;
          
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
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session max loss of $${maxLoss} reached. Trading halted.`, id: payload.id }));
            return;
          }
          if (sessionPnl >= maxProfit) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: `Session profit target of $${maxProfit} reached. Trading halted.`, id: payload.id }));
            return;
          }

          try {
            const order = await adapter.placeOrder(tokenId, side, size, price, orderType);
            db.prepare(`INSERT INTO orders (id, tokenId, side, price, size, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(order.id, order.tokenId, order.side, String(order.price), String(order.size), order.status, Date.now());
            
            const responseMsg = JSON.stringify({ 
               type: 'ORDER_UPDATE', 
               id: payload.id,
               payload: order 
            });
            if (payload.id) {
              db.prepare(`INSERT INTO idempotency (requestId, response, createdAt) VALUES (?, ?, ?)`).run(payload.id, responseMsg, Date.now());
            }
            connection.socket.send(responseMsg);
          } catch (err: any) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: err.message, id: payload.id }));
          }
        }
        else if (payload.type === 'CANCEL_ORDER') {
          if (!isAuthenticated) return;
          
          if (payload.id) {
            const existing = db.prepare(`SELECT response FROM idempotency WHERE requestId = ?`).get(payload.id) as any;
            if (existing) {
              connection.socket.send(existing.response);
              return;
            }
          }
          
          const validation = CancelOrderSchema.safeParse(payload.payload);
          if (!validation.success) {
            connection.socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid order parameters', id: payload.id }));
            return;
          }

          const { orderId } = validation.data;
          const success = await adapter.cancelOrder(orderId);
          if (success) {
            db.prepare(`UPDATE orders SET status='CANCELLED' WHERE id=?`).run(orderId);
          }
          const responseMsg = JSON.stringify({ type: 'ORDER_UPDATE', id: payload.id, payload: { id: orderId, status: success ? 'CANCELLED' : 'ERROR' } });
          if (payload.id) {
            db.prepare(`INSERT INTO idempotency (requestId, response, createdAt) VALUES (?, ?, ?)`).run(payload.id, responseMsg, Date.now());
          }
          connection.socket.send(responseMsg);
        }
        else if (payload.type === 'UPDATE_SETTINGS') {
          if (!isAuthenticated) return;
          if (payload.payload.maxLoss) process.env.MAX_SESSION_LOSS = payload.payload.maxLoss;
          if (payload.payload.maxProfit) process.env.MAX_SESSION_PROFIT = payload.payload.maxProfit;
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
