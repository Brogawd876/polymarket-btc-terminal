import React, { useState } from 'react';
import type { Order } from '@polymarket-btc/shared';

interface Props {
  orders: Order[];
  sendMessage: (msg: any) => void;
}

const OrdersTab: React.FC<Props> = ({ orders = [], sendMessage }) => {
  const [activeTab, setActiveTab] = useState<'OPEN' | 'HISTORY'>('OPEN');
  
  const activeOrders = orders.filter(o => ['LIVE', 'ACCEPTED', 'PARTIALLY_FILLED', 'PENDING', 'SUBMITTING', 'CANCEL_PENDING'].includes(o.status));
  const historyOrders = orders.filter(o => !['LIVE', 'ACCEPTED', 'PARTIALLY_FILLED', 'PENDING', 'SUBMITTING', 'CANCEL_PENDING'].includes(o.status));

  const handleCancelOrder = (orderId: string) => {
    sendMessage({
      type: 'CANCEL_ORDER',
      id: crypto.randomUUID(),
      payload: { orderId }
    });
  };

  const handleCancelAll = () => {
    sendMessage({
      type: 'CANCEL_ALL',
      id: crypto.randomUUID()
    });
  };

  const displayOrders = activeTab === 'OPEN' ? activeOrders : historyOrders;

  return (
    <div className="flex flex-col gap-3 text-xs font-sans">
      <div className="flex bg-gray-900 rounded p-1 shadow-inner border border-gray-700">
        <button 
          onClick={() => setActiveTab('OPEN')}
          className={`flex-1 py-1.5 rounded font-bold text-[11px] transition-colors ${
            activeTab === 'OPEN' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          OPEN ({activeOrders.length})
        </button>
        <button 
          onClick={() => setActiveTab('HISTORY')}
          className={`flex-1 py-1.5 rounded font-bold text-[11px] transition-colors ${
            activeTab === 'HISTORY' ? 'bg-gray-800 text-white shadow' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          HISTORY ({historyOrders.length})
        </button>
      </div>

      {activeTab === 'OPEN' && activeOrders.length > 0 && (
        <button 
          onClick={handleCancelAll}
          className="bg-red-800/80 hover:bg-red-700 text-white border border-red-500/50 p-2 rounded font-bold uppercase tracking-wider shadow text-center"
        >
          CANCEL ALL OPEN ORDERS
        </button>
      )}

      {displayOrders.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No {activeTab.toLowerCase()} orders</div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayOrders.map(order => {
            const isPending = ['PENDING', 'SUBMITTING', 'CANCEL_PENDING'].includes(order.status);
            const isOpen = ['LIVE', 'ACCEPTED', 'PARTIALLY_FILLED'].includes(order.status);

            return (
              <div 
                key={order.id} 
                className={`p-2.5 rounded border flex justify-between items-center font-mono ${
                  isOpen ? 'bg-gray-800 border-gray-700' : 'bg-gray-900/60 border-gray-800 text-gray-400'
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{order.side}</span>
                    <span className="text-white">{order.outcome || 'UP'}</span>
                    <span className="text-yellow-400">@{order.price}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">
                    SIZE: {order.size} sh | FILLED: {order.filledShares || '0'} sh
                  </div>
                  <div className="text-[9px] text-gray-500">
                    ID: {order.id.substring(0, 12)}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    order.status === 'LIVE' ? 'bg-green-950 text-green-400 border border-green-800' :
                    order.status === 'CANCELLED' || order.status === 'CANCELED' ? 'bg-gray-800 text-gray-400' :
                    order.status === 'FILLED' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                    'bg-yellow-950 text-yellow-400'
                  }`}>
                    {order.status}
                  </span>

                  {isOpen && (
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={isPending}
                      className="bg-red-900/80 hover:bg-red-800 text-white text-[10px] px-2 py-0.5 rounded font-bold disabled:opacity-50"
                    >
                      {isPending ? 'WAIT...' : 'CANCEL'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrdersTab;
