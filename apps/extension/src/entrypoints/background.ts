import { defineBackground } from 'wxt/sandbox';
import { WsEventSchema } from '@polymarket-btc/shared';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let isAuthenticated = false;

  let currentToken = '';
  let snapshotState = {
    orders: [],
    positions: [],
    balance: 0,
    settings: { maxLoss: '10', maxProfit: '150' }
  };
  let latestDiscovery: any[] = [];
  let latestRtdsStatus: { connected: boolean } | null = null;
  let latestRtdsUpdate: any | null = null;

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
  const replyHandlers = new Map<string, (response: any) => void>();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'polybtc-ws') {
      ports.add(port);
      port.onDisconnect.addListener(() => {
        ports.delete(port);
      });
      port.postMessage({ type: 'WS_STATUS', payload: isAuthenticated });
      if (isAuthenticated) {
        port.postMessage({ type: 'WS_EVENT', payload: { type: 'SNAPSHOT', payload: snapshotState } });
        if (latestDiscovery.length > 0) {
          port.postMessage({ type: 'WS_EVENT', payload: { type: 'DISCOVERY_UPDATE', payload: latestDiscovery } });
        }
        if (latestRtdsStatus) {
          port.postMessage({ type: 'WS_EVENT', payload: { type: 'RTDS_STATUS', payload: latestRtdsStatus } });
        }
        if (latestRtdsUpdate) {
          port.postMessage({ type: 'WS_EVENT', payload: { type: 'RTDS_UPDATE', payload: latestRtdsUpdate } });
        }
      }
    }
  });

  const broadcast = (message: any) => {
    for (const port of ports) {
      port.postMessage(message);
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
        
        if (parsed.id && replyHandlers.has(parsed.id)) {
           const handler = replyHandlers.get(parsed.id)!;
           handler(parsed);
           replyHandlers.delete(parsed.id);
        }

        const validation = WsEventSchema.safeParse(parsed);
        if (validation.success) {
          const data = validation.data;
          if (data.type === 'AUTH_OK') {
            isAuthenticated = true;
            broadcast({ type: 'WS_STATUS', payload: true });
            ws?.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST' }));
          } else if (data.type === 'AUTH_ERROR') {
            isAuthenticated = false;
            currentToken = ''; 
            ws?.close();
          } else if (data.type === 'SNAPSHOT') {
            snapshotState = data.payload as any;
            broadcast({ type: 'WS_EVENT', payload: data });
            while(messageQueue.length > 0) {
              ws?.send(JSON.stringify(messageQueue.shift()));
            }
          } else if (data.type === 'DISCOVERY_UPDATE') {
            latestDiscovery = data.payload as any[];
            broadcast({ type: 'WS_EVENT', payload: data });
          } else if (data.type === 'RTDS_STATUS') {
            latestRtdsStatus = data.payload as { connected: boolean };
            broadcast({ type: 'WS_EVENT', payload: data });
          } else if (data.type === 'RTDS_UPDATE') {
            latestRtdsUpdate = data.payload;
            latestRtdsStatus = { connected: true };
            broadcast({ type: 'WS_EVENT', payload: data });
          } else {
            broadcast({ type: 'WS_EVENT', payload: data });
          }
        } else {
          console.error('WS validation failed for payload:', parsed, validation.error);
          broadcast({ type: 'DEBUG_ERROR', payload: { parsed, error: validation.error } });
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
    
    if (message.type === 'SEND_WS') {
      if (!message.payload || typeof message.payload.type !== 'string') return;
      
      const payloadWithId = { ...message.payload, id: crypto.randomUUID() };

      if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        ws.send(JSON.stringify(payloadWithId));
      } else {
        messageQueue.push(payloadWithId);
      }
      
      replyHandlers.set(payloadWithId.id, (response) => {
        sendResponse(response);
      });
      return true;
    } else if (message.type === 'GET_WS_STATUS') {
      sendResponse({ connected: isAuthenticated });
    } else if (message.type === 'GET_SNAPSHOT') {
      sendResponse({ snapshot: snapshotState });
    }
  });
});
