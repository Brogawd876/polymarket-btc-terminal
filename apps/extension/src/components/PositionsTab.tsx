import React, { useState, useEffect } from 'react';

const PositionsTab: React.FC = () => {
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    fetch('http://localhost:3001/api/positions')
      .then(res => res.json())
      .then(data => setPositions(data))
      .catch(console.error);
  }, []);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <h3 className="font-bold border-b border-gray-700 pb-1">Positions</h3>
      {positions.length === 0 ? (
        <div className="text-gray-500">No open positions</div>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-gray-400">
              <th className="font-normal">Asset</th>
              <th className="font-normal">Side</th>
              <th className="font-normal">Size</th>
              <th className="font-normal">Avg Entry</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-t border-gray-800">
                <td className="py-1">{p.asset || 'PolyBTC'}</td>
                <td className="py-1">{p.side}</td>
                <td className="py-1">{p.size}</td>
                <td className="py-1">${p.entry}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
export default PositionsTab;
