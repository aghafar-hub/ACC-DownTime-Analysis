import { describe, expect, it } from 'vitest';
import { buildFailureEvents, type ChainedEvent } from './events';
import { createRowFactory, fixtureIndex, type RowSpec } from './fixtures';
import {
  areaPareto, buildPareto, classificationPareto, equipmentPareto, pareto, reasonPareto, reasonParetoForEquipment,
  type ParetoEntry,
} from './pareto';

const idx = fixtureIndex();
const entry = (key: string, value: number): ParetoEntry => ({ key, label: key, value, eventIds: [`id-${key}`] });

describe('buildPareto', () => {
  const entries = [entry('a', 50), entry('b', 30), entry('c', 10), entry('d', 5), entry('e', 3), entry('f', 2)];
  it('sorts descending with share and cumulative percent of the full total', () => {
    const r = buildPareto([...entries].reverse());
    expect(r.total).toBe(100);
    expect(r.bars.map((b) => b.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.bars.map((b) => b.cumulativePct)).toEqual([50, 80, 90, 95, 98, 100]);
    expect(r.referenceIndex).toBe(1); // 80 % is reached at the second bar
    expect(r.referencePct).toBe(80);
  });
  it('top N: percentages stay against the complete total and the rest becomes Others', () => {
    const r = buildPareto(entries, 5);
    expect(r.bars).toHaveLength(6);
    const others = r.bars[5]!;
    expect(others).toMatchObject({ isOthers: true, label: 'Others', value: 2, entryCount: 1, eventIds: ['id-f'] });
    expect(r.bars[4]!.sharePct).toBe(3); // 3 / 100, not 3 / 98 (the displayed sum)
    expect(r.bars[4]!.cumulativePct).toBe(98);
    expect(others.sharePct).toBe(2);
    expect(others.cumulativePct).toBe(100);
    expect(r.total).toBe(100);
    expect(r.entryCount).toBe(6);
  });
  it('merges many entries into Others and carries all their event ids', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`k${i}`, 12 - i)); // 12, 11, ... 1 => total 78
    const r = buildPareto(many, 5);
    const others = r.bars.at(-1)!;
    expect(others.isOthers).toBe(true);
    expect(others.entryCount).toBe(7);
    expect(others.value).toBe(7 + 6 + 5 + 4 + 3 + 2 + 1);
    expect(others.eventIds).toHaveLength(7);
    expect(others.sharePct).toBeCloseTo((28 / 78) * 100, 9);
    expect(r.bars.filter((b) => b.isOthers)).toHaveLength(1);
    expect(buildPareto(many, 'all').bars.some((b) => b.isOthers)).toBe(false);
    expect(buildPareto(many, 10).bars.at(-1)!.entryCount).toBe(2);
    expect(buildPareto(many, 20).bars).toHaveLength(12);
  });
  it('breaks ties by label so the order is deterministic', () => {
    expect(buildPareto([entry('z', 5), entry('a', 5), entry('m', 5)]).bars.map((b) => b.key)).toEqual(['a', 'm', 'z']);
  });
  it('merges equal keys, drops zero values and handles an empty set', () => {
    const r = buildPareto([entry('a', 2), entry('a', 3), entry('b', 0)]);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]).toMatchObject({ value: 5, sharePct: 100, eventIds: ['id-a', 'id-a'] });
    const e = buildPareto([]);
    expect(e).toMatchObject({ total: 0, bars: [], referenceIndex: null });
  });
  it('generic pareto over arbitrary items', () => {
    const r = pareto([{ n: 'x', v: 1 }, { n: 'y', v: 3 }, { n: 'x', v: 2 }], { key: (i) => i.n, label: (i) => i.n.toUpperCase(), measure: (i) => i.v, eventId: (i) => i.n + i.v });
    expect(r.bars.map((b) => [b.label, b.value, b.sharePct])).toEqual([['X', 3, 50], ['Y', 3, 50]]);
  });
});

function chainsOf(specs: RowSpec[]): ChainedEvent[] {
  const row = createRowFactory();
  return buildFailureEvents(specs.map(row)).chains;
}

describe('equipmentPareto: own-stop rule', () => {
  const chains = chainsOf([
    { area: 'K.1', code: '100.A1', stop: '2026-03-02 08:00', start: '2026-03-02 10:00' }, // own, 2 h
    { area: 'K.1', code: '100.A1', stop: '2026-03-03 08:00', start: '2026-03-03 09:00' }, // own, 1 h
    { area: 'K.1', code: '100.A2', stop: '2026-03-04 08:00', start: '2026-03-04 12:00' }, // own (A2 in K.1 and RM.1), 4 h
    { area: 'RM.1', code: '100.A2', stop: '2026-03-04 08:00', start: '2026-03-04 10:00' }, // own for RM.1 as well, 2 h
    { area: 'K.1', code: '200.B1', stop: '2026-03-05 08:00', start: '2026-03-05 11:00' }, // B1 is RM.1 only: other area, 3 h
    { area: 'K.1', code: 'N/A', stop: '2026-03-06 08:00', start: '2026-03-06 13:00' }, // area-level, 5 h
    { area: 'K.1', code: 'ZZZ.9', eq: null, stop: '2026-03-07 08:00', start: '2026-03-07 08:30' }, // unknown, 0.5 h
    { area: 'K.1', code: '400.D1', stop: '2026-03-08 08:00', start: '2026-03-08 09:30' }, // known, in no area, 1.5 h
    { area: 'K.1', code: '100.A1', cls: 'PL', stop: '2026-03-09 08:00', start: '2026-03-09 20:00' }, // planned: not a failure, ignored
  ]);
  const hours = equipmentPareto(chains, idx, { measure: 'hours' });
  it('counts only events whose code belongs to the stopped area (any of the code areas)', () => {
    expect(hours.own.bars.map((b) => [b.key, b.value])).toEqual([['100.A2', 6], ['100.A1', 3]]);
    expect(hours.own.total).toBe(9);
    expect(hours.own.bars[0]!.sharePct).toBeCloseTo((6 / 9) * 100, 9);
    expect(hours.own.bars[1]!.cumulativePct).toBeCloseTo(100, 9);
  });
  it('reports causes from other areas separately', () => {
    expect(hours.otherAreas.bars.map((b) => [b.key, b.value])).toEqual([['200.B1', 3]]);
  });
  it('reports N/A, unknown and unassigned codes separately', () => {
    expect(hours.areaLevel.bars.map((b) => [b.key, b.value])).toEqual([['N/A', 5]]);
    expect(hours.unknown.bars.map((b) => [b.key, b.value])).toEqual([['ZZZ.9', 0.5]]);
    expect(hours.unassigned.bars.map((b) => [b.key, b.value])).toEqual([['400.D1', 1.5]]);
  });
  it('frequency counts failure events, not hours', () => {
    const c = equipmentPareto(chains, idx, { measure: 'count' });
    expect(c.own.bars.map((b) => [b.key, b.value])).toEqual([['100.A1', 2], ['100.A2', 2]]);
    expect(c.own.total).toBe(4);
  });
  it('no event is counted in two buckets', () => {
    const all = [hours.own, hours.otherAreas, hours.areaLevel, hours.unknown, hours.unassigned].reduce((s, r) => s + r.total, 0);
    expect(all).toBe(2 + 1 + 4 + 2 + 3 + 5 + 0.5 + 1.5); // every failure row once = 19 h
  });
  it('click-through ids point at the underlying events', () => {
    const a1 = hours.own.bars.find((b) => b.key === '100.A1')!;
    expect(a1.eventIds).toHaveLength(2);
    const byId = new Map(chains.map((c) => [c.id, c]));
    expect(a1.eventIds.every((id) => byId.get(id)!.head.code_raw === '100.A1')).toBe(true);
  });
  it('applies the window: hours are clipped, counts are by start', () => {
    const c = chainsOf([
      { area: 'K.1', code: '100.A1', stop: '2026-03-31 22:00', start: '2026-04-01 02:00' }, // 4 h, 2 h in April
      { area: 'K.1', code: '100.A1', stop: '2026-04-10 08:00', start: '2026-04-10 09:00' },
    ]);
    const april = { from: '2026-04-01', to: '2026-04-30' };
    expect(equipmentPareto(c, idx, { measure: 'hours', window: april }).own.bars[0]!.value).toBe(3); // 2 + 1
    expect(equipmentPareto(c, idx, { measure: 'count', window: april }).own.bars[0]!.value).toBe(1); // the March event started in March
  });
  it('drill ids match the bar: only events that contribute inside the window (hours > 0, counts started in it)', () => {
    const c = chainsOf([
      { area: 'K.1', code: '100.A1', stop: '2026-03-31 22:00', start: '2026-04-01 02:00' }, // 2 h in April, started in March
      { area: 'K.1', code: '100.A1', stop: '2026-04-10 08:00', start: '2026-04-10 09:00' }, // April
      { area: 'K.1', code: '100.A1', stop: '2026-03-10 08:00', start: '2026-03-10 09:00' }, // March only: 0 in April
      { area: 'K.1', code: '100.A1', stop: '2026-05-02 08:00', start: '2026-05-02 09:00' }, // May only: 0 in April
      { area: 'K.1', code: '100.A2', stop: '2026-05-03 08:00', start: '2026-05-03 09:00' }, // May only, a different code
    ]);
    const april = { from: '2026-04-01', to: '2026-04-30' };
    const h = equipmentPareto(c, idx, { measure: 'hours', window: april }).own;
    expect(h.bars.map((b) => b.key)).toEqual(['100.A1']); // 100.A2 has nothing in April
    expect(h.bars[0]!.eventIds).toHaveLength(2); // the March-to-April event and the April one
    const n = equipmentPareto(c, idx, { measure: 'count', window: april }).own;
    expect(n.bars[0]!.value).toBe(1);
    expect(n.bars[0]!.eventIds).toHaveLength(n.bars[0]!.value); // drill count == bar count
    // Others carries only contributing ids as well
    const top1 = equipmentPareto([...c, ...chainsOf([{ id: 'X1', area: 'K.1', code: '100.A2', stop: '2026-04-20 08:00', start: '2026-04-20 08:30' }])], idx, { measure: 'count', window: april, topN: 5 }).own;
    for (const b of top1.bars) expect(b.eventIds).toHaveLength(b.value);
  });
  it('a zero-valued entry adds no drill ids when merged with a positive one', () => {
    const r = buildPareto([entry('a', 2), { key: 'a', label: 'a', value: 0, eventIds: ['outside'] }]);
    expect(r.bars[0]!.eventIds).toEqual(['id-a']);
  });
  it('top N produces Others inside the own bucket', () => {
    const r = equipmentPareto(chains, idx, { measure: 'hours', topN: 5 });
    expect(r.own.bars.some((b) => b.isOthers)).toBe(false); // only two own codes
  });
});

describe('reason, area and classification Paretos', () => {
  const chains = chainsOf([
    { area: 'K.1', code: '100.A1', cls: 'MEC', reason: 'Other', stop: '2026-03-02 08:00', start: '2026-03-02 10:00' }, // 2 h
    { area: 'K.1', code: '100.A1', cls: 'ELE', reason: ' other ', stop: '2026-03-03 08:00', start: '2026-03-03 09:00' }, // 1 h, same text, other classification
    { area: 'RM.1', code: '200.B1', cls: 'MEC', reason: 'Belt slip', stop: '2026-03-04 08:00', start: '2026-03-04 12:00' }, // 4 h
    { area: 'RM.1', code: '200.B1', cls: 'MEC', stop: '2026-03-05 08:00', start: '2026-03-05 08:30' }, // blank reason 0.5 h
    { area: 'K.1', code: '100.A1', cls: 'PL', reason: 'Scheduled maintenance', stop: '2026-03-06 08:00', start: '2026-03-06 18:00' }, // 10 h planned
  ]);
  it('reason Pareto groups by match key across classifications by default', () => {
    const r = reasonPareto(chains, { measure: 'hours' });
    expect(r.bars.map((b) => [b.label, b.value])).toEqual([['Belt slip', 4], ['Other', 3], ['(blank)', 0.5]]);
    expect(r.total).toBe(7.5);
  });
  it('can split the same text by classification', () => {
    const r = reasonPareto(chains, { measure: 'hours', splitByClassification: true });
    expect(r.bars.map((b) => [b.label, b.value])).toEqual([['Belt slip (MEC)', 4], ['Other (MEC)', 2], ['other (ELE)', 1], ['(blank) (MEC)', 0.5]]);
  });
  it('reason Pareto for one equipment code', () => {
    const r = reasonParetoForEquipment(chains, '100.a1', idx, { measure: 'count' });
    expect(r.bars.map((b) => [b.label, b.value])).toEqual([['Other', 2]]);
  });
  it('area Pareto by failure hours', () => {
    const r = areaPareto(chains, { measure: 'hours' });
    expect(r.bars.map((b) => [b.key, b.value])).toEqual([['RM.1', 4.5], ['K.1', 3]]);
    expect(r.bars[0]!.sharePct).toBeCloseTo(60, 9);
  });
  it('classification Pareto includes planned stops unless failureOnly', () => {
    const all = classificationPareto(chains, { measure: 'hours' });
    expect(all.bars.map((b) => [b.key, b.value])).toEqual([['PL', 10], ['MEC', 6.5], ['ELE', 1]]);
    expect(all.total).toBe(17.5);
    const failures = classificationPareto(chains, { measure: 'hours', failureOnly: true });
    expect(failures.bars.map((b) => b.key)).toEqual(['MEC', 'ELE']);
  });
});
