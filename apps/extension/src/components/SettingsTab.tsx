import React, { useEffect, useState } from 'react';
import type { PresetConfig } from '@polymarket-btc/shared';
import type { UiPreferences } from '../uiPreferences';

interface Props {
  presets: PresetConfig[];
  settings: Record<string, unknown>;
  sendMessage: (message: unknown) => string | null;
  preferences: UiPreferences;
  updatePreferences: (patch: Partial<UiPreferences>) => void;
}

const SettingsTab: React.FC<Props> = ({ presets, settings, sendMessage, preferences, updatePreferences }) => {
  const [draftPresets, setDraftPresets] = useState<PresetConfig[]>(presets);
  const [maxLoss, setMaxLoss] = useState(String(settings.maxLoss ?? '10'));
  const [maxProfit, setMaxProfit] = useState(String(settings.maxProfit ?? '150'));
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraftPresets(presets), [presets]);
  useEffect(() => {
    setMaxLoss(String(settings.maxLoss ?? '10'));
    setMaxProfit(String(settings.maxProfit ?? '150'));
  }, [settings]);

  const handleSave = () => {
    const settingsRequest = sendMessage({ type: 'UPDATE_SETTINGS', payload: { maxLoss, maxProfit } });
    const presetsRequest = draftPresets.length > 0
      ? sendMessage({ type: 'UPDATE_PRESETS', payload: draftPresets })
      : 'no-preset-change';
    if (settingsRequest && presetsRequest) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs font-sans">
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 font-bold uppercase tracking-wider text-gray-200">EXECUTION & RISK PARAMETERS</div>
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2 font-mono">
        <label className="flex justify-between items-center text-gray-400 text-[10px]">MAX SESSION LOSS ($)
          <input type="number" value={maxLoss} onChange={event => setMaxLoss(event.target.value)} className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs outline-none focus:border-blue-500" />
        </label>
        <label className="flex justify-between items-center text-gray-400 text-[10px]">MAX SESSION PROFIT ($)
          <input type="number" value={maxProfit} onChange={event => setMaxProfit(event.target.value)} className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs outline-none focus:border-blue-500" />
        </label>
      </div>
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2 font-mono text-[10px]">
        <span className="font-bold text-gray-300 text-[11px]">PANEL</span>
        <label className="flex justify-between items-center text-gray-400">DOCK
          <select value={preferences.dockSide} onChange={event => updatePreferences({ dockSide: event.target.value as UiPreferences['dockSide'] })} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white">
            <option value="right">Right</option><option value="left">Left</option>
          </select>
        </label>
        <label className="flex justify-between items-center text-gray-400">WIDTH
          <input type="number" min={320} max={520} step={10} value={preferences.width} onChange={event => updatePreferences({ width: Math.min(520, Math.max(320, Number(event.target.value) || 320)) })} className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white" />
        </label>
        <label className="flex justify-between items-center text-gray-400">PAGE MARKET PROMPT
          <input type="checkbox" checked={preferences.pageFollow === 'PROMPT'} onChange={event => updatePreferences({ pageFollow: event.target.checked ? 'PROMPT' : 'OFF' })} />
        </label>
      </div>
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <span className="font-bold text-gray-300 text-[11px]">ACTIVE PRICE PRESETS</span>
        <div className="flex flex-col gap-1.5 font-mono text-[10px]">
          {draftPresets.map(preset => <div key={preset.id} className="flex justify-between items-center bg-gray-900 p-1.5 rounded border border-gray-700"><span className={preset.side === 'BUY' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{preset.side} - {preset.name}</span><span className="text-gray-400">{preset.mode} ({preset.value > 0 ? `+${preset.value}` : preset.value})</span></div>)}
        </div>
      </div>
      <button onClick={handleSave} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded text-xs uppercase tracking-wider shadow">SAVE VIA SECURE CONNECTION</button>
      {saved && <div className="text-center text-green-400 font-mono text-xs">Update sent</div>}
    </div>
  );
};

export default SettingsTab;
