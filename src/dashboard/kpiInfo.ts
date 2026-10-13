// Plain-words explanations for the hero KPIs (the (i) buttons). They describe the rules the numbers follow.
import { t } from '../i18n/t';
import type { Targets } from './targets';

export type HeroId = 'total-hours' | 'failure-count' | 'availability' | 'mttr' | 'mtbf';

export interface KpiInfo { title: string; paragraphs: string[] }

const BASIS_TEXT = {
  A: 'Basis A: scheduled time minus all stops, divided by scheduled time.',
  B: 'Basis B: scheduled time minus planned stops is the time the area was expected to run. Availability is that time minus failure and other stops, divided by it.',
  C: 'Basis C: scheduled time minus planned and other (circumstantial) stops is the time the area was expected to run. Availability is that time minus failure stops, divided by it.',
} as const;

export function kpiInfo(id: HeroId, basis: 'A' | 'B' | 'C', targets?: Targets): KpiInfo {
  const info = baseInfo(id, basis);
  if (id === 'availability' && targets?.availabilityPct != null) {
    info.paragraphs.push(t('Target: {x}%, set in Settings. The card says whether the availability is on target (at or above it) or below it.', { x: targets.availabilityPct }));
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
          t('Inside one area, stops that overlap in time are counted once. The shared time goes to planned (PL) first, then incidental, then other (CIR); between stops of the same kind, to the one that started first. An exact duplicate record counts once.'),
          t('Records with a blocking data problem and voided records are left out.'),
        ],
      };
    case 'failure-count':
      return {
        title: t('Failure count'),
        paragraphs: [
          t('How many failure events started in the selected range. A failure event starts with a row that has Freq 1 and Failure YES and is not planned (PL) or other (CIR); the rows that carry it on are the same failure and are not counted again.'),
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
    case 'mtbf':
      return {
        title: t('MTBF · all areas (area-hours)'),
        paragraphs: [
          t('Mean time between failures: the operating hours of all areas in scope added up (area-hours: scheduled time minus every stop, overlaps counted once) divided by the number of failure events that started in the range.'),
          t('The same rule is used on every page, in reports and in exports. MTBF per area (that area\'s operating hours divided by its failure events) is in the Areas table and on the Reliability page.'),
          t('With no failure in the range the MTBF is not defined, never infinite or zero.'),
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
