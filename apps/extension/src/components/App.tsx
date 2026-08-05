import React, { useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import TradingPanel from './TradingPanel';
import OrdersTab from './OrdersTab';
import PositionsTab from './PositionsTab';
import SettingsTab from './SettingsTab';
import { Maximize2, Minimize2 } from 'lucide-react';

const App: React.FC = () => {
  const { connected, marketInfo, orders, rtdsPrice, sendMessage, balance, realizedPnl, positions } = useWebSocket('ws://localhost:3001/ws');
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'trade' | 'orders' | 'positions' | 'settings' | 'diag'>('trade');

  return (
    <div className={`fixed bottom-4 right-4 bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ${expanded ? 'w-[600px] h-[800px]' : 'w-[320px] h-[500px]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-semibold text-sm">PolyBTC Terminal</span>
          {rtdsPrice && (
            <span className="ml-4 text-xs font-mono text-yellow-400">BTC: {rtdsPrice}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-gray-700 rounded">
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex text-xs bg-gray-800 border-b border-gray-700">
        {(['trade', 'orders', 'positions', 'settings', 'diag'] as const).map(tab => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-center uppercase tracking-wider ${activeTab === tab ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:bg-gray-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4 bg-gray-900">
        {activeTab === 'trade' && <TradingPanel marketInfo={marketInfo} sendMessage={sendMessage} orders={orders} />}
        {activeTab === 'orders' && <OrdersTab orders={orders} />}
        {activeTab === 'positions' && <PositionsTab positions={positions} balance={balance} realizedPnl={realizedPnl} marketInfo={marketInfo} />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'diag' && (
           <div className="text-xs font-mono">
             <div>WS Connected: {connected.toString()}</div>
             <div>Market: {marketInfo?.marketId || 'N/A'}</div>
           </div>
        )}
      </div>
    </div>
  );
};

export default App;
