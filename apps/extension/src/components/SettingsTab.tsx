import React, { useState, useEffect } from 'react';

const SettingsTab: React.FC = () => {
  const [maxLoss, setMaxLoss] = useState('10');
  const [maxProfit, setMaxProfit] = useState('150');

  useEffect(() => {
    fetch('http://localhost:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.maxLoss) setMaxLoss(data.maxLoss);
        if (data.maxProfit) setMaxProfit(data.maxProfit);
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    try {
      await fetch('http://localhost:3001/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxLoss, maxProfit })
      });
      alert('Settings saved');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      <h3 className="font-bold border-b border-gray-700 pb-1">Settings</h3>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Max Session Loss ($)
          <input 
            type="number" 
            value={maxLoss}
            onChange={e => setMaxLoss(e.target.value)}
            className="bg-gray-800 border border-gray-700 p-1 rounded outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          Max Session Profit ($)
          <input 
            type="number" 
            value={maxProfit}
            onChange={e => setMaxProfit(e.target.value)}
            className="bg-gray-800 border border-gray-700 p-1 rounded outline-none"
          />
        </label>
        <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 py-2 rounded text-white mt-2">
          Save Settings
        </button>
      </div>
    </div>
  );
};
export default SettingsTab;
