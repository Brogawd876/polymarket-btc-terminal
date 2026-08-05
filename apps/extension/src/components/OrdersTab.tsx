import React, { useState } from 'react';
import type { Order } from '@polymarket-btc/shared';

const OrdersTab: React.FC<{orders: Order[], sendMessage: (msg: any) => void}> = ({ orders, sendMessage }) => {
  const [cancelling, setCancelling] = useState<string | null>(null);

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try {
      sendMessage({
        type: 'CANCEL_ORDER',
        id: crypto.randomUUID(),
        payload: { orderId: id }
      });
      // Set a timeout to clear the cancelling state if we don't get a response
      setTimeout(() => setCancelling(null), 2000);
    } catch (e) {
      console.error(e);
      setCancelling(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <h3 className="font-bold border-b border-gray-700 pb-1">Active Orders</h3>
      {orders.length === 0 ? (
        <div className="text-gray-500">No active orders</div>
      ) : (
        orders.map(o => (
          <div key={o.id} className="bg-gray-800 p-2 rounded flex justify-between items-center">
            <span>{o.side} {o.size} @ {o.price}</span>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">{o.status}</span>
              {['PENDING', 'OPEN', 'NEW'].includes(o.status) && (
                <button 
                  onClick={() => handleCancel(o.id)}
                  disabled={cancelling === o.id}
                  className="bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded text-[10px]"
                >
                  {cancelling === o.id ? '...' : 'Cancel'}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};
export default OrdersTab;
