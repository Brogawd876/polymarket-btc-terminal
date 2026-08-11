import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { closeDb, setupDb } from '../../apps/server/src/db/index';
import { registerRoutes } from '../../apps/server/src/routes/index';
import { getLocalAuthToken } from '../../apps/server/src/index';
import { resetConfigForTests } from '../../apps/server/src/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Fastify WebSocket Route Integration', () => {
  let app: ReturnType<typeof Fastify>;
  let serverUrl: string;
  let tempDir: string;
  const origin = 'chrome-extension://jkpghfeaioigocjjdfeeocfjilhjbdno';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-ws-'));
    process.env.POLYMARKET_DB_PATH = path.join(tempDir, 'terminal.db');
    process.env.WS_AUTH_TOKEN = 'websocket-test-token-at-least-24';
    resetConfigForTests();
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
    closeDb();
    delete process.env.POLYMARKET_DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const command = (type: string, payload?: unknown) => ({ protocolVersion: 3, id: crypto.randomUUID(), type, ...(payload === undefined ? {} : { payload }) });

  const openAuthenticated = (onMessage: (ws: WebSocket, message: any) => void) => {
    const ws = new WebSocket(serverUrl, { headers: { Origin: origin } });
    ws.on('open', () => ws.send(JSON.stringify(command('HELLO', { protocolVersion: 3, extensionVersion: 'test' }))));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'HELLO_ACK') ws.send(JSON.stringify(command('AUTH', { token: message.payload.pairingToken })));
      onMessage(ws, message);
    });
    return ws;
  };

  it('authenticates with the origin-bound pairing token and receives AUTH_OK', async () => {
    let ws: WebSocket;
    const authOk = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve(false); }, 4000);
      ws = openAuthenticated((_socket, msg) => {
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

  it('does not expose the old HTTP token bootstrap endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/token', headers: { origin } });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a WebSocket whose browser origin is not the configured extension', async () => {
    const closeCode = await new Promise<number>((resolve) => {
      const socket = new WebSocket(serverUrl, { headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
      const timer = setTimeout(() => { socket.close(); resolve(0); }, 2000);
      socket.on('close', code => { clearTimeout(timer); resolve(code); });
      socket.on('error', () => undefined);
    });
    expect(closeCode).toBe(1008);
  });

  it('issues a per-session token instead of exposing the process HTTP bearer', async () => {
    let ws: WebSocket;
    const pairingToken = await new Promise<string>((resolve) => {
      ws = new WebSocket(serverUrl, { headers: { Origin: origin } });
      const timer = setTimeout(() => { ws.close(); resolve(''); }, 2000);
      ws.on('open', () => ws.send(JSON.stringify(command('HELLO', { protocolVersion: 3, extensionVersion: 'test' }))));
      ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'HELLO_ACK') {
          clearTimeout(timer);
          resolve(message.payload.pairingToken);
        }
      });
    });
    ws.close();
    expect(pairingToken).toHaveLength(64);
    expect(pairingToken).not.toBe(getLocalAuthToken());
  });

  it('rejects a second HELLO on the same WebSocket session', async () => {
    const closeCode = await new Promise<number>((resolve) => {
      const socket = new WebSocket(serverUrl, { headers: { Origin: origin } });
      const timer = setTimeout(() => { socket.close(); resolve(0); }, 2000);
      socket.on('open', () => socket.send(JSON.stringify(command('HELLO', { protocolVersion: 3, extensionVersion: 'test' }))));
      socket.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'HELLO_ACK') {
          socket.send(JSON.stringify(command('HELLO', { protocolVersion: 3, extensionVersion: 'test' })));
        }
      });
      socket.on('close', code => { clearTimeout(timer); resolve(code); });
      socket.on('error', () => undefined);
    });
    expect(closeCode).toBe(1008);
  });

  it('receives SNAPSHOT on SNAPSHOT_REQUEST', async () => {
    let ws: WebSocket;
    const snapshot = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve(null); }, 4000);
      ws = openAuthenticated((socket, msg) => {
        if (msg.type === 'AUTH_OK') {
          socket.send(JSON.stringify(command('SNAPSHOT_REQUEST')));
        }
        if (msg.type === 'TERMINAL_SNAPSHOT') {
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
