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
  const [discoveredMarkets, setDiscoveredMarkets] = useState<MarketState[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [settings, setSettings] = useState({ maxLoss: '10', maxProfit: '150' });
  const [balance, setBalance] = useState<number>(0);
  const [realizedPnl, setRealizedPnl] = useState<number>(0);
  const [rtdsPrice, setRtdsPrice] = useState<number | null>(null);
  const [rtdsMetrics, setRtdsMetrics] = useState<any>({ connected: false, stale: true, data_age: 0 });

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
        if (data.type === 'SNAPSHOT') {
          setOrders(data.payload.orders || []);
          setPositions(data.payload.positions || []);
          setSettings(data.payload.settings || { maxLoss: '10', maxProfit: '150' });
          if (data.payload.balance !== undefined) setBalance(data.payload.balance);
          if (data.payload.realizedPnl !== undefined) setRealizedPnl(data.payload.realizedPnl);
        }
        if (data.type === 'MARKET_UPDATE') {
           setMarketInfo(data.payload);
           setDiscoveredMarkets(prev => {
             const idx = prev.findIndex(m => m.marketId === data.payload.marketId);
             if (idx >= 0) {
               const newArr = [...prev];
               newArr[idx] = data.payload;
               return newArr;
             }
             return prev;
           });
        }
        if (data.type === 'DISCOVERY_UPDATE') setDiscoveredMarkets(data.payload);
        if (data.type === 'RTDS_STATUS') {
          setRtdsMetrics((prev: any) => ({ ...prev, connected: data.payload.connected }));
        }
        if (data.type === 'RTDS_UPDATE') {
          setRtdsPrice(data.payload.price);
          setRtdsMetrics((prev: any) => ({
            ...prev,
            connected: true,
            stale: data.payload.stale,
            data_age: data.payload.data_age
          }));
        }
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

  useEffect(() => {
    if (!connected) return;

    let cancelled = false;

    const refreshBalance = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3001/api/balance');
        if (!res.ok) return;

        const data = await res.json();
        if (!cancelled && typeof data.balance === 'number') {
          setBalance(data.balance);
        }
      } catch {
        // Balance is also provided by snapshots; ignore transient polling failures.
      }
    };

    refreshBalance();
    const interval = setInterval(refreshBalance, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected]);

  const sendMessage = useCallback((msg: any) => {
    chrome.runtime.sendMessage({ type: 'SEND_WS', payload: msg })?.catch(() => {});
  }, []);

  return { connected, marketInfo, discoveredMarkets, orders, positions, settings, balance, realizedPnl, rtdsPrice, rtdsMetrics, sendMessage };
}
