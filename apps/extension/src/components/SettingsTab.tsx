import React, { useState, useEffect } from 'react';
import type { PresetConfig } from '@polymarket-btc/shared';

const SettingsTab: React.FC = () => {
  const [presets, setPresets] = useState<PresetConfig[]>([]);
  const [saved, setSaved] = useState(false);
  const [maxLoss, setMaxLoss] = useState('10');
  const [maxProfit, setMaxProfit] = useState('150');

  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/v1/presets')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPresets(data); })
      .catch(console.error);

    fetch('http://127.0.0.1:3001/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.maxLoss) setMaxLoss(data.maxLoss);
        if (data.maxProfit) setMaxProfit(data.maxProfit);
      })
      .catch(console.error);
  }, []);

  const handleSave = async () => {
    try {
      await fetch('http://127.0.0.1:3001/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxLoss, maxProfit })
      });

      for (const p of presets) {
        await fetch('http://127.0.0.1:3001/api/v1/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs font-sans">
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 font-bold uppercase tracking-wider text-gray-200">
        EXECUTION & RISK PARAMETERS
      </div>

      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2 font-mono">
        <div className="flex justify-between items-center">
          <label className="text-gray-400 text-[10px]">MAX SESSION LOSS ($):</label>
          <input 
            type="number" 
            value={maxLoss} 
            onChange={e => setMaxLoss(e.target.value)}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex justify-between items-center">
          <label className="text-gray-400 text-[10px]">MAX SESSION PROFIT ($):</label>
          <input 
            type="number" 
            value={maxProfit} 
            onChange={e => setMaxProfit(e.target.value)}
            className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <span className="font-bold text-gray-300 text-[11px]">ACTIVE PRICE PRESETS</span>
        <div className="flex flex-col gap-1.5 font-mono text-[10px]">
          {presets.map(p => (
            <div key={p.id} className="flex justify-between items-center bg-gray-900 p-1.5 rounded border border-gray-700">
              <span className={p.side === 'BUY' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{p.side} - {p.name}</span>
              <span className="text-gray-400">{p.mode} ({p.value > 0 ? `+${p.value}` : p.value})</span>
            </div>
          ))}
        </div>
      </div>

      <button 
        onClick={handleSave}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded text-xs uppercase tracking-wider shadow"
      >
        SAVE SETTINGS TO BACKEND
      </button>

      {saved && <div className="text-center text-green-400 font-mono text-xs">Settings saved persistently to SQLite</div>}
    </div>
  );
};

export default SettingsTab;
