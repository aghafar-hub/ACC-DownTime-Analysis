// Fetches what the comparison needs (fresh master data, every stored year the
// file touches, the edit history of corrected events) and builds the review.
import { api, describeError } from '../api';
import type { EventRow, Startup } from '../api/types';
import { eventsResource, startupResource } from '../data/stores';
import { t } from '../i18n/t';
import type { ParsedFile } from './parseWorkbook';
import { buildReview, type Review } from './review';

/**
 * Years to load: every year from the file's first year up to the latest stored year. A late row is
 * "on or before the latest stored date", so a file for an older month needs the newer years too.
 */
export function yearsToLoad(parsed: Pick<ParsedFile, 'dateFrom' | 'dateTo'>, storedYears: number[]): number[] {
  if (!parsed.dateFrom) return [];
  const first = Number(parsed.dateFrom.slice(0, 4));
  const last = Math.max(Number(parsed.dateTo.slice(0, 4)), ...storedYears, first);
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out;
}

export async function loadReview(token: string, parsed: ParsedFile, onStage: (text: string) => void): Promise<Review> {
  onStage(t('Loading the master data…'));
  await startupResource.load(token, true);
  const startup: Startup | null = startupResource.getSnapshot().data;
  if (!startup) throw new Error(startupResource.getSnapshot().error ?? t('The master data could not be loaded.'));

  const years = yearsToLoad(parsed, startup.years);
  const stored: EventRow[] = [];
  for (const y of years) {
    onStage(t('Loading the stored events of {year}…', { year: y }));
    try {
      stored.push(...(await api.getEvents(token, y)));
    } catch (err) {
      throw new Error(t('The stored events of {year} could not be loaded, so the file cannot be compared yet. {why}', { year: y, why: describeError(err) }));
    }
  }

  onStage(t('Comparing the file with the stored events…'));
  let review = buildReview(parsed, startup, stored);

  // events corrected in the app: find out which fields, so only real differences are reported
  const edited = review.edited.map((w) => w.event_id).filter((id): id is string => !!id);
  if (edited.length > 0) {
    try {
      const map = new Map<string, ReadonlySet<string>>();
      for (const id of new Set(edited)) {
        const edits = await api.getEventEdits(token, id);
        map.set(id, new Set(edits.map((e) => e.field)));
      }
      review = buildReview(parsed, startup, stored, map);
    } catch {
      /* the edit history needs access to Event Explorer; without it every field of a corrected event counts as corrected */
    }
  }
  return review;
}

/** After an upload: the dashboards must see the new rows. */
export function refreshAfterUpload(token: string, parsed: Pick<ParsedFile, 'dateFrom' | 'dateTo'>, storedYears: number[]): void {
  for (const y of yearsToLoad(parsed, storedYears)) void eventsResource(y).load(token, true);
  void startupResource.load(token, true);
}
