import { describe, expect, it } from 'vitest';
import { avail, unavail, parseSettings } from '../calc';
import { anyTarget, areaTargetStatuses, belowTargetCount, getTargets, gapText, kpiTargetStatuses, metricStatus, statusLine, targetsOfArea, targetStatus, type Targets } from './targets';

const all: Targets = { availabilityPct: 95, mtbfH: 120, mttrH: 2 };
const none: Targets = { availabilityPct: null, mtbfH: null, mttrH: null, reliabilityPct: null, utilizationPct: null };
const OFF = { reliability_target_pct: '' };

describe('getTargets', () => {
  it('reads the three optional targets from the settings; blank means off', () => {
    expect(getTargets(parseSettings(OFF))).toEqual(none);
    expect(anyTarget(getTargets(parseSettings(OFF)))).toBe(false);
    const t = getTargets(parseSettings({ ...OFF, availability_target_pct: '95.5', target_mtbf_h: '120', target_mttr_h: '2.5' }));
    expect(t).toEqual({ availabilityPct: 95.5, mtbfH: 120, mttrH: 2.5, reliabilityPct: null, utilizationPct: null });
    expect(anyTarget(t)).toBe(true);
    expect(getTargets(parseSettings({ ...OFF, target_mttr_h: '3' }))).toEqual({ availabilityPct: null, mtbfH: null, mttrH: 3, reliabilityPct: null, utilizationPct: null });
  });
  it('the RF target is 95 % until the setting exists in the sheet; blank there turns it off', () => {
    expect(getTargets(parseSettings({})).reliabilityPct).toBe(95);
    expect(getTargets(parseSettings({ reliability_target_pct: '97.5' })).reliabilityPct).toBe(97.5);
    expect(getTargets(parseSettings({ reliability_target_pct: '' })).reliabilityPct).toBeNull();
    expect(getTargets(parseSettings({ reliability_target_pct: '150' })).reliabilityPct).toBeNull();
  });
  it('the reliability factor wants at least the target, judged as shown', () => {
    expect(targetStatus('reliability', 0.9496, { ...none, reliabilityPct: 95, utilizationPct: null })).toMatchObject({ ok: true, unit: '%', value: 95 });
    expect(targetStatus('reliability', 0.93, { ...none, reliabilityPct: 95, utilizationPct: null })).toMatchObject({ ok: false, state: 'below', gap: -2 });
  });
});

describe('targetStatus', () => {
  it('availability and MTBF want at least the target; MTTR wants at most the target', () => {
    expect(targetStatus('availability', 0.962, all)).toMatchObject({ ok: true, state: 'on', gap: 1.2, value: 96.2, unit: '%' });
    expect(targetStatus('availability', 0.931, all)).toMatchObject({ ok: false, state: 'below', gap: -1.9 });
    expect(targetStatus('mtbf', 130, all)).toMatchObject({ ok: true, state: 'on', gap: 10 });
    expect(targetStatus('mtbf', 100.04, all)).toMatchObject({ ok: false, state: 'below', gap: -20, unit: 'h' });
    expect(targetStatus('mttr', 1.5, all)).toMatchObject({ ok: true, state: 'on', gap: -0.5 });
    expect(targetStatus('mttr', 2.4, all)).toMatchObject({ ok: false, state: 'above', gap: 0.4 });
  });
  it('exactly on the target is on target', () => {
    expect(targetStatus('availability', 0.95, all)?.state).toBe('on');
    expect(targetStatus('mtbf', 120, all)?.state).toBe('on');
    expect(targetStatus('mttr', 2, all)?.state).toBe('on');
  });
  it('judges the figure as it is shown, so 94.96% (shown 95.0%) is on a 95% target', () => {
    expect(targetStatus('availability', 0.9496, all)).toMatchObject({ ok: true, value: 95, gap: 0 });
    expect(targetStatus('availability', 0.9494, all)).toMatchObject({ ok: false, value: 94.9 });
    expect(targetStatus('mttr', 2.004, all)?.ok).toBe(true);
    expect(targetStatus('mttr', 2.006, all)?.ok).toBe(false);
  });
  it('gives nothing when the target is off or the figure is missing', () => {
    expect(targetStatus('availability', 0.9, none)).toBeNull();
    expect(targetStatus('mtbf', 50, { ...none, mttrH: 2 })).toBeNull();
    expect(targetStatus('mttr', null, all)).toBeNull();
    expect(targetStatus('mttr', Number.NaN, all)).toBeNull();
    expect(metricStatus('mtbf', unavail('no_failures', 'No failures'), all)).toBeNull();
    expect(metricStatus('mtbf', avail(150), all)?.ok).toBe(true);
  });
  it('turns a status into words with the target, the verdict and the signed gap', () => {
    expect(statusLine(targetStatus('availability', 0.962, all)!)).toBe('Target 95%: on target (+1.2 pts)');
    expect(statusLine(targetStatus('mtbf', 100, all)!)).toBe('Target 120 h: below target (−20.0 h)');
    expect(statusLine(targetStatus('mttr', 2.4, all)!)).toBe('Target 2 h: above target (+0.40 h)');
    expect(gapText(targetStatus('availability', 0.95, all)!)).toBe('0.0 pts');
  });
});

describe('per KPI set and per area', () => {
  const k = (id: string, a: number | null, mtbf: number | null, mttr: number | null) => ({
    area_id: id,
    availabilityHeadline: a === null ? unavail('no_data', 'none') : avail(a),
    mtbfHours: mtbf === null ? unavail('no_failures', 'none') : avail(mtbf),
    mttrHours: mttr === null ? unavail('no_failures', 'none') : avail(mttr),
  });
  it('statuses of one KPI set; metrics without a target stay null', () => {
    expect(kpiTargetStatuses(k('X', 0.9, 200, 1), { availabilityPct: 95, mtbfH: null, mttrH: 2 })).toMatchObject({ availability: { state: 'below' }, mtbf: null, mttr: { state: 'on' } });
  });
  it('statuses per area, and the count of areas below the availability target', () => {
    const areas = [k('A', 0.99, 100, 3), k('B', 0.9, null, null), k('C', null, 5, 1)];
    const m = areaTargetStatuses(areas, all);
    expect(m.get('A')).toMatchObject({ availability: { ok: true }, mtbf: { state: 'below' }, mttr: { state: 'above' } });
    expect(m.get('B')).toMatchObject({ availability: { ok: false }, mtbf: null, mttr: null });
    expect(belowTargetCount(areas.map((a) => ({ area_id: a.area_id, availability: a.availabilityHeadline })), all)).toEqual({ below: ['B'], total: 2 });
    expect(belowTargetCount([], all)).toEqual({ below: [], total: 0 });
    expect(belowTargetCount(areas.map((a) => ({ area_id: a.area_id, availability: a.availabilityHeadline })), none)).toBeNull();
  });
});

describe('own RF / UF targets of an area', () => {
  it('fall back to the plant-wide target one by one', () => {
    const plant = { ...none, availabilityPct: 90, reliabilityPct: 95, utilizationPct: 85 };
    const own = new Map([['K.1', { reliability: 97 }], ['CR', { utilization: 70, availability: 88 }]]);
    expect(targetsOfArea(plant, own, 'K.1')).toMatchObject({ availabilityPct: 90, reliabilityPct: 97, utilizationPct: 85 });
    expect(targetsOfArea(plant, own, 'CR')).toMatchObject({ availabilityPct: 88, reliabilityPct: 95, utilizationPct: 70 });
    expect(targetsOfArea(plant, own, 'HD')).toBe(plant);
    // the old shape (availability targets only) still works
    expect(targetsOfArea(plant, new Map([['K.1', 80]]), 'K.1').availabilityPct).toBe(80);
  });
  it('UF is judged like RF: at least the target', () => {
    expect(targetStatus('utilization', 0.9, { ...none, utilizationPct: 92 })).toMatchObject({ ok: false, state: 'below', unit: '%' });
    expect(getTargets(parseSettings({ utilization_target_pct: '85' })).utilizationPct).toBe(85);
    expect(getTargets(parseSettings({})).utilizationPct).toBeNull();
  });
});
