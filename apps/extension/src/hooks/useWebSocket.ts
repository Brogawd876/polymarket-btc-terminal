import { useState, useEffect, useCallback } from 'react';
import { 
  type Order, 
  type MarketState,
  type LiveReadiness,
  type OperationalState,
  type AccountState,
  type PresetConfig,
  type MarketAnchor,
  type Position
} from '@polymarket-btc/shared';

export function useWebSocket(url: string) {
  const [connected, setConnected] = useState(false);
  const [operationalState, setOperationalState] = useState<OperationalState>('OFFLINE');
  const [readiness, setReadiness] = useState<LiveReadiness | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [marketInfo, setMarketInfo] = useState<MarketState | null>(null);
  const [discoveredMarkets, setDiscoveredMarkets] = useState<MarketState[]>([]);
  const [anchor, setAnchor] = useState<MarketAnchor | null>(null);
  const [referenceData, setReferenceData] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [balance, setBalance] = useState<number>(0);
  const [realizedPnl, setRealizedPnl] = useState<number>(0);
  const [rtdsPrice, setRtdsPrice] = useState<number | null>(null);
  const [rtdsMetrics, setRtdsMetrics] = useState<any>({ connected: false, stale: true, dataAgeMs: 0 });
  const [lastError, setLastError] = useState<string>('');

  useEffect(() => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: 'polybtc-ws' });
    } catch (e) {
      console.error('Failed to connect extension port:', e);
      return;
    }

    port.onMessage.addListener((message: any) => {
      if (message.type === 'WS_STATUS') {
        setConnected(message.payload);
        if (!message.payload) {
          setOperationalState('OFFLINE');
          setReadiness(null);
          setMarketInfo(null);
          setAnchor(null);
          setRtdsPrice(null);
          setRtdsMetrics({ connected: false, stale: true, dataAgeMs: 0 });
          setLastError('Backend connection lost. Reconnecting...');
        } else {
          setLastError('');
        }
      } else if (message.type === 'WS_EVENT') {
        const data = message.payload;
        if (data.type === 'SNAPSHOT') {
          setLastError('');
          if (data.payload.operationalState) setOperationalState(data.payload.operationalState);
          if (data.payload.readiness) setReadiness(data.payload.readiness);
          if (data.payload.account) setAccount(data.payload.account);
          if (data.payload.market) setMarketInfo(data.payload.market);
          if (data.payload.markets) setDiscoveredMarkets(data.payload.markets);
          if (data.payload.anchor) setAnchor(data.payload.anchor);
          if (data.payload.orders) setOrders(data.payload.orders);
          if (data.payload.positions) setPositions(data.payload.positions);
          if (data.payload.presets) setPresets(data.payload.presets);
          if (data.payload.settings) setSettings(data.payload.settings);
          if (data.payload.balance !== undefined) setBalance(data.payload.balance);
          if (data.payload.realizedPnl !== undefined) setRealizedPnl(data.payload.realizedPnl);
        }
        else if (data.type === 'READINESS_UPDATED') {
          setReadiness(data.payload);
          if (data.payload.liveArmed) setOperationalState('LIVE_ARMED');
          else setOperationalState('LIVE_DISARMED');
        }
        else if (data.type === 'MARKET_UPDATE' || data.type === 'MARKET_UPDATED') {
          setMarketInfo(data.payload);
          if (data.payload.operationalState) setOperationalState(data.payload.operationalState);
          if (data.payload.readiness) setReadiness(data.payload.readiness);
          if (data.payload.positions) setPositions(data.payload.positions);
          if (data.payload.orders) setOrders(data.payload.orders);
          if (data.payload.balance !== undefined) setBalance(data.payload.balance);
          if (data.payload.markets) {
            setDiscoveredMarkets(data.payload.markets);
          } else {
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
        }
        else if (data.type === 'DISCOVERY_UPDATE') {
          setDiscoveredMarkets(data.payload);
        }
        else if (data.type === 'REFERENCE_UPDATED') {
          setReferenceData(data.payload);
          setRtdsPrice(data.payload.currentPrice);
          setRtdsMetrics({
            connected: data.payload.connected,
            stale: data.payload.stale,
            dataAgeMs: data.payload.dataAgeMs,
            currentPrice: data.payload.currentPrice,
            priceToBeat: data.payload.priceToBeat,
            difference: data.payload.difference,
            leadingOutcome: data.payload.leadingOutcome,
          });
        }
        else if (data.type === 'ORDER_UPDATE' || data.type === 'ORDER_UPDATED') {
          setLastError('');
          setOrders(prev => {
            const exists = prev.find(o => o.id === data.payload.id);
            if (exists) return prev.map(o => o.id === data.payload.id ? data.payload : o);
            return [data.payload, ...prev];
          });
        }
        else if (data.type === 'POSITION_UPDATED') {
          setPositions(prev => {
            const idx = prev.findIndex(p => p.tokenId === data.payload.tokenId);
            if (idx >= 0) {
              const newArr = [...prev];
              newArr[idx] = data.payload;
              return newArr;
            }
            return [data.payload, ...prev];
          });
        }
        else if (data.type === 'ACCOUNT_UPDATED') {
          setAccount(data.payload);
          if (data.payload.collateralBalance !== undefined) setBalance(data.payload.collateralBalance);
        }
        else if (data.type === 'ERROR') {
          setLastError(data.payload?.message || data.error || 'Backend rejected the request.');
        }
      }
    });

    return () => port.disconnect();
  }, []);

  const sendMessage = useCallback((msg: any) => {
    chrome.runtime.sendMessage({ type: 'SEND_WS', payload: msg })?.catch(() => {});
  }, []);

  const clearLastError = useCallback(() => setLastError(''), []);

  return { 
    connected, 
    operationalState,
    readiness, 
    account,
    marketInfo, 
    discoveredMarkets, 
    anchor,
    referenceData,
    orders, 
    positions, 
    presets,
    settings, 
    balance, 
    realizedPnl, 
    rtdsPrice, 
    rtdsMetrics, 
    lastError,
    clearLastError,
    sendMessage 
  };
}
