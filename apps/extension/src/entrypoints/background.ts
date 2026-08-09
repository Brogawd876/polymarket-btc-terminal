import { defineBackground } from 'wxt/sandbox';
import { WsEventSchema } from '@polymarket-btc/shared';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let isAuthenticated = false;

  let currentToken = '';
  let snapshotState: any = null;
  let lastMarketSubscription: any = null;

  function startKeepAlive() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);
  }

  function stopKeepAlive() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = null;
  }

  const messageQueue: any[] = [];
  const ports = new Set<chrome.runtime.Port>();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'polybtc-ws') {
      ports.add(port);
      port.onDisconnect.addListener(() => {
        ports.delete(port);
      });

      port.postMessage({ type: 'WS_STATUS', payload: isAuthenticated });
      if (isAuthenticated && snapshotState) {
        port.postMessage({ type: 'WS_EVENT', payload: { type: 'SNAPSHOT', payload: snapshotState } });
      }

      port.onMessage.addListener((message) => {
        if (message.type === 'SEND_WS' && message.payload) {
          sendWsMessage(message.payload);
        }
      });
    }
  });

  const broadcast = (message: any) => {
    for (const port of ports) {
      try {
        port.postMessage(message);
      } catch (e) {
        ports.delete(port);
      }
    }
  };

  const sendWsMessage = (payload: any) => {
    const payloadWithId = { ...payload, id: payload.id || crypto.randomUUID() };
    if (payload.type === 'SUBSCRIBE_MARKET' || payload.type === 'SELECT_MARKET') {
      lastMarketSubscription = payloadWithId;
    }
    if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
      ws.send(JSON.stringify(payloadWithId));
    } else {
      messageQueue.push(payloadWithId);
    }
  };

  const fetchToken = async () => {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/v1/token');
      const data = await res.json();
      return data.token;
    } catch (e) {
      return null;
    }
  };

  const connect = async () => {
    if (!currentToken) {
      const token = await fetchToken();
      if (token) currentToken = token;
      else {
        reconnectTimeout = setTimeout(connect, 3000);
        return;
      }
    }

    ws = new WebSocket('ws://127.0.0.1:3001/ws');

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'AUTH', payload: { token: currentToken } }));
      startKeepAlive();
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const validation = WsEventSchema.safeParse(parsed);
        if (validation.success) {
          const data = validation.data;
          if (data.type === 'AUTH_OK') {
            isAuthenticated = true;
            broadcast({ type: 'WS_STATUS', payload: true });
            if (lastMarketSubscription) {
              ws?.send(JSON.stringify({ ...lastMarketSubscription, id: crypto.randomUUID() }));
            }
            ws?.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST' }));
          } else if (data.type === 'AUTH_ERROR') {
            isAuthenticated = false;
            currentToken = ''; 
            ws?.close();
          } else if (data.type === 'SNAPSHOT') {
            snapshotState = data.payload;
            broadcast({ type: 'WS_EVENT', payload: data });
            while(messageQueue.length > 0) {
              ws?.send(JSON.stringify(messageQueue.shift()));
            }
          } else {
            broadcast({ type: 'WS_EVENT', payload: data });
          }
        } else {
          broadcast({ type: 'WS_EVENT', payload: parsed });
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.onclose = () => {
      isAuthenticated = false;
      stopKeepAlive();
      broadcast({ type: 'WS_STATUS', payload: false });
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connect, 3000);
    };
  };

  connect();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender.id || sender.id !== chrome.runtime.id) return;
    if (message.type === 'SEND_WS' && message.payload) {
      sendWsMessage(message.payload);
      sendResponse({ status: 'queued' });
    } else if (message.type === 'GET_WS_STATUS') {
      sendResponse({ connected: isAuthenticated });
    }
  });
});
