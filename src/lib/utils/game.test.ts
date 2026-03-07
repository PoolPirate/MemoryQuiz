import { describe, expect, it } from 'vitest';

import { formatBytes, getAllowedRadiusKm, getDateGapThresholdDays, haversineKm } from './game';

describe('game helpers', () => {
  it('shrinks the allowed radius as the streak grows', () => {
    expect(getAllowedRadiusKm(0)).toBe(2000);
    expect(getAllowedRadiusKm(2)).toBe(500);
    expect(getAllowedRadiusKm(99)).toBe(25);
  });

  it('computes haversine distances in kilometers', () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const london = { lat: 51.5072, lng: -0.1276 };
    expect(Math.round(haversineKm(paris, london))).toBe(344);
  });

  it('tightens the date difficulty over time', () => {
    expect(getDateGapThresholdDays(0)).toBeGreaterThan(getDateGapThresholdDays(5));
  });

  it('formats byte sizes for UI display', () => {
    expect(formatBytes(850)).toBe('850 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
