import { useCallback, useEffect, useReducer } from 'react';
import { createClientCommand, parseServerEvent } from '../protocol';
import { initialTerminalState, terminalReducer } from '../terminalState';

export function useWebSocket(_url: string) {
  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);

  useEffect(() => {
    let port: chrome.runtime.Port;
    try { port = chrome.runtime.connect({ name: 'polybtc-ws' }); }
    catch {
      dispatch({ type: 'PROTOCOL_ERROR', message: 'Could not connect to the extension background service.' });
      return;
    }

    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        dispatch({ type: 'PROTOCOL_ERROR', message: 'Rejected invalid background message.' });
        return;
      }
      const typed = message as { type?: unknown; payload?: unknown };
      if (typed.type === 'WS_STATUS' && typeof typed.payload === 'boolean') {
        dispatch({ type: 'CONNECTION', connected: typed.payload });
      } else if (typed.type === 'PROTOCOL_ERROR' && typeof typed.payload === 'object' && typed.payload !== null) {
        const text = (typed.payload as { message?: unknown }).message;
        dispatch({ type: 'PROTOCOL_ERROR', message: typeof text === 'string' ? text : 'Protocol error.' });
      } else if (typed.type === 'WS_EVENT') {
        const parsed = parseServerEvent(typed.payload);
        if (parsed.success) dispatch({ type: 'SERVER_EVENT', parsed: parsed.data });
        else dispatch({ type: 'PROTOCOL_ERROR', message: parsed.error });
      } else {
        dispatch({ type: 'PROTOCOL_ERROR', message: 'Rejected unknown background message.' });
      }
    });
    return () => port.disconnect();
  }, []);

  const sendMessage = useCallback((input: unknown): string | null => {
    const parsed = createClientCommand(input);
    if (!parsed.success) {
      dispatch({ type: 'PROTOCOL_ERROR', message: parsed.error });
      return null;
    }
    chrome.runtime.sendMessage({ type: 'SEND_WS', payload: parsed.data })?.catch(() => {
      dispatch({ type: 'PROTOCOL_ERROR', message: 'Background service did not accept the command.' });
    });
    return parsed.data.id;
  }, []);

  const clearLastError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);
  return { ...state, clearLastError, sendMessage };
}
