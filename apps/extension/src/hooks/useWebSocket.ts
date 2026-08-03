import { useState, useEffect, useCallback, useRef } from 'react';
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
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      ws.current = new WebSocket(url);

      ws.current.onopen = () => setConnected(true);
      
      ws.current.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const validation = WsEventSchema.safeParse(parsed);
          if (!validation.success) {
            console.error('Invalid WS message payload', validation.error);
            return;
          }
          const data = validation.data;
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
        } catch (e) {
          console.error('Failed to parse WS message', e);
        }
      };

      ws.current.onclose = () => {
        setConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, [url]);

  const sendMessage = useCallback((msg: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, marketInfo, orders, sendMessage };
}
