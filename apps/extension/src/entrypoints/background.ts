import { defineBackground } from 'wxt/sandbox';
import { WsEventSchema } from '@polymarket-btc/shared';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  function startKeepAlive() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
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
      port.postMessage({ type: 'WS_STATUS', payload: ws !== null && ws.readyState === WebSocket.OPEN });
    }
  });

  const broadcast = (message: any) => {
    for (const port of ports) {
      port.postMessage(message);
    }
  };

  const connect = () => {
    ws = new WebSocket('ws://127.0.0.1:3001/ws');

    ws.onopen = () => {
      // Authenticate with local server immediately
      ws?.send(JSON.stringify({ type: 'AUTH', token: 'polymarket-local-secret' }));
      startKeepAlive();
      broadcast({ type: 'WS_STATUS', payload: true });
      
      // Flush message queue
      while(messageQueue.length > 0) {
        ws?.send(JSON.stringify(messageQueue.shift()));
      }
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const validation = WsEventSchema.safeParse(parsed);
        if (validation.success) {
          broadcast({ type: 'WS_EVENT', payload: validation.data });
        } else {
          console.error('WS validation failed for payload:', parsed, validation.error);
          broadcast({ type: 'DEBUG_ERROR', payload: { parsed, error: validation.error } });
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.onclose = () => {
      stopKeepAlive();
      broadcast({ type: 'WS_STATUS', payload: false });
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connect, 3000);
    };
  };

  connect();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only accept messages from extension pages/content scripts
    if (!sender.id || sender.id !== chrome.runtime.id) return;
    if (message.type === 'SEND_WS') {
      // Validate payload shape
      if (!message.payload || typeof message.payload.type !== 'string') return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message.payload));
      } else {
        messageQueue.push(message.payload);
      }
    } else if (message.type === 'GET_WS_STATUS') {
      sendResponse({ connected: ws ? ws.readyState === WebSocket.OPEN : false });
    } else if (message.type === 'GET_BALANCE') {
      fetch('http://127.0.0.1:3001/api/balance')
        .then(r => r.json())
        .then(data => sendResponse({ balance: data.balance ?? 0 }))
        .catch(() => sendResponse({ balance: 0 }));
      return true; // keep message channel open for async response
    }
  });
});
