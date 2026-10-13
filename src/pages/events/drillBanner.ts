// The context banner of Event records opened from a chart: 'From: Pareto › 141.VL170 · Aug 2026 · 9 events, 15.7 h',
// with '✓ matches the bar' when the records add up to what the chart showed. The hours of the records are clipped to the
// chart's period, like the bar (a stop that started before the period counts only its time inside it). Pure.
import type { EventRow } from '../../api/types';
import { isBlocked, rangeToInterval, rowHours, type DateRange } from '../../calc';
import type { DrillState } from '../../dashboard/drill';
import { t } from '../../i18n/t';
import { pageForPath, pageTab } from '../../navigation';
import { rangeText } from '../../util/dates';
import { num } from '../../util/format';

export interface DrillFigures {
  /** events (chains) or records the drill names that are in the data */
  count: number;
  /** 'events' for chain ids, 'records' for row ids */
  unit: 'events' | 'records';
  /** rows listed (an event can have continuation rows) */
  rows: number;
  /** hours of the listed records inside the period (voided rows and rows left out of the numbers not counted) */
  hours: number;
}

/** What the drill rows add up to: the number of events (or records) and their hours clipped to the drill's period. */
export function drillFigures(rows: readonly EventRow[], drill: Pick<DrillState, 'eventIds' | 'rowIds' | 'range'>): DrillFigures {
  const iv = drill.range ? rangeToInterval(drill.range as DateRange) : null;
  let hours = 0;
  for (const r of rows) if (!r.is_void && !isBlocked(r)) hours += rowHours(r, iv);
  if (drill.eventIds?.length) {
    const ids = new Set(drill.eventIds);
    return { count: rows.filter((r) => ids.has(r.event_id)).length, unit: 'events', rows: rows.length, hours };
  }
  return { count: rows.length, unit: 'records', rows: rows.length, hours };
}

/** The page the drill came from, by its short tab name ('Pareto', 'Dashboard'); else the source word it carries. */
export function drillPageName(drill: Pick<DrillState, 'back' | 'source'>): string {
  const p = drill.back ? pageForPath(drill.back.pathname) : undefined;
  return p ? pageTab(p) : t(drill.source);
}

/**
 * The item the chart showed: the drill label without its article and the kind of mark ('the Pareto bar 141.VL170' ->
 * '141.VL170', 'the top equipment bar 131.GB140' -> '131.GB140', 'the event EV-1' -> 'Event EV-1').
 */
export function drillItem(label: string): string {
  const s = label.trim().replace(/^the\s+/i, '').replace(/^(Pareto bar|top equipment bar)\s+/i, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** One decimal, like the bars: '15.7 h'. */
export const hoursText = (h: number): string => `${num(Math.round(h * 10) / 10)} h`;

/** 'Pareto bar 141.VL170 · Aug 2026 · 9 events, 15.7 h' (no page; the banner draws 'From: Pareto ›' before it). */
export function drillSummaryText(drill: Pick<DrillState, 'label' | 'range'>, f: DrillFigures): string {
  const what = f.unit === 'events'
    ? (f.count === 1 ? t('1 event') : t('{n} events', { n: num(f.count) }))
    : (f.count === 1 ? t('1 record') : t('{n} records', { n: num(f.count) }));
  const rows = f.unit === 'events' && f.rows !== f.count ? ` (${t('{n} rows', { n: num(f.rows) })})` : '';
  return [drillItem(drill.label), drill.range ? rangeText(drill.range) : '', `${what}${rows}, ${hoursText(f.hours)}`].filter(Boolean).join(' · ');
}

/** The phone's sticky chip: the item without its kind, the period and the count ('141.VL170 · Aug 2026 · 9 events'). */
export function drillShortText(drill: Pick<DrillState, 'label' | 'range'>, f: DrillFigures): string {
  const item = drillItem(drill.label);
  const what = f.unit === 'events'
    ? (f.count === 1 ? t('1 event') : t('{n} events', { n: num(f.count) }))
    : (f.count === 1 ? t('1 record') : t('{n} records', { n: num(f.count) }));
  return [item, drill.range ? rangeText(drill.range) : '', what].filter(Boolean).join(' · ');
}

/** The banner as one line of text: 'From: Pareto › Pareto bar 141.VL170 · Aug 2026 · 9 events, 15.7 h'. */
export function drillBannerText(drill: DrillState, f: DrillFigures): string {
  return `${t('From')}: ${drillPageName(drill)} › ${drillSummaryText(drill, f)}`;
}

/**
 * Do the records add up to the bar? 'match' when the hours agree to the shown decimal, 'differs' when not (the chart
 * counts time that overlaps in one area once; the records list every stop with its own time), null when the drill did
 * not carry the bar's figure (an older link, a notification).
 */
export function drillMatch(f: DrillFigures, drill: Pick<DrillState, 'bar'>): 'match' | 'differs' | null {
  if (!drill.bar || !Number.isFinite(drill.bar.hours)) return null;
  return Math.round(f.hours * 10) === Math.round(drill.bar.hours * 10) ? 'match' : 'differs';
}
