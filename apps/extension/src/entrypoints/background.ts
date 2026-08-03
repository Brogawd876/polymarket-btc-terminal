import { defineBackground } from 'wxt/sandbox';
import { WsEventSchema } from '@polymarket-btc/shared';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout;

  const connect = () => {
    ws = new WebSocket('ws://127.0.0.1:3001/ws');

    ws.onopen = () => {
      chrome.runtime.sendMessage({ type: 'WS_STATUS', payload: true }).catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const validation = WsEventSchema.safeParse(parsed);
        if (validation.success) {
          chrome.runtime.sendMessage({ type: 'WS_EVENT', payload: validation.data }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.onclose = () => {
      chrome.runtime.sendMessage({ type: 'WS_STATUS', payload: false }).catch(() => {});
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connect, 3000);
    };
  };

  connect();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SEND_WS') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message.payload));
      }
    } else if (message.type === 'GET_WS_STATUS') {
      sendResponse({ connected: ws ? ws.readyState === WebSocket.OPEN : false });
    }
  });
});
