import { describe, expect, it } from 'vitest';
import { buildFailureEvents } from './events';
import { applyFilters, emptyFilter } from './filters';
import { fixtureIndex, syntheticYear } from './fixtures';
import { computeKpis } from './kpis';
import { areaPareto, equipmentPareto, reasonPareto } from './pareto';
import { findRepeatedFailures } from './repeats';
import { DEFAULT_SETTINGS } from './settings';
import { monthlySeries } from './trends';

/** Warm the JIT once, then report the best of three runs (robust against a busy CI machine). */
function timed<R>(f: () => R): { ms: number; result: R } {
  let result = f();
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    result = f();
    best = Math.min(best, performance.now() - t0);
  }
  return { ms: best, result };
}

// A deliberately hard case: 15,000 rows over 4 areas, 5 codes and 4 reasons, so almost everything repeats.
describe('performance: a year of about 15,000 events', () => {
  const rows = syntheticYear(2026, 15000);
  const settings = DEFAULT_SETTINGS;
  const index = fixtureIndex();
  const year = { from: '2026-01-01', to: '2026-12-31' };
  const chains = buildFailureEvents(rows);

  it('filters and chains in well under 200 ms', () => {
    const { ms, result } = timed(() => buildFailureEvents(applyFilters(rows, { ...emptyFilter(), dateRange: year }, { settings, index })));
    expect(result.chains.length).toBeGreaterThan(10000);
    expect(ms).toBeLessThan(200);
  });

  it('KPIs for the year (hours, failures, availability, MTBF, MTTR) in well under 200 ms', () => {
    const { ms, result } = timed(() => computeKpis({ rows, chains: chains.chains, window: year, settings }));
    expect(result.status).toBe('ok');
    expect(ms).toBeLessThan(200);
  });

  it('Paretos and repeats in under 200 ms; a 12-month series in under 200 ms', () => {
    const pareto = timed(() => {
      equipmentPareto(chains.failureEvents, index, { measure: 'hours', window: year });
      reasonPareto(chains.failureEvents, { measure: 'count', window: year });
      areaPareto(chains.failureEvents, { measure: 'hours', window: year });
    });
    const repeats = timed(() => findRepeatedFailures(chains.failureEvents, { settings, window: year }));
    const series = timed(() => monthlySeries({ rows, chains: chains.chains, range: year, settings }));
    expect(series.result).toHaveLength(12);
    expect(pareto.ms).toBeLessThan(200);
    expect(repeats.ms).toBeLessThan(200);
    expect(series.ms).toBeLessThan(200);
  });

  it('monthly totals agree with computeKpis for each month', () => {
    const series = monthlySeries({ rows, chains: chains.chains, range: year, settings });
    for (const m of [series[0]!, series[5]!, series[11]!]) {
      const k = computeKpis({ rows, chains: chains.chains, window: m.requested, settings });
      if (k.status !== 'ok') throw new Error('no data');
      expect(m.failureHours).toBeCloseTo(k.total.failureHours, 6);
      expect(m.plannedHours).toBeCloseTo(k.total.plannedHours, 6);
      expect(m.otherHours).toBeCloseTo(k.total.otherHours, 6);
      expect(m.failureCount).toBe(k.total.failureCount);
      expect(m.kpis!.failureEventCount).toBe(k.total.failureEventCount);
      expect(m.kpis!.scheduledHours).toBe(k.total.scheduledHours);
    }
  });
});
