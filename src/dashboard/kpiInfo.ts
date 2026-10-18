// Plain-words explanations for the hero KPIs (the (i) buttons). They describe the rules the numbers follow.
import { t } from '../i18n/t';
import type { Targets } from './targets';

export type HeroId = 'total-hours' | 'failure-count' | 'availability' | 'reliability' | 'utilization' | 'mttr' | 'mtbf' | 'running-hours';

/** The numbers of the Running hours tile, for its live example. */
export interface RunningExample { perDay: string; scheduled: string; stopped: string; running: string; days: number; areas: number; notUploaded: string[]; change?: string }

/** A part of the explanation: what it shows, the formulas, how it is calculated, a live example. */
export interface InfoSection { kind: 'what' | 'formula' | 'how' | 'example'; heading: string; items: string[] }

/** The numbers on the KPI row, already formatted as the cards show them, for the worked example in each (i). */
export interface KpiLive {
  T: string; pl: string; inc: string; cir: string; down: string; run: string; failures: string;
  /** summed length of the failure events (the MTTR numerator) */
  eventHours: string;
  mtbf: string; mttr: string; rf: string; uf: string;
  perDay: string; days: number; areas: number;
}

export interface KpiInfo {
  title: string;
  paragraphs: string[];
  sections?: InfoSection[];
  /** the help text's key (chart help) */
  id?: string;
}

const BASIS_TEXT = {
  A: 'Basis A: scheduled time minus all stops, divided by scheduled time.',
  B: 'Basis B: scheduled time minus planned stops is the time the area was expected to run. Availability is that time minus failure and other stops, divided by it.',
  C: 'Basis C: scheduled time minus planned and other (circumstantial) stops is the time the area was expected to run. Availability is that time minus failure stops, divided by it.',
} as const;

/** The equations of each card, in words a reader can check with a calculator. */
function formulas(id: HeroId): string[] {
  switch (id) {
    case 'total-hours': return [t('Total stoppage = INC + PL + CIR (hours)')];
    case 'failure-count': return [t('Failures = number of failure events that started in the period')];
    case 'reliability': return [
      t('RF = Running ÷ (Running + INC) × 100'),
      t('Running = T − PL − INC − CIR'),
      t('T = scheduled hours per day × days × areas'),
      t('Same as: RF = MTBF ÷ (MTBF + INC hours per failure)'),
    ];
    case 'mtbf': return [t('MTBF = Running hours ÷ Failures'), t('Running = T − PL − INC − CIR')];
    case 'mttr': return [t('MTTR = total length of the failure events ÷ Failures')];
    case 'utilization': return [t('UF = Running ÷ T × 100'), t('Running = T − PL − INC − CIR'), t('T = scheduled hours per day × days × areas')];
    case 'availability': return [t('Availability = (T − PL − INC − CIR) ÷ (T − PL) × 100 (basis B)')];
    case 'running-hours': return [t('Running = T − (PL + INC + CIR)'), t('T = scheduled hours per day × days × areas')];
  }
}

/** The equation again with the numbers on the card. */
function worked(id: HeroId, n: KpiLive): string[] {
  const T = t('{h} h × {d} days × {a} areas = {T} h', { h: n.perDay, d: n.days, a: n.areas, T: n.T });
  const run = t('Running = {T} − {pl} − {inc} − {cir} = {r} h', { T: n.T, pl: n.pl, inc: n.inc, cir: n.cir, r: n.run });
  switch (id) {
    case 'total-hours': return [t('{inc} + {pl} + {cir} = {d} h', { inc: n.inc, pl: n.pl, cir: n.cir, d: n.down })];
    case 'failure-count': return [t('{n} failure events; together they stopped the areas {h} h (INC hours {inc} h).', { n: n.failures, h: n.eventHours, inc: n.inc })];
    case 'reliability': return [T, run, t('RF = {r} ÷ ({r} + {inc}) = {rf}%', { r: n.run, inc: n.inc, rf: n.rf })];
    case 'mtbf': return n.failures === '0' ? [] : [run, t('MTBF = {r} ÷ {n} = {m} h', { r: n.run, n: n.failures, m: n.mtbf })];
    case 'mttr': return n.failures === '0' ? [] : [t('MTTR = {h} h ÷ {n} = {m} h', { h: n.eventHours, n: n.failures, m: n.mttr })];
    // T and the running hours are in the 'Here:' line of the running-hours text above
    case 'utilization': return [run, t('UF = {r} ÷ {T} = {uf}%', { r: n.run, T: n.T, uf: n.uf })];
    case 'running-hours': return [T, run];
    case 'availability': return [];
  }
}

export function kpiInfo(id: HeroId, basis: 'A' | 'B' | 'C', targets?: Targets, running?: RunningExample, live?: KpiLive): KpiInfo {
  const info = baseInfo(id, basis);
  if (id !== 'availability') {
    info.sections = [{ kind: 'formula', heading: t('Formula'), items: formulas(id) }];
    const ex = live ? worked(id, live) : [];
    if (ex.length) info.sections.push({ kind: 'formula', heading: t('With the numbers on this card'), items: ex });
  }
  if ((id === 'running-hours' || id === 'utilization') && running) {
    if (id === 'utilization') info.paragraphs.push(...baseInfo('running-hours', basis).paragraphs.slice(0, 3));
    info.paragraphs.push(t('Here: {h} h × {d} days × {a} areas = {T} h scheduled − {S} h stopped = {R} h running.', { h: running.perDay, d: running.days, a: running.areas, T: running.scheduled, S: running.stopped, R: running.running })
      + (running.notUploaded.length ? ` ${t('Not uploaded, left out: {m}.', { m: running.notUploaded.join(', ') })}` : ''));
    if (running.change) info.paragraphs.push(t('Running hours: {c}.', { c: running.change }));
  }
  if (id === 'availability' && targets?.availabilityPct != null) {
    info.paragraphs.push(t('Target: {x}%, set in Settings. The card says whether the availability is on target (at or above it) or below it.', { x: targets.availabilityPct }));
  }
  if (id === 'reliability' && targets?.reliabilityPct != null) {
    info.paragraphs.push(t('Target: {x}%, set in Settings. The card says whether the reliability factor is on target (at or above it) or below it.', { x: targets.reliabilityPct }));
  }
  if (id === 'mtbf' && targets?.mtbfH != null) {
    info.paragraphs.push(t('Target: {x} h, set in Settings. The card says whether the MTBF is on target (at or above it) or below it.', { x: targets.mtbfH }));
  }
  if (id === 'mttr' && targets?.mttrH != null) {
    info.paragraphs.push(t('Target: {x} h, set in Settings. The card says whether the restoration time is on target (at or below it) or above it. A lower value is better.', { x: targets.mttrH }));
  }
  return info;
}

function baseInfo(id: HeroId, basis: 'A' | 'B' | 'C'): KpiInfo {
  switch (id) {
    case 'total-hours':
      return {
        title: t('Total stoppage hours'),
        paragraphs: [
          t('Every hour an area stood still in the selected range: failures, planned stops (PL) and other circumstantial stops (CIR) added together.'),
          t('The hours are counted per area and then added up (area-hours), so two areas stopped at the same time count twice. A stop that crosses midnight or the end of the range counts only the hours inside the range.'),
          t('Inside one area, stops that overlap in time are counted once. The shared time goes to planned (PL) first, then incidental, then CIR; between stops of the same kind, to the one that started first. An exact duplicate record counts once.'),
          t('Records with a blocking data problem and voided records are left out.'),
        ],
      };
    case 'failure-count':
      return {
        title: t('Failure count'),
        paragraphs: [
          t('How many failure events started in the selected range. A failure event starts with a row that has Freq 1 and Failure YES and is not planned (PL) or CIR; the rows that carry it on are the same failure and are not counted again.'),
          t('Planned stops and other circumstantial stops are not failures, even when their Failure column says YES (Validate lists those rows).'),
        ],
      };
    case 'availability':
      return {
        title: t('Availability (basis {b})', { b: basis }),
        paragraphs: [
          t('The share of the expected running time in which the areas were actually available.'),
          t(BASIS_TEXT[basis]),
          t('It is worked out from the summed area-hours, never as an average of area percentages. The basis is chosen in Settings; all three bases are shown on the card.'),
        ],
      };
    case 'reliability':
      return {
        title: t('Reliability factor (RF)'),
        paragraphs: [
          t('Of the time the areas were meant to run, the share they were not stopped by their own failures.'),
          t('RF = running hours ÷ (running hours + incidental hours). Running hours = scheduled time − planned − incidental − CIR. Planned stops and CIR stops do not lower the RF: they are not failures of the equipment.'),
          t('It also equals MTBF ÷ (MTBF + incidental hours per failure), so a high MTBF with long repairs can still give a low RF. It is the same arithmetic as availability basis C.'),
          t('Worked out from the summed area-hours, never as an average of area percentages. An area with no running time in the period shows no RF; one that ran only a few hours gives an RF that says little.'),
        ],
      };
    case 'utilization':
      return {
        title: t('Utilization factor (UF)'),
        paragraphs: [
          t('The share of the calendar the areas actually ran.'),
          t('UF = running hours ÷ scheduled (calendar) hours. Every stop lowers it: planned, incidental and CIR. It is the same arithmetic as availability basis A.'),
          t('A low UF with a high RF means the areas were stopped for planned work or outside reasons, not because they failed.'),
        ],
      };
    case 'mtbf':
      return {
        title: t('MTBF · all areas (area-hours)'),
        paragraphs: [
          t('Mean time between failures: the operating hours of all areas in scope added up (area-hours: scheduled time minus every stop, overlaps counted once) divided by the number of failure events that started in the range.'),
          t('The same rule is used on every page, in reports and in exports. MTBF per area (that area\'s operating hours divided by its failure events) is in the Areas table and on the Reliability page.'),
          t('With no failure in the range the MTBF is not defined, never infinite or zero.'),
        ],
      };
    case 'running-hours':
      return {
        title: t('Running hours'),
        paragraphs: [
          t('The hours the areas in scope were not stopped: scheduled time minus every recorded stop, added up over the areas (area-hours).'),
          t('Running hours = T − stopped hours. T = scheduled hours per day (24 h unless Settings say otherwise) × days in the period × areas; months not uploaded are left out. Stopped hours = planned + incidental + other, overlapping stops in one area counted once.'),
          t('It is derived from the stop records, NOT measured run hours from the plant: an area with no record is counted as running, and an unrecorded stop is counted as running time.'),
          t('Higher is better. The change is against the comparison period; when that period is only partly covered it is compared per day.'),
        ],
      };
    case 'mttr':
      return {
        title: t('Mean restoration time'),
        paragraphs: [
          t('The average length of a failure: from the stop until production restarted, for failures that started in the selected range.'),
          t('A failure that continues over several rows is one failure with its full length. If there was no failure in the range the value is not defined.'),
        ],
      };
  }
}
