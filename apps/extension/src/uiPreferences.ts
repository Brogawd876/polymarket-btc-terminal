export type PanelMode = 'collapsed' | 'compact' | 'expanded';
export type DockSide = 'left' | 'right';
export type ActiveTab = 'trade' | 'orders' | 'positions' | 'settings' | 'diag';
export type ExecutionMode = 'MAKER' | 'IMMEDIATE';
export type PageFollowPreference = 'PROMPT' | 'OFF';
export interface UiPreferences {
  panelMode: PanelMode;
  dockSide: DockSide;
  width: number;
  activeTab: ActiveTab;
  executionMode: ExecutionMode;
  pageFollow: PageFollowPreference;
}
export const UI_PREFERENCES_KEY = 'polybtc-ui-preferences-v2';
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  panelMode: 'compact', dockSide: 'right', width: 360, activeTab: 'trade', executionMode: 'MAKER', pageFollow: 'PROMPT',
};
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
export function normalizeUiPreferences(value: unknown): UiPreferences {
  const input = typeof value === 'object' && value !== null ? value as Partial<UiPreferences> : {};
  const width = Number(input.width);
  return {
    panelMode: oneOf(input.panelMode, ['collapsed', 'compact', 'expanded'], DEFAULT_UI_PREFERENCES.panelMode),
    dockSide: oneOf(input.dockSide, ['left', 'right'], DEFAULT_UI_PREFERENCES.dockSide),
    width: Number.isFinite(width) ? Math.min(520, Math.max(320, Math.round(width))) : DEFAULT_UI_PREFERENCES.width,
    activeTab: oneOf(input.activeTab, ['trade', 'orders', 'positions', 'settings', 'diag'], DEFAULT_UI_PREFERENCES.activeTab),
    executionMode: oneOf(input.executionMode, ['MAKER', 'IMMEDIATE'], DEFAULT_UI_PREFERENCES.executionMode),
    pageFollow: oneOf(input.pageFollow, ['PROMPT', 'OFF'], DEFAULT_UI_PREFERENCES.pageFollow),
  };
}
export async function loadUiPreferences(): Promise<UiPreferences> {
  const stored = await chrome.storage.local.get(UI_PREFERENCES_KEY);
  return normalizeUiPreferences(stored[UI_PREFERENCES_KEY]);
}
export async function saveUiPreferences(preferences: UiPreferences): Promise<void> {
  await chrome.storage.local.set({ [UI_PREFERENCES_KEY]: normalizeUiPreferences(preferences) });
}
