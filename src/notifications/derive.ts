// ACTION items: conditions the app can see in the data it has loaded. They are never stored, never dismissed or
// snoozed, and they go away by themselves when the data is fixed. One item per cause, with a count (never one per row).
//
//  - records to validate: the Validate count (blocking + warnings; information-only flags such as code_not_in_area
//    are not problems and never counted here, see src/validate/model.ts)
//  - unknown or placeholder codes used by stored events, grouped per code
//  - equipment flagged needs_review
//
// Pending late-month upload decisions exist only inside an upload in progress; the client cannot know them: skipped.
// Items exist only for people who can act on them (Edit on events / master); viewers get none.
import type { EventRow } from '../api/types';
import { codeKey, splitFlags } from '../calc';
import { t, tn } from '../i18n/t';
import { num } from '../util/format';
import type { FeedItem } from './model';

export interface DeriveAccess { editEvents: boolean; editMaster: boolean; viewEvents: boolean; viewMaster: boolean }

export interface DeriveInput {
  /** null until every year of events is loaded (nothing is derived meanwhile) */
  validation: { total: number; blocked: number } | null;
  events: readonly EventRow[] | null;
  /** equipment with needs_review; null until master data is loaded */
  needsReview: number | null;
  access: DeriveAccess;
  /** most per-code items before the rest are folded into one (default 5) */
  maxCodeItems?: number;
}

export interface CodeGroup { code: string; count: number; placeholder: boolean }

/** Stored events (not voided, with a code) whose flags say the code is unknown or a placeholder, per code, most rows first. */
export function groupProblemCodes(events: readonly EventRow[]): CodeGroup[] {
  const byKey = new Map<string, CodeGroup>();
  for (const e of events) {
    if (e.is_void) continue;
    const raw = (e.code_raw ?? '').trim();
    if (!raw) continue;
    const flags = splitFlags(e.flags);
    const placeholder = flags.includes('placeholder');
    if (!placeholder && !flags.includes('unknown_code')) continue;
    const key = codeKey(raw);
    const g = byKey.get(key);
    if (g) {
      g.count++;
      g.placeholder = g.placeholder || placeholder;
    } else byKey.set(key, { code: raw, count: 1, placeholder });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

const base = (id: string, type: FeedItem['type'], title: string, detail: string): FeedItem => ({
  id: `action:${id}`, kind: 'action', type, title, detail, area_id: '', line_id: '', created_at: '', source_ref: '', dedupe_key: `action|${id}`,
  link: null, linkLabel: '', unseen: false,
});

export function deriveActionItems(input: DeriveInput): FeedItem[] {
  const { access, validation, events, needsReview } = input;
  const out: FeedItem[] = [];

  // (a) records to validate
  if (access.editEvents && access.viewEvents && validation && validation.total > 0) {
    const { total, blocked } = validation;
    const item = base(
      'validate', 'validate',
      blocked > 0
        ? (total === 1 ? t('1 record needs checking, {b} left out of the numbers', { b: num(blocked) }) : t('{n} records need checking, {b} left out of the numbers', { n: num(total), b: num(blocked) }))
        : tn(total, '{n} record needs checking', '{n} records need checking'),
      blocked > 0 ? t('Blocked records stay out of every figure.') : t('They are used as they are.'),
    );
    item.link = { to: '/validate' };
    item.linkLabel = t('Open Validate');
    out.push(item);
  }

  // (b) unknown or placeholder codes, grouped per code
  if ((access.editEvents || access.editMaster) && events) {
    const groups = groupProblemCodes(events);
    const max = input.maxCodeItems ?? 5;
    const toMaster = access.editMaster;
    const link = (g: CodeGroup | null) => {
      if (toMaster) return { to: '/master' };
      if (!access.viewEvents) return null;
      const flag = g ? (g.placeholder ? 'placeholder' : 'unknown_code') : 'unknown_code,placeholder';
      const sp = new URLSearchParams();
      sp.set('flag', flag);
      if (g) sp.set('q', g.code);
      return { to: `/validate?${sp.toString()}` };
    };
    const label = toMaster ? t('Open Master Data') : t('See records');
    for (const g of groups.slice(0, max)) {
      const item = base(
        `code:${codeKey(g.code)}`, 'unknown_code',
        t(g.count === 1
          ? (g.placeholder ? '{n} row: placeholder code {code}' : '{n} row: unknown code {code}')
          : (g.placeholder ? '{n} rows: placeholder code {code}' : '{n} rows: unknown code {code}'), { n: num(g.count), code: g.code }),
        toMaster ? t('Add it in Master Data or fix the rows.') : t('Correct the code on these rows.'),
      );
      item.link = link(g);
      item.linkLabel = label;
      out.push(item);
    }
    const rest = groups.slice(max);
    if (rest.length > 0) {
      const rows = rest.reduce((s, g) => s + g.count, 0);
      const item = base(
        'code:more', 'unknown_code',
        t('{r} more rows: {c} other unknown or placeholder codes', { r: num(rows), c: num(rest.length) }),
        t('Open the list to see every code.'),
      );
      item.link = link(null);
      item.linkLabel = label;
      out.push(item);
    }
  }

  // (c) equipment that needs review
  if (access.editMaster && access.viewMaster && needsReview !== null && needsReview > 0) {
    const item = base(
      'needs_review', 'needs_review',
      tn(needsReview, '{n} equipment code needs review', '{n} equipment codes need review'),
      t('No description, criticality or area yet.'),
    );
    item.link = { to: '/master?review=1' };
    item.linkLabel = t('Review equipment');
    out.push(item);
  }
  return out;
}
