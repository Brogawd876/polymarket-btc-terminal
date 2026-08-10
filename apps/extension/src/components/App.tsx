import React, { useEffect, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import TradingPanel from './TradingPanel';
import OrdersTab from './OrdersTab';
import PositionsTab from './PositionsTab';
import SettingsTab from './SettingsTab';
import { Maximize2, Minimize2, Minus } from 'lucide-react';

const App: React.FC = () => {
  const { 
    connected, 
    operationalState,
    readiness, 
    account,
    marketInfo, 
    discoveredMarkets, 
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
  } = useWebSocket('ws://127.0.0.1:3001/ws');

  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'trade' | 'orders' | 'positions' | 'settings' | 'diag'>('trade');
  const [pageHref, setPageHref] = useState(window.location.href);

  useEffect(() => {
    const interval = setInterval(() => setPageHref(window.location.href), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const parsePriceToBeat = () => {
      const lines = document.body.innerText.split('\n').map(line => line.trim()).filter(Boolean);
      const labelIndex = lines.findIndex(line => /^Price To Beat$/i.test(line));
      if (labelIndex < 0) return null;
      for (const line of lines.slice(labelIndex + 1, labelIndex + 6)) {
        const match = line.match(/\$?([0-9,]+\.\d{2,})/);
        if (match) return match[1].replace(/,/g, '');
      }
      return null;
    };

    const reportPageAnchor = () => {
      const slug = window.location.href.match(/\/event\/([^/?#]+)/)?.[1] || '';
      const priceToBeat = parsePriceToBeat();
      if (!slug || !priceToBeat) return;
      sendMessage({
        type: 'PAGE_ANCHOR_UPDATE',
        payload: { slug, priceToBeat },
      });
    };

    reportPageAnchor();
    const interval = setInterval(reportPageAnchor, 2000);
    return () => clearInterval(interval);
  }, [pageHref, sendMessage]);

  return (
    <div style={{ pointerEvents: 'auto' }} className={`fixed bottom-4 right-4 bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden flex flex-col transition-all duration-300 max-w-[calc(100vw-2rem)] ${minimized ? 'w-[260px] h-[42px]' : expanded ? 'w-[420px] h-[min(750px,calc(100vh-2rem))]' : 'w-[360px] h-[min(580px,calc(100vh-2rem))]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-2.5 bg-gray-800 border-b border-gray-700 font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${
            operationalState === 'LIVE_ARMED' ? 'bg-green-500' :
            operationalState === 'LIVE_DISARMED' ? 'bg-yellow-500' :
            operationalState === 'READ_ONLY' ? 'bg-blue-500' : 'bg-red-500'
          }`} />
          <span className="font-bold text-xs truncate">{minimized ? 'BTC 5M' : 'BTC 5M TERMINAL'}</span>
          {!minimized && rtdsPrice && (
            <span className="text-[10px] text-yellow-400">BTC: ${rtdsPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMinimized(!minimized)} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title={minimized ? 'Restore panel' : 'Minimize panel'}>
            <Minus size={14} />
          </button>
          <button onClick={() => { setMinimized(false); setExpanded(!expanded); }} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title={expanded ? 'Compact panel' : 'Expand panel'}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      {!minimized && <div className="flex text-[10px] bg-gray-800 border-b border-gray-700 font-mono">
        {(['trade', 'orders', 'positions', 'settings', 'diag'] as const).map(tab => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-center uppercase tracking-wider font-bold ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>}

      {/* Content Area */}
      {!minimized && <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
        {activeTab === 'trade' && (
          <TradingPanel
            operationalState={operationalState}
            readiness={readiness}
            marketInfo={marketInfo}
            discoveredMarkets={discoveredMarkets}
            sendMessage={sendMessage}
            orders={orders}
            positions={positions}
            presets={presets}
            rtdsMetrics={rtdsMetrics}
            balance={balance}
            pageHref={pageHref}
            backendError={lastError}
            clearBackendError={clearLastError}
          />
        )}
        {activeTab === 'orders' && <OrdersTab orders={orders} sendMessage={sendMessage} />}
        {activeTab === 'positions' && <PositionsTab positions={positions} balance={balance} realizedPnl={realizedPnl} marketInfo={marketInfo} />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'diag' && (
          <div className="text-[10px] font-mono flex flex-col gap-2 text-gray-300">
            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">SYSTEM DIAGNOSTICS</div>
              <div>Backend Connected: <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected.toString()}</span></div>
              <div>Operational State: <span className="text-yellow-400 font-bold">{operationalState}</span></div>
              <div>Live Armed: <span className={readiness?.liveArmed ? 'text-green-400 font-bold' : 'text-red-400'}>{readiness?.liveArmed ? 'TRUE' : 'FALSE'}</span></div>
              <div>Account Authenticated: <span>{(readiness?.accountAuthenticated ?? account?.authenticated) ? 'YES' : 'NO'}</span></div>
              <div>User Stream Connected: <span>{readiness?.userStreamConnected ? 'YES' : 'NO'}</span></div>
            </div>

            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">MARKET METRICS</div>
              <div>Market ID: {marketInfo?.marketId || 'N/A'}</div>
              <div>Title: {marketInfo?.title || 'N/A'}</div>
              <div>Target End: {marketInfo?.targetTime ? new Date(marketInfo.targetTime).toLocaleTimeString() : 'N/A'}</div>
              <div>Tick Size: {marketInfo?.tickSize || '0.01'}</div>
              <div>Min Order Size: {marketInfo?.minimumOrderSize || '5'}</div>
            </div>

            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">BLOCKING REASONS ({readiness?.blockingReasons.length || 0})</div>
              {readiness?.blockingReasons.map((r, i) => (
                <div key={i} className="text-red-400 text-[9px]">• {r}</div>
              ))}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
};

export default App;
