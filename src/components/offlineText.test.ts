import { describe, expect, it } from 'vitest';
import { offlineDataText } from './offlineText';

describe('offlineDataText', () => {
  it('names the last sync time in the app format (local time)', () => {
    const d = new Date(2026, 9, 14, 7, 12);
    expect(offlineDataText(d.toISOString())).toBe(' · data from 14 Oct 2026 07:12');
  });
  it('falls back when the time is unknown or not a date', () => {
    expect(offlineDataText(null)).toBe(' · data saved on this device');
    expect(offlineDataText('not a date')).toBe(' · data saved on this device');
  });
});
