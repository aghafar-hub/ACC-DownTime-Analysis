// The notification rules for the mock API (docs/notifications-design.md). They are written with the calc library
// (the same code the screens use), while backend/apps-script/Notifications.js has its own plain-JS port of the same
// formulas. tests/unit/contract.test.ts runs both over the same scenarios, so the two cannot drift apart.
import type { Area, EventRow, NotificationSeverity, NotificationType, Setting, UploadBatch } from './types';
import {
  addDays, buildFailureEvents, computeKpis, findClusters, lastDayOfMonth, matchKey, monthRange, parseSettings, rowCode,
  rowSpan, parseDate, MS_DAY, type CalcSettings, type ChainedEvent, type MasterIndex,
} from '../calc';
import { isBlocked } from '../calc';

export interface NotifSettings {
  longStopHours: number; spikePct: number; uploadGapDays: number; availabilityTargetPct: number | null;
  repeatAlert: boolean; retentionDays: number; appUrl: string; calc: CalcSettings;
}

function num(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}

/** Settings the rules read; a missing or invalid value falls back to the default from schema/tables.json. */
export function parseNotifSettings(settings: Setting[]): NotifSettings {
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  const target = (map.availability_target_pct ?? '').trim();
  const repeat = (map.notif_repeat_alert ?? 'true').trim().toLowerCase();
  const url = (map.app_url ?? '').trim();
  return {
    longStopHours: num(map.notif_long_stop_hours, 8, 0, 100000),
    spikePct: num(map.notif_spike_pct, 30, 0, 100000),
    uploadGapDays: num(map.notif_upload_gap_days, 35, 0, 100000),
    availabilityTargetPct: target === '' || !Number.isFinite(Number(target)) ? null : Number(target),
    repeatAlert: repeat !== 'false' && repeat !== '0' && repeat !== 'no',
    retentionDays: num(map.notif_retention_days, 30, 1, 100000),
    appUrl: /^https?:\/\//i.test(url) ? url : '',
    calc: parseSettings(settings),
  };
}

export interface Candidate {
  type: NotificationType; severity: NotificationSeverity; dedupe_key: string; title: string; detail: string;
  area_id: string; line_id: string; source_ref: string;
}

export const oneLine = (s: string | undefined | null, max: number): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}.` : t;
};

function alert(type: NotificationType, key: string, title: string, detail: string, area: string, line: string, ref = ''): Candidate {
  return { type, severity: 'alert', dedupe_key: key, title: oneLine(title, 200), detail: oneLine(detail, 500), area_id: area, line_id: line, source_ref: ref };
}

export interface RuleInput {
  /** every stored event (voided ones are left out here) */
  events: EventRow[];
  areas: Area[];
  index: MasterIndex;
  settings: NotifSettings;
  /** plant-local today, YYYY-MM-DD */
  today: string;
}

/** Data-driven candidates in a fixed order: long stops, repeated groups, spikes, availability, upload gap. */
export function notificationCandidates(input: RuleInput): Candidate[] {
  const { areas, index, settings: st, today } = input;
  const events = input.events.filter((e) => !e.is_void);
  let latest = '';
  for (const e of events) if (e.event_date > latest) latest = e.event_date;
  if (!latest) return [];
  const cutoff = addDays(latest, -st.retentionDays);
  const lineOf = (area: string, fallback = ''): string => areas.find((a) => a.area_id === area)?.line_id ?? fallback;
  const chains = buildFailureEvents(events).chains;
  const out: Candidate[] = [];

  // long_stop
  for (const c of chains) {
    if (!c.isFailure || !(c.durationS / 3600 > st.longStopHours) || c.startDate < cutoff) continue;
    const h = (c.durationS / 3600).toFixed(1);
    out.push(alert('long_stop', `long_stop|${c.id}`, `Long stop: ${c.area_id} ${h} h`,
      `A failure stopped ${c.area_id} for ${h} hours (limit ${st.longStopHours} h), starting ${c.head.stop_ts.slice(0, 16)}.`,
      c.area_id, lineOf(c.area_id, c.line_id), c.id));
  }

  // repeat_group
  if (st.repeatAlert) {
    const groups = new Map<string, { code: string; reasonKey: string; list: ChainedEvent[] }>();
    for (const c of chains) {
      if (!c.isFailure) continue;
      const rc = rowCode(c.head, index);
      if (rc.kind === 'area_level') continue;
      const code = rc.kind === 'equipment' ? rc.equipmentId.toUpperCase() : rc.key;
      const reasonKey = matchKey(c.head.reason_raw);
      if (reasonKey === '') continue;
      const key = `${code}|${reasonKey}`;
      const g = groups.get(key);
      if (g) g.list.push(c); else groups.set(key, { code, reasonKey, list: [c] });
    }
    for (const g of groups.values()) {
      g.list.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
      for (const cl of findClusters(g.list.map((c) => c.startMs), st.calc.repeatMinEvents, st.calc.repeatWindowDays)) {
        const first = g.list[cl[0]!]!;
        const last = g.list[cl[cl.length - 1]!]!;
        if (last.startDate < cutoff) continue;
        out.push(alert('repeat_group', `repeat|${first.area_id}|${g.code}|${g.reasonKey}|${first.id}`,
          `Repeated failure: ${g.code} - ${oneLine(first.head.reason_raw, 120)}`,
          `${cl.length} failures within ${st.calc.repeatWindowDays} days, latest ${last.startDate}. First in ${first.area_id}.`,
          first.area_id, lineOf(first.area_id, first.line_id), first.id));
      }
    }
  }

  // failure_spike: failures (rows with is_failure) in the 30 days to the latest event date vs the 30 days before
  const analysable = events.filter((e) => !isBlocked(e));
  const nowFrom = parseDate(addDays(latest, -29))!;
  const nowTo = parseDate(latest)! + MS_DAY;
  const prevFrom = nowFrom - 30 * MS_DAY;
  const counts = new Map<string, { now: number; prev: number }>();
  for (const e of analysable) {
    if (!e.is_failure) continue;
    const span = rowSpan(e);
    if (!span) continue;
    const c = counts.get(e.area_id) ?? { now: 0, prev: 0 };
    counts.set(e.area_id, c);
    if (span.fromMs >= nowFrom && span.fromMs < nowTo) c.now++;
    else if (span.fromMs >= prevFrom && span.fromMs < nowFrom) c.prev++;
  }
  for (const area of [...counts.keys()].sort()) {
    const c = counts.get(area)!;
    if (c.now < 5) continue;
    const pct = c.prev === 0 ? null : ((c.now - c.prev) / c.prev) * 100;
    if (pct !== null && !(pct > st.spikePct)) continue;
    out.push(alert('failure_spike', `spike|${area}|${latest}`,
      pct === null ? `Failures rising in ${area}: ${c.now} (none before)` : `Failures up ${Math.round(pct)}% in ${area}`,
      `${c.now} failures in the 30 days to ${latest}, against ${c.prev} in the 30 days before.`, area, lineOf(area)));
  }

  // availability_low: basis B of the latest complete month, only when a target is set
  if (st.availabilityTargetPct !== null) {
    let month = latest.slice(0, 7);
    if (latest !== lastDayOfMonth(month)) {
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7)) - 1;
      month = m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
    }
    const k = computeKpis({ rows: events, window: monthRange(month), settings: { ...st.calc, availabilityBasis: 'B' } });
    if (k.status === 'ok') {
      for (const a of [...k.areas].sort((x, y) => (x.area_id < y.area_id ? -1 : x.area_id > y.area_id ? 1 : 0))) {
        const b = a.availability.B;
        if (!b.available) continue;
        const pct = b.value * 100;
        if (!(pct < st.availabilityTargetPct)) continue;
        out.push(alert('availability_low', `availability|${a.area_id}|${month}`,
          `Availability below target: ${a.area_id} ${pct.toFixed(1)}%`,
          `${month}: availability ${pct.toFixed(1)}% against a target of ${String(st.availabilityTargetPct)}% (basis B).`,
          a.area_id, lineOf(a.area_id)));
      }
    }
  }

  // upload_gap
  const days = Math.round((parseDate(today)! - parseDate(latest)!) / MS_DAY);
  if (days > st.uploadGapDays) {
    out.push(alert('upload_gap', `upload_gap|${latest}`, `No upload since ${latest}`,
      `The latest stored event is dated ${latest}, ${days} days ago (limit ${st.uploadGapDays} days).`, '', ''));
  }
  return out;
}

export function uploadDoneCandidate(b: UploadBatch): Candidate {
  return {
    type: 'upload_done', severity: 'update', dedupe_key: `upload|${b.batch_id}`,
    title: `Workbook uploaded: ${oneLine(b.file_name, 80) || 'workbook'} (+${b.rows_added} rows)`,
    detail: `Read ${b.rows_read}, added ${b.rows_added}, identical ${b.rows_identical}, skipped ${b.rows_skipped}, warnings ${b.warning_count}.`,
    area_id: '', line_id: '', source_ref: b.batch_id,
  };
}

export function userEventCandidate(
  kind: 'created' | 'password_reset' | 'role_changed',
  actor: { display_name: string; email: string },
  target: { user_id: string; display_name: string; email: string; role_id: string },
  roleChange: string,
  nowMs: number,
): Candidate {
  const who = target.display_name || target.email;
  const by = actor.display_name || actor.email || 'An administrator';
  const [title, detail] =
    kind === 'created' ? [`User created: ${who}`, `${by} created the account for ${target.email} (role ${target.role_id}).`]
      : kind === 'password_reset' ? [`Password reset: ${who}`, `${by} reset the password of ${target.email}; a temporary password was issued.`]
        : [`Role changed: ${who}`, `${by} changed the role of ${target.email} ${roleChange}.`];
  return {
    type: 'user_event', severity: 'update', dedupe_key: `user|${kind}|${target.user_id}|${nowMs}`,
    title: oneLine(title, 200), detail: oneLine(detail, 500), area_id: '', line_id: '', source_ref: target.user_id,
  };
}
