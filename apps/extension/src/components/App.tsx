import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Maximize2, Minimize2, Minus, PanelLeft, PanelRight } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  saveUiPreferences,
  type ActiveTab,
  type UiPreferences,
} from '../uiPreferences';
import TradingPanel from './TradingPanel';
import OrdersTab from './OrdersTab';
import PositionsTab from './PositionsTab';
import SettingsTab from './SettingsTab';

const App: React.FC = () => {
  const terminal = useWebSocket('ws://127.0.0.1:3001/ws');
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [pageHref, setPageHref] = useState(window.location.href);

  useEffect(() => {
    loadUiPreferences().then(value => {
      setPreferences(value);
      setPreferencesLoaded(true);
    }).catch(() => setPreferencesLoaded(true));
  }, []);

  useEffect(() => {
    if (preferencesLoaded) saveUiPreferences(preferences).catch(console.error);
  }, [preferences, preferencesLoaded]);

  useEffect(() => {
    const interval = setInterval(() => setPageHref(window.location.href), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && terminal.readiness?.liveArmed) terminal.sendMessage({ type: 'DISARM_LIVE' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [terminal.readiness?.liveArmed, terminal.sendMessage]);

  const updatePreferences = useCallback((patch: Partial<UiPreferences>) => {
    setPreferences(current => ({ ...current, ...patch }));
  }, []);

  const openOrders = useMemo(
    () => terminal.orders.filter(order => !['CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED'].includes(order.status)),
    [terminal.orders],
  );
  const collapsed = preferences.panelMode === 'collapsed';
  const expanded = preferences.panelMode === 'expanded';
  const sideClass = preferences.dockSide === 'left' ? 'left-4' : 'right-4';
  const panelWidth = collapsed ? 260 : expanded ? Math.max(420, preferences.width) : preferences.width;
  const panelHeight = collapsed ? 42 : expanded ? 'min(750px, calc(100vh - 2rem))' : 'min(580px, calc(100vh - 2rem))';

  return (
    <div
      style={{ pointerEvents: 'auto', width: panelWidth, height: panelHeight }}
      className={`fixed bottom-4 ${sideClass} bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden flex flex-col transition-[width,height] duration-200 max-w-[calc(100vw-2rem)]`}
    >
      <div className="flex items-center justify-between p-2.5 bg-gray-800 border-b border-gray-700 font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${terminal.operationalState === 'LIVE_ARMED' ? 'bg-green-500' : terminal.operationalState === 'LIVE_DISARMED' ? 'bg-yellow-500' : terminal.operationalState === 'READ_ONLY' ? 'bg-blue-500' : 'bg-red-500'}`} />
          <span className="font-bold text-xs truncate">{collapsed ? 'BTC 5M' : 'BTC 5M TERMINAL'}</span>
          {!collapsed && terminal.rtdsPrice && <span className="text-[10px] text-yellow-400">BTC: ${terminal.rtdsPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>}
        </div>
        <div className="flex gap-1">
          <button onClick={() => updatePreferences({ dockSide: preferences.dockSide === 'left' ? 'right' : 'left' })} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title={`Dock panel ${preferences.dockSide === 'left' ? 'right' : 'left'}`}>
            {preferences.dockSide === 'left' ? <PanelRight size={14} /> : <PanelLeft size={14} />}
          </button>
          <button onClick={() => updatePreferences({ panelMode: collapsed ? 'compact' : 'collapsed' })} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title={collapsed ? 'Restore compact panel' : 'Collapse panel'}>
            <Minus size={14} />
          </button>
          <button onClick={() => updatePreferences({ panelMode: expanded ? 'compact' : 'expanded' })} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white" title={expanded ? 'Use compact panel' : 'Expand panel'}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && <div className="flex text-[10px] bg-gray-800 border-b border-gray-700 font-mono">
        {(['trade', 'orders', 'positions', 'settings', 'diag'] as ActiveTab[]).map(tab => (
          <button key={tab} onClick={() => updatePreferences({ activeTab: tab })} className={`flex-1 py-2 text-center uppercase tracking-wider font-bold ${preferences.activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>
            {tab}
          </button>
        ))}
      </div>}

      {!collapsed && <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
        {preferences.activeTab === 'trade' && (
          <TradingPanel
            operationalState={terminal.operationalState}
            readiness={terminal.readiness}
            marketInfo={terminal.marketInfo}
            discoveredMarkets={terminal.discoveredMarkets}
            sendMessage={terminal.sendMessage}
            orders={terminal.orders}
            positions={terminal.positions}
            presets={terminal.presets}
            quotes={terminal.quotes}
            rtdsMetrics={terminal.rtdsMetrics}
            balance={terminal.balance}
            pageHref={pageHref}
            pageFollow={preferences.pageFollow}
            executionMode={preferences.executionMode}
            setExecutionMode={executionMode => updatePreferences({ executionMode })}
            backendError={terminal.lastError}
            lastResult={terminal.lastResult}
            lastResponseId={terminal.lastResponseId}
            lastResponseType={terminal.lastResponseType}
            clearBackendError={terminal.clearLastError}
          />
        )}
        {preferences.activeTab === 'orders' && <OrdersTab orders={terminal.orders} sendMessage={terminal.sendMessage} />}
        {preferences.activeTab === 'positions' && <PositionsTab positions={terminal.positions} balance={terminal.balance} realizedPnl={terminal.realizedPnl} marketInfo={terminal.marketInfo} />}
        {preferences.activeTab === 'settings' && <SettingsTab presets={terminal.presets} settings={terminal.settings} sendMessage={terminal.sendMessage} preferences={preferences} updatePreferences={updatePreferences} />}
        {preferences.activeTab === 'diag' && (
          <div className="text-[10px] font-mono flex flex-col gap-2 text-gray-300">
            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">SYSTEM DIAGNOSTICS</div>
              <div>Backend Connected: <span className={terminal.connected ? 'text-green-400' : 'text-red-400'}>{String(terminal.connected)}</span></div>
              <div>Protocol Revision: <span>{terminal.revision}</span></div>
              <div>Operational State: <span className="text-yellow-400 font-bold">{terminal.operationalState}</span></div>
              <div>Live Armed: <span className={terminal.readiness?.liveArmed ? 'text-green-400 font-bold' : 'text-red-400'}>{terminal.readiness?.liveArmed ? 'TRUE' : 'FALSE'}</span></div>
              <div>Account Authenticated: <span>{(terminal.readiness?.accountAuthenticated ?? terminal.account?.authenticated) ? 'YES' : 'NO'}</span></div>
              <div>User Stream Connected: <span>{terminal.readiness?.userStreamConnected ? 'YES' : 'NO'}</span></div>
              <div>Open Orders: <span>{openOrders.length}</span></div>
            </div>
            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">MARKET METRICS</div>
              <div>Market ID: {terminal.marketInfo?.marketId || 'N/A'}</div>
              <div>Title: {terminal.marketInfo?.title || 'N/A'}</div>
              <div>Target End: {terminal.marketInfo?.targetTime ? new Date(terminal.marketInfo.targetTime).toLocaleTimeString() : 'N/A'}</div>
              <div>Tick Size: {terminal.marketInfo?.tickSize || '0.01'}</div>
              <div>Min Order Size: {terminal.marketInfo?.minimumOrderSize || '5'}</div>
            </div>
            <div className="bg-gray-800 p-2 rounded border border-gray-700 flex flex-col gap-1">
              <div className="font-bold text-gray-200 uppercase">BLOCKING REASONS ({terminal.readiness?.blockingReasons.length || 0})</div>
              {terminal.readiness?.blockingReasons.map((reason, index) => <div key={index} className="text-red-400 text-[9px]">{reason}</div>)}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
};

export default App;
