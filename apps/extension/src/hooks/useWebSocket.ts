import { useState, useEffect, useCallback } from 'react';
import { 
  WsEventSchema,
  type WsEvent, 
  type Order, 
  type MarketState 
} from '@polymarket-btc/shared';

export function useWebSocket(url: string) {
  const [connected, setConnected] = useState(false);
  const [marketInfo, setMarketInfo] = useState<MarketState | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, (response) => {
      if (response && typeof response.connected === 'boolean') {
        setConnected(response.connected);
      }
    });

    const listener = (message: any) => {
      if (message.type === 'WS_STATUS') {
        setConnected(message.payload);
      } else if (message.type === 'WS_EVENT') {
        const data = message.payload;
        if (data.type === 'MARKET_UPDATE') setMarketInfo(data.payload);
        if (data.type === 'ORDER_UPDATE') {
          setOrders(prev => {
            const idx = prev.findIndex(o => o.id === data.payload.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data.payload;
              return next;
            }
            return [...prev, data.payload];
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const sendMessage = useCallback((msg: any) => {
    chrome.runtime.sendMessage({ type: 'SEND_WS', payload: msg })?.catch(() => {});
  }, []);

  return { connected, marketInfo, orders, sendMessage };
}
