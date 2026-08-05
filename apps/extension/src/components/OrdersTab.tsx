import React from 'react';
import type { Order } from '@polymarket-btc/shared';

interface Props {
  orders: Order[];
  sendMessage: (msg: any) => void;
}

const OrdersTab: React.FC<Props> = ({ orders = [], sendMessage }) => {
  const activeOrders = orders.filter(o => !['CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED'].includes(o.status));

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

  return (
    <div className="flex flex-col gap-3 text-xs font-sans">
      <div className="flex justify-between items-center bg-gray-800 p-2.5 rounded border border-gray-700">
        <span className="font-bold text-gray-200">OPEN ORDERS ({activeOrders.length})</span>
        {activeOrders.length > 0 && (
          <button 
            onClick={handleCancelAll}
            className="bg-red-800 hover:bg-red-700 text-white px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider shadow"
          >
            CANCEL ALL
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No open or recent orders</div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map(order => {
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
                    order.status === 'CANCELLED' ? 'bg-gray-800 text-gray-400' :
                    order.status === 'FILLED' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                    'bg-yellow-950 text-yellow-400'
                  }`}>
                    {order.status}
                  </span>

                  {isOpen && (
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={isPending}
                      className="bg-red-900/80 hover:bg-red-800 text-white text-[10px] px-2 py-0.5 rounded font-bold"
                    >
                      CANCEL
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
