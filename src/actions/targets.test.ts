import { describe, expect, it } from 'vitest';
import { evenMonthlySplit, type AreaTarget, type EventRow } from '../api/types';
import { areaTargetMap, checkDraft, draftOf, isEvenSplit, plannedYtd, splitSummary, targetForArea, ytdAllowance } from './targets';

const draft = (allowance: string, split: (number | string)[], target = '', overhaul: number[] = [], rf = '', uf = '') => ({ target, rf, uf, allowance, split: split.map(String), overhaul });

describe('area target validation (as saveAreaTargets checks it)', () => {
  it('an even split adds up', () => {
    const c = checkDraft(draft('240', evenMonthlySplit(240), '92'));
    expect(c.problems).toEqual({});
    expect(c.sum).toBe(240);
  });
  it('the months must add up to the allowance within 0.1 h', () => {
    const split = evenMonthlySplit(576);
    split[7] = split[7]! + 0.1;
    expect(checkDraft(draft('576', split)).problems).toEqual({});
    split[7] = split[7]! + 0.05;
    const c = checkDraft(draft('576', split));
    expect(c.problems.split).toMatch(/576/);
    expect(c.diff).toBeCloseTo(0.15, 5);
  });
  it('K.1 of the mockup: Feb overhaul and an edited August still add up', () => {
    expect(checkDraft(draft('576', [14, 374, 14, 14, 14, 14, 14, 62, 14, 14, 14, 14], '90', [2])).problems).toEqual({});
    expect(checkDraft(draft('576', [14, 374, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14])).problems.split).toBeDefined();
  });
  it('RF and UF targets: 0-100 or blank (blank = plant-wide)', () => {
    expect(checkDraft(draft('100', evenMonthlySplit(100), '', [], '101')).problems.rf).toBeDefined();
    expect(checkDraft(draft('100', evenMonthlySplit(100), '', [], '', '-1')).problems.uf).toBeDefined();
    expect(checkDraft(draft('100', evenMonthlySplit(100), '', [], '97.5', '90')).problems).toEqual({});
    expect(checkDraft(draft('', [], '', [], '97')).blank).toBe(false);
  });
  it('ranges: target 0-100 or blank, allowance 0-8784, months 0 or more', () => {
    expect(checkDraft(draft('100', evenMonthlySplit(100), '101')).problems.target).toBeDefined();
    expect(checkDraft(draft('100', evenMonthlySplit(100), '')).problems.target).toBeUndefined();
    expect(checkDraft(draft('9000', evenMonthlySplit(9000))).problems.allowance).toBeDefined();
    expect(checkDraft(draft('', [])).blank).toBe(true);
    expect(checkDraft(draft('', Array(12).fill(''), '90')).problems.allowance).toBeDefined();
    const neg = evenMonthlySplit(120);
    neg[0] = -1;
    expect(checkDraft(draft('120', neg)).problems.split0).toBeDefined();
  });
  it('blank month cells count as 0', () => {
    const cells: string[] = Array(12).fill('');
    cells[1] = '50';
    expect(checkDraft(draft('50', cells)).problems).toEqual({});
  });
  it('the summary of a split', () => {
    expect(isEvenSplit(evenMonthlySplit(240), 240)).toBe(true);
    expect(splitSummary(evenMonthlySplit(240), 240)).toBe('Even · 20 h/mo');
    expect(splitSummary([14, 374, 14, 14, 14, 14, 14, 62, 14, 14, 14, 14], 576)).toMatch(/^Custom/);
    expect(splitSummary([], 0)).toBe('No allowance');
  });
  it('the typed form of a stored row', () => {
    const row: AreaTarget = { area_id: 'K.1', year: 2026, availability_target_pct: null, planned_allowance_h_year: 120, monthly_split: evenMonthlySplit(120), overhaul_months: [4], updated_at: '', updated_by: '' };
    expect(draftOf(row)).toEqual({ target: '', rf: '', uf: '', allowance: '120', split: evenMonthlySplit(120).map(String), overhaul: [4] });
    expect(draftOf(undefined).split).toHaveLength(12);
    expect(draftOf({ ...row, reliability_target_pct: 97.5, utilization_target_pct: 90 })).toMatchObject({ rf: '97.5', uf: '90' });
  });
});

describe('year to date', () => {
  it('the allowance of January to the month', () => {
    const split = [14, 374, 14, 14, 14, 14, 14, 62, 14, 14, 14, 14];
    expect(ytdAllowance(split, 8)).toBe(520);
    expect(ytdAllowance(split, 0)).toBe(0);
    expect(ytdAllowance(split, 12)).toBe(576);
  });
  const row = (id: string, area: string, stop: string, start: string, cls: EventRow['classification'] = 'PL'): EventRow => ({
    event_id: id, batch_id: 'B', event_date: stop.slice(0, 10), line_id: 'L.1', area_id: area, code_raw: 'X', is_area_level: false, stop_ts: stop, start_ts: start,
    duration_s: 0, freq: 1, classification: cls, criticality: 'NO_INC', is_failure: false, fingerprint: id, edited: false, is_void: false, created_at: '',
  });
  const tg = (area: string, allowance: number, split = evenMonthlySplit(allowance), overhaul: number[] = []): AreaTarget => ({
    area_id: area, year: 2026, availability_target_pct: 90, planned_allowance_h_year: allowance, monthly_split: split, overhaul_months: overhaul, updated_at: '', updated_by: '',
  });
  const rows = [
    row('EV-a', 'K.1', '2026-01-10 00:00:00', '2026-01-10 10:00:00'),
    row('EV-b', 'K.1', '2026-01-10 05:00:00', '2026-01-10 12:00:00'), // overlaps EV-a: counted once (P1)
    row('EV-c', 'K.1', '2026-02-01 00:00:00', '2026-02-02 00:00:00'),
    row('EV-d', 'K.1', '2026-02-05 00:00:00', '2026-02-05 03:00:00', 'MEC'),
    row('EV-e', 'K.2', '2026-02-05 00:00:00', '2026-02-05 03:00:00'),
    { ...row('EV-f', 'K.1', '2026-02-06 00:00:00', '2026-02-06 05:00:00'), is_void: true },
  ];
  it('PL hours per month (overlaps once, voided and other classes left out), YTD against the allowance', () => {
    const [k1] = plannedYtd({ rows, targets: [tg('K.1', 120, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], [2])], year: 2026, dataEnd: '2026-02-20' });
    expect(k1!.through).toBe(2);
    expect(k1!.months[0]!.used).toBeCloseTo(12, 6);
    expect(k1!.months[1]!.used).toBeCloseTo(24, 6);
    expect(k1!.months[2]!.used).toBeNull();
    expect(k1!.ytdUsed).toBeCloseTo(36, 6);
    expect(k1!.ytdAllowed).toBe(20);
    expect(k1!.months.filter((m) => m.over).map((m) => m.month)).toEqual([1, 2]);
    expect(k1!.months[1]!.overhaul).toBe(true);
    expect(k1!.rowIds).toEqual(['EV-a', 'EV-b', 'EV-c']);
  });
  it('only the areas asked for, only targets of the year, a later year counts all twelve months', () => {
    expect(plannedYtd({ rows, targets: [tg('K.1', 120), tg('K.2', 60)], year: 2026, dataEnd: '2026-02-20', areaIds: ['K.2'] }).map((a) => a.area_id)).toEqual(['K.2']);
    expect(plannedYtd({ rows, targets: [{ ...tg('K.1', 120), year: 2025 }], year: 2026, dataEnd: '2026-02-20' })).toEqual([]);
    expect(plannedYtd({ rows, targets: [tg('K.1', 120)], year: 2026, dataEnd: '2027-01-03' })[0]!.through).toBe(12);
    expect(plannedYtd({ rows, targets: [tg('K.1', 120)], year: 2026, dataEnd: '2025-12-31' })).toEqual([]);
  });
});

describe('availability target per area', () => {
  it('the area target of the year when there is one, else the plant-wide one', () => {
    const m = areaTargetMap([
      { area_id: 'K.1', year: 2026, availability_target_pct: 90, planned_allowance_h_year: 0, monthly_split: [], overhaul_months: [], updated_at: '', updated_by: '' },
      { area_id: 'K.2', year: 2026, availability_target_pct: null, planned_allowance_h_year: 0, monthly_split: [], overhaul_months: [], updated_at: '', updated_by: '' },
      { area_id: 'CR', year: 2025, availability_target_pct: 80, planned_allowance_h_year: 0, monthly_split: [], overhaul_months: [], updated_at: '', updated_by: '' },
    ], 2026);
    expect([...m.entries()]).toEqual([['K.1', 90]]);
    expect(targetForArea(m, 85, 'K.1')).toBe(90);
    expect(targetForArea(m, 85, 'K.2')).toBe(85);
    expect(targetForArea(null, null, 'K.2')).toBeNull();
  });
});
