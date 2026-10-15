// The notification rules for the mock API (docs/notifications-design.md). They are written with the calc library
// (the same code the screens use), while backend/apps-script/Notifications.js has its own plain-JS port of the same
// formulas. tests/unit/contract.test.ts runs both over the same scenarios, so the two cannot drift apart.
import { ApiError, REPORT_PRESETS, REPORT_SECTION_IDS, REPORT_TEMPLATES, SAVED_REPORTS_MAX, type Action, type ActionTask, type Area, type AreaTarget, type EventRow, type NotificationSeverity, type NotificationType, type Setting, type UploadBatch } from './types';
import { actionDueAlerts, plannedOverruns, plannedOverrunText, readyAlerts, taskOverdueAlerts } from './mockActions';
import { isValidDate } from '../util/normalize';
import {
  addDays, buildFailureEvents, computeKpis, findClusters, groupOccurrences, lastDayOfMonth, matchKey, monthRange, parseSettings, rowCode,
  parseDate, MS_DAY, type CalcSettings, type ChainedEvent, type MasterIndex,
} from '../calc';

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
  /** backend 1.7.0: who sees it ('' = everyone; user ids and/or @closers) */
  recipients?: string;
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
  /** area targets (planned_overrun, backend 1.4.0) */
  targets?: AreaTarget[];
  /** actions (action_due, backend 1.4.0) */
  actions?: Action[];
  /** tasks of the actions (task_overdue, action_ready_to_close and the action due date, backend 1.7.0) */
  tasks?: ActionTask[];
}

/** Data-driven candidates in a fixed order: long stops, repeated groups, spikes, availability, upload gap. */
export function notificationCandidates(input: RuleInput): Candidate[] {
  const { areas, index, settings: st, today } = input;
  const events = input.events.filter((e) => !e.is_void);
  let latest = '';
  for (const e of events) if (e.event_date > latest) latest = e.event_date;
  // action_due, task_overdue and action_ready_to_close do not depend on the events (ports of notifRuleActionDue_,
  // notifRuleTaskOverdue_ and notifRuleReady_), in the server's order
  const acts = input.actions ?? [];
  const tasks = input.tasks ?? [];
  const due = [...actionDueAlerts(acts, tasks, today), ...taskOverdueAlerts(acts, tasks, today), ...readyAlerts(acts, tasks)]
    .map((a) => ({ ...alert(a.type, a.key, a.title, a.detail, a.area, a.line, a.ref), recipients: a.recipients }));
  if (!latest) return due;
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
      // P5: the same code and reason in different areas within 10 minutes is one occurrence
      const occs = groupOccurrences(g.list);
      for (const cl of findClusters(occs.map((o) => o.startMs), st.calc.repeatMinEvents, st.calc.repeatWindowDays)) {
        const first = occs[cl[0]!]!.members[0]!;
        const last = occs[cl[cl.length - 1]!]!.members[0]!;
        if (last.startDate < cutoff) continue;
        out.push(alert('repeat_group', `repeat|${first.area_id}|${g.code}|${g.reasonKey}|${first.id}`,
          `Repeated failure: ${g.code} - ${oneLine(first.head.reason_raw, 120)}`,
          `${cl.length} failures within ${st.calc.repeatWindowDays} days, latest ${last.startDate}. First in ${first.area_id}.`,
          first.area_id, lineOf(first.area_id, first.line_id), first.id));
      }
    }
  }

  // failure_spike: failure EVENTS (P2) that started in the 30 days to the latest event date vs the 30 days before
  const nowFrom = parseDate(addDays(latest, -29))!;
  const nowTo = parseDate(latest)! + MS_DAY;
  const prevFrom = nowFrom - 30 * MS_DAY;
  const counts = new Map<string, { now: number; prev: number }>();
  for (const ch of chains) {
    if (!ch.isFailure) continue;
    const c = counts.get(ch.area_id) ?? { now: 0, prev: 0 };
    counts.set(ch.area_id, c);
    if (ch.startMs >= nowFrom && ch.startMs < nowTo) c.now++;
    else if (ch.startMs >= prevFrom && ch.startMs < nowFrom) c.prev++;
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

  // availability_low: basis B of the latest complete month, only when a target is set. computeKpis counts overlapping
  // stops of one area once (P1) and gives no_data for a month that was not uploaded (P6).
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

  // planned_overrun (1.4.0): planned hours of a complete, recent month above the area's allowance (mockActions.ts plannedOverruns)
  for (const o of plannedOverruns(events, areas, input.targets ?? [], latest, cutoff)) {
    const t = plannedOverrunText(o);
    out.push(alert('planned_overrun', `planned|${o.area}|${o.month}`, t.title, t.detail, o.area, o.line));
  }

  // upload_gap
  const days = Math.round((parseDate(today)! - parseDate(latest)!) / MS_DAY);
  if (days > st.uploadGapDays) {
    out.push(alert('upload_gap', `upload_gap|${latest}`, `No upload since ${latest}`,
      `The latest stored event is dated ${latest}, ${days} days ago (limit ${st.uploadGapDays} days).`, '', ''));
  }
  out.push(...due);
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

// ---------------------------------------------------------------- saved report templates (preference saved_reports)

const REPORT_CLASSES = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];

/** Same rules as cleanSavedReports_ in backend/apps-script/Notifications.js (tests/unit/contract.test.ts runs both). */
export function cleanSavedReports(text: string): string {
  const bad = (m: string) => new ApiError(m, 'bad_request');
  if (text === '') return '';
  if (text.length > 20000) throw bad('Saved reports are too long.');
  let list: unknown;
  try { list = JSON.parse(text); } catch { throw bad('Saved reports are not readable.'); }
  if (!Array.isArray(list)) throw bad('Saved reports must be a list.');
  if (list.length > SAVED_REPORTS_MAX) throw bad(`You can save at most ${SAVED_REPORTS_MAX} report templates.`);
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const only = (o: Record<string, unknown>, keys: string[], what: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad(`${what} has an unknown field: ${oneLine(k, 40)}.`);
  };
  const strList = (v: unknown, label: string, allowed?: readonly string[]) => {
    if (!Array.isArray(v)) throw bad(`Report ${label} must be a list.`);
    if (v.length > 100) throw bad(`Report ${label} has too many entries.`);
    const seen = new Set<string>();
    for (const x of v) {
      if (typeof x !== 'string' || !x || x.length > 60) throw bad(`Report ${label} must be text of 1 to 60 characters.`);
      if (allowed && !allowed.includes(x)) throw bad(`Report ${label} has an unknown value: ${oneLine(x, 40)}.`);
      if (seen.has(x)) throw bad(`Report ${label} repeats a value.`);
      seen.add(x);
    }
  };
  const seenIds = new Set<string>();
  for (const v of list) {
    if (!isObj(v)) throw bad('Each saved report must be an object.');
    only(v, ['id', 'name', 'template', 'period', 'filters', 'sections', 'options'], 'A saved report');
    if (typeof v.id !== 'string' || !v.id || v.id.length > 40) throw bad('A saved report needs an id of 1 to 40 characters.');
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60) throw bad('A saved report needs a name of 1 to 60 characters.');
    if (typeof v.template !== 'string' || !(REPORT_TEMPLATES as readonly string[]).includes(v.template)) throw bad(`A saved report template must be one of: ${REPORT_TEMPLATES.join(', ')}.`);
    const p = v.period;
    if (!isObj(p)) throw bad('A saved report needs a period.');
    only(p, ['preset', 'from', 'to', 'compare'], 'A saved report period');
    if (typeof p.preset !== 'string' || !(REPORT_PRESETS as readonly string[]).includes(p.preset)) throw bad(`A saved report period preset must be one of: ${REPORT_PRESETS.join(', ')}.`);
    for (const k of ['from', 'to'] as const) {
      const d = p[k];
      if (typeof d !== 'string' || (d !== '' && !isValidDate(d))) throw bad(`A saved report period ${k} must be a date like 2026-03-05 or blank.`);
    }
    if (p.from && p.to && (p.from as string) > (p.to as string)) throw bad('A saved report period must not end before it starts.');
    if (typeof p.compare !== 'boolean') throw bad('A saved report period compare must be true or false.');
    const f = v.filters;
    if (!isObj(f)) throw bad('A saved report needs filters.');
    only(f, ['lines', 'areas', 'equipment', 'classifications', 'criticality', 'failuresOnly'], 'A saved report filter set');
    strList(f.lines, 'lines');
    strList(f.areas, 'areas');
    strList(f.equipment, 'equipment');
    strList(f.classifications, 'classifications', REPORT_CLASSES);
    strList(f.criticality, 'criticality', ['INC', 'NO_INC']);
    if (typeof f.failuresOnly !== 'boolean') throw bad('A saved report failuresOnly must be true or false.');
    strList(v.sections, 'sections', REPORT_SECTION_IDS);
    const o = v.options;
    if (!isObj(o)) throw bad('A saved report needs options.');
    for (const sid of Object.keys(o)) {
      if (!(REPORT_SECTION_IDS as readonly string[]).includes(sid)) throw bad(`A saved report has options for an unknown section: ${oneLine(sid, 40)}.`);
      const so = o[sid];
      if (!isObj(so)) throw bad('Report options of a section must be an object.');
      only(so, ['top', 'measure'], 'Report options');
      if (so.top !== undefined && so.top !== 'all' && !(typeof so.top === 'number' && Number.isInteger(so.top) && so.top >= 1 && so.top <= 1000)) throw bad('Report option top must be a whole number from 1 to 1000 or "all".');
      if (so.measure !== undefined && so.measure !== 'hours' && so.measure !== 'count') throw bad('Report option measure must be hours or count.');
    }
    if (seenIds.has(v.id)) throw bad('Two saved reports have the same id.');
    seenIds.add(v.id);
  }
  return text;
}
