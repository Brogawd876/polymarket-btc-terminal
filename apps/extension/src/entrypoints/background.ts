import { defineBackground } from 'wxt/sandbox';
import { createClientCommand, parseServerEvent, protocolVersion, type ClientCommand } from '../protocol';

export default defineBackground(() => {
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let authenticated = false;
  let protocolAccepted = false;
  let token = '';
  let cachedSnapshot: unknown = null;
  let lastMarketSubscription: ClientCommand | null = null;
  const messageQueue: ClientCommand[] = [];
  const ports = new Set<chrome.runtime.Port>();

  const broadcast = (message: unknown) => {
    for (const port of ports) {
      try { port.postMessage(message); }
      catch { ports.delete(port); }
    }
  };

  const reportProtocolError = (message: string) => {
    console.error(`PolyBTC protocol: ${message}`);
    broadcast({ type: 'PROTOCOL_ERROR', payload: { message } });
  };

  const setConnectionStatus = () => {
    const ready = authenticated && protocolAccepted;
    broadcast({ type: 'WS_STATUS', payload: ready });
    if (ready && cachedSnapshot) broadcast({ type: 'WS_EVENT', payload: cachedSnapshot });
  };

  const sendDirect = (input: unknown): boolean => {
    const parsed = createClientCommand(input);
    if (!parsed.success) {
      reportProtocolError(parsed.error);
      return false;
    }
    ws?.send(JSON.stringify(parsed.data));
    return true;
  };

  const flushQueue = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated || !protocolAccepted) return;
    while (messageQueue.length > 0) ws.send(JSON.stringify(messageQueue.shift()));
  };

  const sendWsMessage = (input: unknown): string | null => {
    const parsed = createClientCommand(input);
    if (!parsed.success) {
      reportProtocolError(parsed.error);
      return null;
    }
    const command = parsed.data;
    if (command.type === 'SUBSCRIBE_MARKET' || command.type === 'SELECT_MARKET') lastMarketSubscription = command;
    if (ws?.readyState === WebSocket.OPEN && authenticated && protocolAccepted) ws.send(JSON.stringify(command));
    else if (messageQueue.length < 100) messageQueue.push(command);
    else reportProtocolError('Command queue is full; command was not queued.');
    return command.id;
  };

  const stopKeepAlive = () => {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = null;
  };

  const startKeepAlive = () => {
    stopKeepAlive();
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && authenticated && protocolAccepted) sendDirect({ type: 'PING' });
    }, 20_000);
  };

  const scheduleReconnect = () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connect, 3000);
  };

  const connect = () => {
    ws = new WebSocket('ws://127.0.0.1:3001/ws');

    ws.onopen = () => {
      authenticated = false;
      protocolAccepted = false;
      sendDirect({ type: 'HELLO', payload: { protocolVersion, extensionVersion: chrome.runtime.getManifest().version } });
    };

    ws.onmessage = event => {
      const parsed = parseServerEvent(event.data);
      if (!parsed.success) return reportProtocolError(parsed.error);
      const serverEvent = parsed.data.event;
      if (serverEvent.type === 'HELLO_ACK') {
        token = serverEvent.payload.pairingToken;
        protocolAccepted = true;
        sendDirect({ type: 'AUTH', payload: { token } });
        setConnectionStatus();
        return;
      }
      if (serverEvent.type === 'AUTH_OK') {
        authenticated = true;
        startKeepAlive();
        setConnectionStatus();
        if (lastMarketSubscription) sendWsMessage({ ...lastMarketSubscription, id: crypto.randomUUID() });
        sendWsMessage({ type: 'SNAPSHOT_REQUEST' });
        flushQueue();
        return;
      }
      if (serverEvent.type === 'AUTH_ERROR' || serverEvent.type === 'PROTOCOL_ERROR') {
        reportProtocolError(serverEvent.payload.message);
        token = '';
        ws?.close();
        return;
      }
      if (serverEvent.type === 'PONG') return;
      if (!authenticated || !protocolAccepted) return reportProtocolError('Ignored backend data received before authentication completed.');
      const normalizedEvent = parsed.data.revision !== null && 'payload' in serverEvent && typeof serverEvent.payload === 'object' && serverEvent.payload !== null
        ? { ...serverEvent, payload: { ...serverEvent.payload, revision: parsed.data.revision } }
        : serverEvent;
      if (serverEvent.type === 'TERMINAL_SNAPSHOT' || serverEvent.type === 'SNAPSHOT') cachedSnapshot = normalizedEvent;
      broadcast({ type: 'WS_EVENT', payload: normalizedEvent });
    };

    ws.onclose = () => {
      authenticated = false;
      protocolAccepted = false;
      token = '';
      stopKeepAlive();
      broadcast({ type: 'WS_STATUS', payload: false });
      scheduleReconnect();
    };
    ws.onerror = () => ws?.close();
  };

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'polybtc-ws') return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.postMessage({ type: 'WS_STATUS', payload: authenticated && protocolAccepted });
    if (authenticated && protocolAccepted && cachedSnapshot) port.postMessage({ type: 'WS_EVENT', payload: cachedSnapshot });
    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'SEND_WS') {
        reportProtocolError('Rejected invalid extension port message.');
        return;
      }
      sendWsMessage((message as { payload?: unknown }).payload);
    });
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null) return;
    const typed = message as { type?: unknown; payload?: unknown };
    if (typed.type === 'SEND_WS') {
      const requestId = sendWsMessage(typed.payload);
      sendResponse(requestId ? { status: 'queued', requestId } : { status: 'rejected' });
    } else if (typed.type === 'GET_WS_STATUS') {
      sendResponse({ connected: authenticated && protocolAccepted, protocolVersion });
    }
  });

  connect();
});
