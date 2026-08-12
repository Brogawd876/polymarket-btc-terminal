import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_PREFERENCES, normalizeUiPreferences } from './uiPreferences';

describe('UI preference normalization', () => {
  it('uses conservative defaults for invalid stored data', () => {
    expect(normalizeUiPreferences({ panelMode: 'giant', width: 'bad' })).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it('clamps width and preserves supported modes', () => {
    expect(normalizeUiPreferences({ width: 900, panelMode: 'expanded', executionMode: 'IMMEDIATE' })).toMatchObject({
      width: 520,
      panelMode: 'expanded',
      executionMode: 'IMMEDIATE',
    });
  });
});
