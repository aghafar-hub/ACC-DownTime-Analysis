import { describe, expect, it } from 'vitest';
import type { Area, Line } from '../../api/types';
import { buildFailureEvents } from '../../calc';
import { createRowFactory } from '../../calc/fixtures';
import {
  assignLanes, barBox, blockedBars, chainBars, latestStopDate, layoutRows, overlapSentence, overlapsInOtherAreas, shiftDate, summaryText, tableRows,
  ticksFor, trackWidth, weekdayIndex, windowFor, type TlBar,
} from './timeline';

const lines: Line[] = [{ line_id: 'L.2', name: 'Line 2', sort_order: 2, active: true }, { line_id: 'L.1', name: 'Line 1', sort_order: 1, active: true }];
const area = (area_id: string, line_id: string, sort_order: number, active = true): Area => ({ area_id, name: `${area_id} name`, line_id, sort_order, active, in_downtime_sheet: true });
const areas = [area('K.2', 'L.2', 1), area('RM.1', 'L.1', 2), area('K.1', 'L.1', 1), area('CM.1', 'L.1', 3, false)];
const known = new Set(areas.map((a) => a.area_id));
const DAY = windowFor('day', '2026-07-26');

describe('windowFor', () => {
  it('Day is 24 h of the date, Week is the Monday-Sunday week containing it', () => {
    expect(DAY.toMs - DAY.fromMs).toBe(86_400_000);
    expect(DAY.toDate).toBe('2026-07-26');
    expect(weekdayIndex('2026-07-26')).toBe(6); // a Sunday
    const w = windowFor('week', '2026-07-26');
    expect(w.fromDate).toBe('2026-07-20');
    expect(w.toDate).toBe('2026-07-26');
    expect(w.toMs - w.fromMs).toBe(7 * 86_400_000);
    expect(windowFor('week', '2026-07-20').fromDate).toBe('2026-07-20');
  });
  it('shifts a day or a week, across month ends', () => {
    expect(shiftDate('day', '2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDate('week', '2026-07-03', -1)).toBe('2026-06-26');
  });
  it('picks the latest stop date, ignoring voided rows', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 10:00', start: '2026-03-02 11:00' }), row({ stop: '2026-03-09 10:00', start: '2026-03-09 11:00' }), row({ stop: '2026-04-01 10:00', start: '2026-04-01 11:00', isVoid: true })];
    expect(latestStopDate(rows)).toBe('2026-03-09');
    expect(latestStopDate([])).toBeNull();
  });
  it('has hour ticks for a day and day ticks for a week', () => {
    expect(ticksFor(DAY, 700)).toHaveLength(24);
    expect(ticksFor(windowFor('week', '2026-07-26'), 800).map((k) => k.label)[0]).toBe('Mon 20 Jul');
    expect(trackWidth('day', 100)).toBe(24 * 28);
    expect(trackWidth('day', 1200)).toBe(1200);
  });
});

describe('chainBars', () => {
  it('draws a failure chain (Freq 1 + Freq 0 rows) as ONE bar', () => {
    const row = createRowFactory();
    const a = row({ area: 'K.1', stop: '2026-07-26 10:00', start: '2026-07-26 11:00' });
    const b = row({ area: 'K.1', stop: '2026-07-26 11:00', start: '2026-07-26 12:30', freq: 0 });
    const bars = chainBars(buildFailureEvents([a, b]).chains, DAY);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.key).toBe(a.event_id);
    expect(bars[0]!.kind).toBe('failure');
    expect(bars[0]!.hours).toBeCloseTo(2.5, 6);
    expect(bars[0]!.rows).toBe(2);
  });
  it('clips a bar that crosses midnight to the window and flags it as continuing', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-07-25 22:00', start: '2026-07-26 02:00', cls: 'PL' });
    const c = row({ area: 'RM.1', stop: '2026-07-26 23:00', start: '2026-07-27 01:00', cls: 'CIR' });
    const bars = chainBars(buildFailureEvents([a, c]).chains, DAY);
    expect(bars).toHaveLength(2);
    const [x, y] = bars as [TlBar, TlBar];
    expect(x.kind).toBe('planned');
    expect(x.continuesBefore).toBe(true);
    expect(x.continuesAfter).toBe(false);
    expect(x.fromMs).toBe(DAY.fromMs);
    expect(x.hours).toBeCloseTo(2, 6);
    expect(x.totalHours).toBeCloseTo(4, 6);
    expect(y.kind).toBe('other');
    expect(y.continuesAfter).toBe(true);
    expect(y.toMs).toBe(DAY.toMs);
    expect(y.hours).toBeCloseTo(1, 6);
  });
  it('leaves out events outside the window and voided rows; marks an N/A (whole area) bar', () => {
    const row = createRowFactory();
    const rows = [
      row({ stop: '2026-07-24 10:00', start: '2026-07-24 11:00' }),
      row({ stop: '2026-07-26 03:00', start: '2026-07-26 04:00', isVoid: true }),
      row({ area: 'RM.1', code: 'N/A', stop: '2026-07-26 05:00', start: '2026-07-26 06:00' }),
    ];
    const bars = chainBars(buildFailureEvents(rows).chains, DAY);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.areaLevel).toBe(true);
    expect(bars[0]!.code).toBe('N/A');
  });
});

describe('blockedBars', () => {
  it('draws a blocked record that has a valid interval, counts the ones that cannot be drawn', () => {
    const row = createRowFactory();
    const noClass = { ...row({ stop: '2026-07-26 01:00', start: '2026-07-26 02:00' }), flags: 'missing_classification' };
    const backwards = { ...row({ stop: '2026-07-26 05:00', start: '2026-07-26 04:00' }), flags: 'end_before_start' };
    const badArea = { ...row({ area: 'ZZ', stop: '2026-07-26 06:00', start: '2026-07-26 07:00' }), flags: 'unknown_area' };
    const otherDay = { ...row({ stop: '2026-07-20 05:00', start: '2026-07-20 04:00' }), flags: 'end_before_start' };
    const voided = { ...row({ stop: '2026-07-26 05:00', start: '2026-07-26 04:00', isVoid: true }), flags: 'end_before_start' };
    const r = blockedBars([noClass, backwards, badArea, otherDay, voided], DAY, known);
    expect(r.bars.map((b) => b.key)).toEqual([noClass.event_id]);
    expect(r.bars[0]!.blocked).toBe(true);
    expect(r.undrawable).toBe(2);
  });
});

describe('layoutRows', () => {
  const row = createRowFactory();
  const rows = [row({ area: 'K.2', stop: '2026-07-26 03:00', start: '2026-07-26 04:00' }), row({ area: 'RM.1', stop: '2026-07-26 01:00', start: '2026-07-26 02:00' })];
  const bars = chainBars(buildFailureEvents(rows).chains, DAY);
  it('orders by line then area sort order and shows only areas with stops by default', () => {
    const g = layoutRows(bars, areas, lines, false);
    expect(g.map((x) => x.lineId)).toEqual(['L.1', 'L.2']);
    expect(g.flatMap((x) => x.rows.map((r) => r.areaId))).toEqual(['RM.1', 'K.2']);
  });
  it('Show all areas lists active areas without stops too', () => {
    const g = layoutRows(bars, areas, lines, true);
    expect(g.flatMap((x) => x.rows.map((r) => r.areaId))).toEqual(['K.1', 'RM.1', 'K.2']);
  });
});

describe('assignLanes', () => {
  it('puts overlapping bars of one area in separate lanes and touching ones in the same lane', () => {
    const row = createRowFactory();
    const rows = [
      row({ stop: '2026-07-26 01:00', start: '2026-07-26 03:00' }),
      row({ stop: '2026-07-26 02:00', start: '2026-07-26 04:00' }),
      row({ stop: '2026-07-26 03:00', start: '2026-07-26 05:00' }),
    ];
    const bars = chainBars(buildFailureEvents(rows).chains, DAY);
    const r = assignLanes(bars);
    expect(r.lanes).toBe(2);
    expect(r.bars.map((b) => b.lane)).toEqual([0, 1, 0]);
  });
});

describe('barBox', () => {
  it('gives a short bar a minimum drawn width and a 44 px hit box centred on it', () => {
    const b = barBox(100, 101, 700);
    expect(b.barWidth).toBe(6);
    expect(b.hitWidth).toBe(44);
    expect(b.hitLeft + b.barLeft).toBeCloseTo(100, 6);
    expect(b.hitLeft + b.hitWidth / 2).toBeCloseTo(103, 6);
  });
  it('keeps the box inside the track at both edges and leaves long bars alone', () => {
    const l = barBox(0, 1, 700);
    expect(l.hitLeft).toBe(0);
    expect(l.barLeft).toBe(0);
    const r = barBox(699, 700, 700);
    expect(r.hitLeft + r.hitWidth).toBeLessThanOrEqual(700);
    expect(r.hitLeft + r.barLeft + r.barWidth).toBeLessThanOrEqual(700);
    const long = barBox(50, 300, 700);
    expect(long).toEqual({ hitLeft: 50, hitWidth: 250, barLeft: 0, barWidth: 250 });
  });
});

describe('overlaps and texts', () => {
  const row = createRowFactory();
  const rows = [
    row({ area: 'RM.1', code: '100.A1', stop: '2026-07-26 01:00', start: '2026-07-26 03:00' }),
    row({ area: 'K.1', code: '200.B1', stop: '2026-07-26 02:00', start: '2026-07-26 06:00' }),
    row({ area: 'K.1', code: '300.C1', stop: '2026-07-26 07:00', start: '2026-07-26 08:00' }),
    row({ area: 'K.2', code: 'N/A', stop: '2026-07-26 03:00', start: '2026-07-26 04:00' }),
  ];
  const bars = chainBars(buildFailureEvents(rows).chains, DAY);
  const rm = bars.find((b) => b.areaId === 'RM.1')!;
  const k1 = bars.find((b) => b.code === '200.B1')!;

  it('lists overlapping stops of OTHER areas only; touching or same-area stops do not count', () => {
    expect(overlapsInOtherAreas(rm, bars).map((b) => b.areaId)).toEqual(['K.1']);
    expect(overlapsInOtherAreas(k1, bars).map((b) => b.areaId)).toEqual(['RM.1', 'K.2']); // RM.1 ends at 03:00 when K.2 starts: both overlap K.1
    const sameArea = bars.find((b) => b.code === '300.C1')!;
    expect(overlapsInOtherAreas(sameArea, bars)).toEqual([]);
  });
  it('writes the overlap line with up to 6 items and "and N more"', () => {
    expect(overlapSentence(overlapsInOtherAreas(rm, bars))).toBe('Overlaps with 1 stop in another area: K.1 200.B1 4.0 h');
    expect(overlapSentence([])).toBe('No stops in other areas overlap this one.');
    const many = Array.from({ length: 8 }, (_, i) => ({ ...k1, key: `x${i}`, areaId: `A.${i}` }));
    const s = overlapSentence(many);
    expect(s.startsWith('Overlaps with 8 stops in other areas: ')).toBe(true);
    expect(s.endsWith(', and 2 more')).toBe(true);
    expect(s.match(/A\.\d 200\.B1/g)).toHaveLength(6);
  });
  it('summarises the window', () => {
    expect(summaryText(bars, DAY)).toBe('4 stops in 3 areas on 26 Jul 2026, 8.0 area-hours; longest: K.1 200.B1 4.0 h');
    expect(summaryText([], DAY)).toBe('No stops on 26 Jul 2026.');
    expect(summaryText([rm], DAY)).toContain('1 stop in 1 area');
    expect(summaryText(bars, windowFor('week', '2026-07-26'))).toContain('from Mon 20 Jul to Sun 26 Jul 2026');
  });
  it('builds the table rows in area order', () => {
    const t = tableRows(layoutRows(bars, areas, lines, false));
    expect(t.map((r) => r[0])).toEqual(['K.1', 'K.1', 'RM.1', 'K.2']);
    expect(t[0]).toHaveLength(7);
  });
});
