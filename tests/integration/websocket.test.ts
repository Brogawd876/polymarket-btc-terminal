import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { setupDb } from '../../apps/server/src/db/index';
import { registerRoutes } from '../../apps/server/src/routes/index';
import { getLocalAuthToken } from '../../apps/server/src/index';

describe('Fastify WebSocket Route Integration', () => {
  let app: ReturnType<typeof Fastify>;
  let serverUrl: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(cors);
    await app.register(fastifyWebsocket);
    setupDb();
    await registerRoutes(app);
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as any;
    serverUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates with valid getLocalAuthToken and receives AUTH_OK', async () => {
    const ws = new WebSocket(serverUrl);
    const authOk = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve(false); }, 4000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: getLocalAuthToken() } }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_OK') {
          clearTimeout(timer);
          resolve(true);
        }
      });
      ws.on('error', () => { clearTimeout(timer); resolve(false); });
    });
    ws.close();
    expect(authOk).toBe(true);
  });

  it('receives SNAPSHOT on SNAPSHOT_REQUEST', async () => {
    const ws = new WebSocket(serverUrl);
    const snapshot = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve(null); }, 4000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: getLocalAuthToken() } }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_OK') {
          ws.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST' }));
        }
        if (msg.type === 'SNAPSHOT') {
          clearTimeout(timer);
          resolve(msg.payload);
        }
      });
      ws.on('error', () => { clearTimeout(timer); resolve(null); });
    });
    ws.close();
    expect(snapshot).toBeDefined();
    expect(snapshot.operationalState).toBeDefined();
    expect(snapshot.readiness).toBeDefined();
  });
});
