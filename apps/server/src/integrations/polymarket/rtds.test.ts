import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMarketAnchor,
  rtdsMetrics,
  setActiveMarketAnchor,
  setPageMarketAnchor,
  stopRtds,
} from './rtds';

describe('RTDS anchors', () => {
  beforeEach(() => {
    stopRtds();
    rtdsMetrics.currentPrice = 65_000;
    rtdsMetrics.sourceTimestamp = Date.now();
    rtdsMetrics.receiveTimestamp = Date.now();
  });

  it('never derives or validates an opening anchor from current spot', () => {
    const conditionId = `spot-is-not-anchor-${Date.now()}`;
    const anchor = setActiveMarketAnchor(conditionId, Date.now(), '65000');

    expect(anchor.value).toBe('0');
    expect(anchor.validated).toBe(false);
    expect(getMarketAnchor(conditionId)).toEqual(anchor);
  });

  it('does not let page context validate an opening anchor', () => {
    const conditionId = `explicit-page-anchor-${Date.now()}`;
    const anchor = setPageMarketAnchor(conditionId, Date.now(), '64950.25');

    expect(anchor.value).toBe('0');
    expect(anchor.validated).toBe(false);
  });
});
