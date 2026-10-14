// Pure helpers for the Event Explorer timeline (a Gantt of stops per area): window selection, bars, row layout,
// lanes, hit boxes, overlap lookup and the text summaries. No React, no clock, no time zone: every time is the
// plant-local text of the data, handled as plain numbers (see calc/time.ts).
import type { Area, EventRow, Line } from '../../api/types';
import { MS_DAY, MS_HOUR, addDays, formatTs, parseDate, parseTs, rowSpan, rowHours, splitFlags, isInfoFlag, type ChainedEvent, type Interval, isAnalysable, isBlocked } from '../../calc';
import { t } from '../../i18n/t';

// ------------------------------------------------------------------ window

export type TimelineSpan = 'day' | 'week';

export interface TlWindow extends Interval {
  span: TimelineSpan;
  /** first day, YYYY-MM-DD */
  fromDate: string;
  /** last day (inclusive), YYYY-MM-DD */
  toDate: string;
  days: number;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isDateText = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDate(s) !== null;

/** Monday = 0 ... Sunday = 6 (1970-01-01 was a Thursday). */
export function weekdayIndex(date: string): number {
  const ms = parseDate(date) ?? 0;
  return (((Math.floor(ms / MS_DAY) + 3) % 7) + 7) % 7;
}

/** The plant's week starts on Saturday (Monday = 0 ... Saturday = 5). */
export const WEEK_START = 5;
/** Days since the most recent Saturday (0 on a Saturday, 6 on a Friday). */
export const daysSinceWeekStart = (date: string): number => (weekdayIndex(date) - WEEK_START + 7) % 7;

/** Day: the date itself (24 h). Week: the Saturday-to-Friday week that contains the date (7 days). */
export function windowFor(span: TimelineSpan, date: string): TlWindow {
  const fromDate = span === 'day' ? date : addDays(date, -daysSinceWeekStart(date));
  const days = span === 'day' ? 1 : 7;
  const fromMs = parseDate(fromDate) ?? 0;
  return { span, fromDate, toDate: addDays(fromDate, days - 1), days, fromMs, toMs: fromMs + days * MS_DAY };
}

/** Date for the previous / next window (a day or a week away). */
export const shiftDate = (span: TimelineSpan, date: string, dir: -1 | 1): string => addDays(date, dir * (span === 'day' ? 1 : 7));

/** Date of the latest stop among rows that are not voided (analysable rows first); null without readable rows. */
export function latestStopDate(rows: readonly EventRow[]): string | null {
  let best: string | null = null;
  for (const pass of [true, false]) {
    for (const r of rows) {
      if (r.is_void || (pass && !isAnalysable(r)) || parseTs(r.stop_ts) === null) continue;
      const d = r.stop_ts.slice(0, 10);
      if (best === null || d > best) best = d;
    }
    if (best) return best;
  }
  return best;
}

/** '26 Jul 2026' */
export function dayText(date: string): string {
  const m = Number(date.slice(5, 7));
  return `${Number(date.slice(8, 10))} ${MONTHS[m - 1] ?? ''} ${date.slice(0, 4)}`;
}
/** 'Sun 26 Jul' */
export const dayShort = (date: string): string => `${WEEKDAYS[weekdayIndex(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

export function windowLabel(w: TlWindow): string {
  return w.span === 'day' ? `${WEEKDAYS[weekdayIndex(w.fromDate)]} ${dayText(w.fromDate)}` : `${dayShort(w.fromDate)} – ${dayShort(w.toDate)} ${w.toDate.slice(0, 4)}`;
}

// ------------------------------------------------------------------ scale and ticks

export const LABEL_W_DESKTOP = 150;
export const LABEL_W_PHONE = 92;
export const MIN_PX_PER_HOUR = 28;
export const MIN_PX_PER_DAY = 110;
export const MIN_BAR_PX = 6;
export const HIT_PX = 44;
export const LANE_PX = 44;

/** Width in px of the time axis: fills the space, but never less than the readable minimum (then the card scrolls). */
export function trackWidth(span: TimelineSpan, availablePx: number): number {
  const min = span === 'day' ? 24 * MIN_PX_PER_HOUR : 7 * MIN_PX_PER_DAY;
  return Math.max(min, Math.floor(availablePx));
}

export interface TlTick { ms: number; label: string; major: boolean }

/** Hour ticks for a day (labels every hour, wider ones when there is room), day ticks for a week. */
export function ticksFor(w: TlWindow, trackPx: number): TlTick[] {
  const out: TlTick[] = [];
  if (w.span === 'day') {
    const wide = trackPx / 24 >= 44;
    for (let h = 0; h < 24; h++) out.push({ ms: w.fromMs + h * MS_HOUR, label: wide ? `${String(h).padStart(2, '0')}:00` : String(h).padStart(2, '0'), major: h % 6 === 0 });
  } else {
    for (let d = 0; d < 7; d++) out.push({ ms: w.fromMs + d * MS_DAY, label: dayShort(addDays(w.fromDate, d)), major: true });
  }
  return out;
}

// ------------------------------------------------------------------ bars

export type BarKind = 'failure' | 'planned' | 'other';

export interface TlBar {
  /** event_id of the first row of the chain (what the detail popup opens) */
  key: string;
  areaId: string;
  kind: BarKind;
  /** equipment code N/A: the whole area stopped */
  areaLevel: boolean;
  /** drawn although the record has a blocking data problem */
  blocked: boolean;
  flags: string[];
  code: string;
  reason: string;
  classification: string;
  /** whole event, ms */
  startMs: number;
  endMs: number;
  /** part inside the window, ms */
  fromMs: number;
  toMs: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** hours inside the window */
  hours: number;
  /** hours of the whole event */
  totalHours: number;
  rows: number;
}

/** Same grouping as the dashboards: PL planned, CIR other, everything else failure-type downtime. */
export const kindOfClass = (cls: string): BarKind => (cls === 'PL' ? 'planned' : cls === 'CIR' ? 'other' : 'failure');

const touches = (s: number, e: number, w: Interval): boolean => (e > s ? e > w.fromMs && s < w.toMs : s >= w.fromMs && s < w.toMs);

function makeBar(head: EventRow, startMs: number, endMs: number, hours: number, totalHours: number, rows: number, blocked: boolean, w: Interval): TlBar {
  const fromMs = Math.max(startMs, w.fromMs);
  const toMs = Math.min(Math.max(endMs, startMs), w.toMs);
  return {
    key: head.event_id, areaId: head.area_id, kind: kindOfClass(head.classification), areaLevel: head.is_area_level || head.code_raw.trim().toUpperCase() === 'N/A',
    blocked, flags: splitFlags(head.flags).filter((f) => !isInfoFlag(f)), code: head.code_raw.trim() || 'N/A', reason: (head.reason_raw ?? '').trim(), classification: head.classification,
    startMs, endMs, fromMs, toMs, continuesBefore: startMs < w.fromMs, continuesAfter: endMs > w.toMs, hours, totalHours, rows,
  };
}

/** One bar per chained event (the chain is the existing calc/events output) that touches the window. */
export function chainBars(chains: readonly ChainedEvent[], w: Interval): TlBar[] {
  const out: TlBar[] = [];
  for (const c of chains) {
    if (!touches(c.startMs, c.endMs, w)) continue;
    out.push(makeBar(c.head, c.startMs, c.endMs, c.rows.reduce((s, r) => s + rowHours(r, w), 0), c.durationS / 3600, c.rows.length, false, w));
  }
  return out;
}

export interface BlockedResult { bars: TlBar[]; undrawable: number }

/**
 * Records with a blocking data problem are never chained. One that still has a readable, non-negative interval and
 * a known area is drawn as its own bar (dashed, flagged); the others are only counted.
 */
export function blockedBars(rows: readonly EventRow[], w: Interval, knownAreas: ReadonlySet<string>): BlockedResult {
  const bars: TlBar[] = [];
  let undrawable = 0;
  for (const r of rows) {
    if (r.is_void || !isBlocked(r)) continue;
    const span = rowSpan(r);
    const flags = splitFlags(r.flags);
    const drawable = !!span && span.toMs >= span.fromMs && knownAreas.has(r.area_id) && !flags.includes('unknown_area') && !flags.includes('end_before_start');
    if (drawable && span) {
      if (touches(span.fromMs, span.toMs, w)) bars.push(makeBar(r, span.fromMs, span.toMs, rowHours(r, w), (span.toMs - span.fromMs) / MS_HOUR, 1, true, w));
      continue;
    }
    const at = span ? span.fromMs : parseDate(r.event_date.slice(0, 10));
    if (at !== null && at >= w.fromMs && at < w.toMs) undrawable++;
  }
  return { bars, undrawable };
}

export const barsOverlap = (a: Pick<TlBar, 'startMs' | 'endMs'>, b: Pick<TlBar, 'startMs' | 'endMs'>): boolean =>
  a.startMs < Math.max(b.endMs, b.startMs + 1) && b.startMs < Math.max(a.endMs, a.startMs + 1);

// ------------------------------------------------------------------ rows, lanes

export interface TlPlaced extends TlBar { lane: number }
export interface TlRow { areaId: string; name: string; bars: TlPlaced[]; lanes: number }
export interface TlGroup { lineId: string; name: string; rows: TlRow[] }

/** Stack bars of one area that overlap in time into lanes (first free lane); returns bars in time order. */
export function assignLanes(bars: readonly TlBar[]): { bars: TlPlaced[]; lanes: number } {
  const sorted = [...bars].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs || (a.key < b.key ? -1 : 1));
  const laneEnd: number[] = [];
  const placed = sorted.map((b): TlPlaced => {
    let lane = laneEnd.findIndex((end) => end <= b.fromMs);
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = Math.max(b.toMs, b.fromMs + 1);
    return { ...b, lane };
  });
  return { bars: placed, lanes: Math.max(1, laneEnd.length) };
}

/**
 * Rows = areas in master-data order (line sort order, then area sort order), grouped under their line. Only areas with
 * bars unless `showAll`. Areas that master data does not know are left out (their records are blocked).
 */
export function layoutRows(bars: readonly TlBar[], areas: readonly Area[], lines: readonly Line[], showAll: boolean): TlGroup[] {
  const lineOrder = new Map(lines.map((l) => [l.line_id, l]));
  const byArea = new Map<string, TlBar[]>();
  for (const b of bars) (byArea.get(b.areaId) ?? byArea.set(b.areaId, []).get(b.areaId)!).push(b);
  const sortedAreas = [...areas].sort(
    (a, b) => (lineOrder.get(a.line_id)?.sort_order ?? 1e9) - (lineOrder.get(b.line_id)?.sort_order ?? 1e9) || a.line_id.localeCompare(b.line_id) || a.sort_order - b.sort_order || a.area_id.localeCompare(b.area_id),
  );
  const groups: TlGroup[] = [];
  for (const a of sortedAreas) {
    const mine = byArea.get(a.area_id) ?? [];
    if (!showAll && mine.length === 0) continue;
    if (showAll && mine.length === 0 && !a.active) continue;
    const { bars: placed, lanes } = assignLanes(mine);
    let g = groups[groups.length - 1];
    if (!g || g.lineId !== a.line_id) {
      g = { lineId: a.line_id, name: lineOrder.get(a.line_id)?.name ?? a.line_id, rows: [] };
      groups.push(g);
    }
    g.rows.push({ areaId: a.area_id, name: a.name, bars: placed, lanes });
  }
  return groups;
}

// ------------------------------------------------------------------ geometry

export interface BarBox {
  /** the focusable / tappable button */
  hitLeft: number;
  hitWidth: number;
  /** the drawn bar, relative to the button */
  barLeft: number;
  barWidth: number;
}

/**
 * Pixel box of a bar on a track: the drawn bar is at least `minPx` wide; the button around it is at least `hitPx` wide
 * (centred on the bar, kept inside the track) so a short stop stays tappable.
 */
export function barBox(startPx: number, endPx: number, trackPx: number, minPx = MIN_BAR_PX, hitPx = HIT_PX): BarBox {
  const barW = Math.min(trackPx, Math.max(minPx, endPx - startPx));
  const barL = Math.min(Math.max(0, startPx), trackPx - barW);
  const hitW = Math.min(trackPx, Math.max(hitPx, barW));
  const hitL = Math.min(Math.max(0, barL - (hitW - barW) / 2), trackPx - hitW);
  return { hitLeft: hitL, hitWidth: hitW, barLeft: barL - hitL, barWidth: barW };
}

// ------------------------------------------------------------------ overlap helper (timing facts only)

/** Bars of OTHER areas that overlap this bar in time, in start order. Same-area bars never count. */
export function overlapsInOtherAreas(bar: TlBar, bars: readonly TlBar[]): TlBar[] {
  return bars.filter((o) => o.key !== bar.key && o.areaId !== bar.areaId && barsOverlap(bar, o)).sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1));
}

export const hoursText = (h: number): string => `${(Math.round(h * 10) / 10).toFixed(1)} h`;
const item = (b: TlBar): string => `${b.areaId} ${b.code} ${hoursText(b.totalHours)}`;

/** 'Overlaps with 3 stops in other areas: K.1 100.A1 2.0 h, ... and 2 more' (up to 6 listed). Facts of timing, no cause. */
export function overlapSentence(others: readonly TlBar[], max = 6): string {
  if (others.length === 0) return t('No stops in other areas overlap this one.');
  const shown = others.slice(0, max).map(item).join(', ');
  const more = others.length - max;
  const head = others.length === 1 ? t('Overlaps with 1 stop in another area: ') : t('Overlaps with {n} stops in other areas: ', { n: others.length });
  return head + shown + (more > 0 ? t(', and {n} more', { n: more }) : '');
}

// ------------------------------------------------------------------ texts

/** '14 stops in 6 areas on 26 Jul 2026, 31.8 area-hours; longest: K.2 231.CP190 9.1 h' */
export function summaryText(bars: readonly TlBar[], w: TlWindow): string {
  const when = w.span === 'day' ? t('on {d}', { d: dayText(w.fromDate) }) : t('from {a} to {b}', { a: dayShort(w.fromDate), b: `${dayShort(w.toDate)} ${w.toDate.slice(0, 4)}` });
  if (bars.length === 0) return t('No stops {when}.', { when });
  const areas = new Set(bars.map((b) => b.areaId)).size;
  const total = bars.reduce((s, b) => s + b.hours, 0);
  let longest = bars[0]!;
  for (const b of bars) if (b.hours > longest.hours || (b.hours === longest.hours && b.key < longest.key)) longest = b;
  const stops = bars.length === 1 ? t('1 stop') : t('{n} stops', { n: bars.length });
  const inAreas = areas === 1 ? t('1 area') : t('{n} areas', { n: areas });
  return t('{stops} in {areas} {when}, {h} area-hours; longest: {item}', { stops, areas: inAreas, when, h: (Math.round(total * 10) / 10).toFixed(1), item: `${longest.areaId} ${longest.code} ${hoursText(longest.hours)}` });
}

export const timeSpanText = (b: TlBar): string => `${formatTs(b.startMs).slice(0, 16)} – ${formatTs(b.endMs).slice(0, 16)}`;

export function kindLabel(k: BarKind): string {
  return k === 'failure' ? t('Failure (INC)') : k === 'planned' ? t('Planned (PL)') : t('CIR');
}

/** Rows for 'View as table': area, code, reason, start, end, hours (inside the window), class. */
export function tableRows(groups: readonly TlGroup[]): (string | number)[][] {
  const out: (string | number)[][] = [];
  for (const g of groups) for (const r of g.rows) for (const b of r.bars) {
    out.push([b.areaId, b.code, b.reason || t('(blank)'), formatTs(b.startMs).slice(0, 16), formatTs(b.endMs).slice(0, 16), (Math.round(b.hours * 100) / 100).toFixed(2), b.classification]);
  }
  return out;
}
