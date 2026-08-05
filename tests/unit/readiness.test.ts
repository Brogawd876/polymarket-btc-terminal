import { describe, it, expect } from 'vitest';
import { evaluateReadiness, determineOperationalState } from '../../apps/server/src/routes/index';

describe('LiveReadiness & Operational State Engine', () => {
  it('blocks live execution when disarmed', () => {
    const market = {
      conditionId: '0x123',
      targetTime: Date.now() + 100000,
      lastUpdated: Date.now()
    };
    const readiness = evaluateReadiness(market);
    expect(readiness.liveArmed).toBe(false);
    expect(readiness.blockingReasons).toContain('LIVE EXECUTION DISARMED');
  });

  it('determines LIVE_DISARMED state when all conditions pass except arming', () => {
    const readiness = {
      backendConnected: true,
      publicMarketConnected: true,
      referenceConnected: true,
      selectedMarketValid: true,
      currentWindowValid: true,
      accountConfigured: true,
      accountAuthenticated: true,
      userStreamConnected: true,
      balanceLoaded: true,
      allowanceValid: true,
      reconciliationComplete: true,
      marketDataFresh: true,
      referenceDataFresh: true,
      minimumTimeRemainingSatisfied: true,
      liveEnabledByConfiguration: true,
      liveArmed: false,
      blockingReasons: ['LIVE EXECUTION DISARMED'],
    };
    const state = determineOperationalState(readiness, { targetTime: Date.now() + 100000 });
    expect(state).toBe('LIVE_DISARMED');
  });

  it('determines LIVE_ARMED state when armed and no blocking reasons exist', () => {
    const readiness = {
      backendConnected: true,
      publicMarketConnected: true,
      referenceConnected: true,
      selectedMarketValid: true,
      currentWindowValid: true,
      accountConfigured: true,
      accountAuthenticated: true,
      userStreamConnected: true,
      balanceLoaded: true,
      allowanceValid: true,
      reconciliationComplete: true,
      marketDataFresh: true,
      referenceDataFresh: true,
      minimumTimeRemainingSatisfied: true,
      liveEnabledByConfiguration: true,
      liveArmed: true,
      blockingReasons: [],
    };
    const state = determineOperationalState(readiness, { targetTime: Date.now() + 100000 });
    expect(state).toBe('LIVE_ARMED');
  });
});
