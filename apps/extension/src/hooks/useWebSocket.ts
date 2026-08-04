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
  const [rtdsPrice, setRtdsPrice] = useState<string | null>(null);

  useEffect(() => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'polybtc-ws' });
    } catch (e) {
      console.error('Failed to connect port:', e);
      return;
    }

    port.onMessage.addListener((message: any) => {
      console.log('useWebSocket received message via port:', message);
      if (message.type === 'WS_STATUS') {
        setConnected(message.payload);
      } else if (message.type === 'DEBUG_ERROR') {
        console.error('BACKGROUND SCRIPT VALIDATION FAILED:', message.payload);
      } else if (message.type === 'WS_EVENT') {
        const data = message.payload;
        if (data.type === 'MARKET_UPDATE') setMarketInfo(data.payload);
        if (data.type === 'RTDS_UPDATE') setRtdsPrice(data.payload.price);
        if (data.type === 'ORDER_UPDATE') {
          setOrders(prev => {
            const exists = prev.find(o => o.id === data.payload.id);
            if (exists) return prev.map(o => o.id === data.payload.id ? data.payload : o);
            return [data.payload, ...prev];
          });
        }
      }
    });

    return () => port.disconnect();
  }, []);

  const sendMessage = useCallback((msg: any) => {
    chrome.runtime.sendMessage({ type: 'SEND_WS', payload: msg })?.catch(() => {});
  }, []);

  return { connected, marketInfo, orders, rtdsPrice, sendMessage };
}
