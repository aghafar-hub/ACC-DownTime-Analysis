// What the "Create action" dialog is filled in with when it is opened from somewhere: a notification, a Pareto bar, a
// repeated-failure row, an event record or a built report. Pure; the caller passes what it knows.
import type { EventRow, NotificationCategory } from '../api/types';
import { t } from '../i18n/t';
import type { ActionPrefill } from './ActionsContext';

const EVENT_ID = /^EV-[0-9a-f]{16}$/;

export interface NotifLike {
  id: string; kind: string; type: string; title: string; detail: string; area_id: string; line_id: string; source_ref: string; dedupe_key: string;
}

/**
 * From a notification. A long stop names its event: equipment scope when the event's code is known equipment. A repeated
 * group carries the code and reason in its key. Spikes, availability and planned overruns are about an area.
 */
export function notificationPrefill(n: NotifLike, category: NotificationCategory, opts: { findEvent?: (id: string) => EventRow | undefined; isEquipment?: (code: string) => boolean } = {}): ActionPrefill {
  const base: ActionPrefill = {
    source: 'notification', source_ref: n.id, title: n.title.slice(0, 200), detail: n.detail, trail: [t('Notification'), t(category), n.title],
  };
  const isEq = opts.isEquipment ?? (() => true);
  if (n.type === 'long_stop' && EVENT_ID.test(n.source_ref)) {
    const row = opts.findEvent?.(n.source_ref);
    const out: ActionPrefill = { ...base, suggest: 'auto_long_stop', eventIds: [n.source_ref], area_id: row?.area_id ?? n.area_id, line_id: row?.line_id ?? n.line_id };
    if (row) out.hours = (row.duration_s ?? 0) / 3600;
    if (row && row.code_raw && !row.is_area_level && isEq(row.code_raw)) return { ...out, scope_kind: 'equipment', equipment_id: row.code_raw, reason_key: row.reason_raw ?? '' };
    return { ...out, scope_kind: out.area_id ? 'area' : 'plant' };
  }
  if (n.type === 'repeat_group') {
    const [, area, code, reason, first] = n.dedupe_key.split('|');
    const ev = first && EVENT_ID.test(first) ? [first] : [];
    if (code && isEq(code)) return { ...base, suggest: 'auto_repeat', scope_kind: 'equipment', equipment_id: code, area_id: area || n.area_id, reason_key: reason ?? '', eventIds: ev };
    return { ...base, suggest: 'auto_repeat', scope_kind: n.area_id ? 'area' : 'plant', area_id: n.area_id, eventIds: ev };
  }
  if (n.type === 'planned_overrun') {
    if (n.area_id) return { ...base, suggest: 'auto_planned_overrun', scope_kind: 'area', area_id: n.area_id };
  }
  if (n.area_id) return { ...base, scope_kind: 'area', area_id: n.area_id };
  if (n.line_id) return { ...base, scope_kind: 'line', line_id: n.line_id };
  return { ...base, scope_kind: 'plant' };
}

/** The dimension a Pareto chart ranks. */
export type ParetoDim = 'equipment' | 'reason' | 'area' | 'line' | 'class';

/** From a Pareto bar: equipment bars are equipment actions, area / line bars are area / line actions, reasons keep the reason. */
export function paretoPrefill(input: { dim: ParetoDim; key: string; label: string; eventIds: string[]; hours?: number; chart: string; equipment?: string; area?: string }): ActionPrefill {
  const trail = [t('Causes'), input.chart, input.label];
  const base: ActionPrefill = { source: 'pareto', source_ref: `${input.chart}: ${input.label}`.slice(0, 200), trail, eventIds: input.eventIds.slice(0, 200), hours: input.hours };
  switch (input.dim) {
    case 'equipment':
      return { ...base, suggest: 'auto_chronic', scope_kind: 'equipment', equipment_id: input.key, title: t('{c} · top failure hours', { c: input.label }) };
    case 'reason':
      return input.equipment
        ? { ...base, scope_kind: 'equipment', equipment_id: input.equipment, reason_key: input.label, title: `${input.equipment} · ${input.label}` }
        : { ...base, scope_kind: input.area ? 'area' : 'plant', area_id: input.area, reason_key: input.label, title: input.label };
    case 'area':
      return { ...base, scope_kind: 'area', area_id: input.key, title: t('Area {a} · failure hours', { a: input.label }) };
    case 'line':
      return { ...base, scope_kind: 'line', line_id: input.key, title: t('Line {l} · failure hours', { l: input.label }) };
    default:
      return { ...base, scope_kind: 'plant', title: input.label };
  }
}

/** From a repeated-failure row: the equipment and the reason, the failure events as evidence. */
export function repeatPrefill(g: { equipmentId: string; reasonLabel: string; areaIds: string[]; occurrences: number; totalHours: number; eventIds: string[] }, windowDays?: number): ActionPrefill {
  return {
    source: 'pareto', suggest: 'auto_repeat', scope_kind: 'equipment', equipment_id: g.equipmentId, area_id: g.areaIds[0], reason_key: g.reasonLabel,
    title: windowDays
      ? t('{c} · {r} · {n} times · {h} h', { c: g.equipmentId, r: g.reasonLabel, n: g.occurrences, h: g.totalHours.toFixed(1) })
      : `${g.equipmentId} · ${g.reasonLabel}`,
    eventIds: g.eventIds.slice(0, 200), hours: g.totalHours, source_ref: t('Repeated failures: {c}', { c: g.equipmentId }),
    trail: [t('Repeated failures'), g.equipmentId, g.reasonLabel],
  };
}

/** From one event record. */
export function eventPrefill(row: EventRow, isEquipment: (code: string) => boolean): ActionPrefill {
  const eq = row.code_raw && !row.is_area_level && isEquipment(row.code_raw);
  const reason = (row.reason_raw ?? '').trim();
  return {
    source: 'event', source_ref: row.event_id, eventIds: [row.event_id], hours: (row.duration_s ?? 0) / 3600,
    scope_kind: eq ? 'equipment' : 'area', equipment_id: eq ? row.code_raw : undefined, area_id: row.area_id, line_id: row.line_id, reason_key: reason,
    title: [eq ? row.code_raw : row.area_id, reason || row.description || ''].filter(Boolean).join(' · ').slice(0, 200),
    trail: [t('Events'), row.area_id, row.code_raw || 'N/A', row.event_date],
  };
}

/** From a built report: the report's scope when it is one equipment, area or line, else the plant. */
export function reportPrefill(input: { title: string; period: string; equipmentIds: string[]; areaIds: string[]; lineIds: string[] }): ActionPrefill {
  const name = `${input.title} ${input.period}`.trim();
  const base: ActionPrefill = { source: 'report', source_ref: name.slice(0, 200), trail: [t('Report'), name] };
  if (input.equipmentIds.length === 1) return { ...base, scope_kind: 'equipment', equipment_id: input.equipmentIds[0], area_id: input.areaIds.length === 1 ? input.areaIds[0] : undefined, title: t('{x} · from {r}', { x: input.equipmentIds[0]!, r: name }) };
  if (input.areaIds.length === 1) return { ...base, scope_kind: 'area', area_id: input.areaIds[0], title: t('Area {x} · from {r}', { x: input.areaIds[0]!, r: name }) };
  if (input.lineIds.length === 1) return { ...base, scope_kind: 'line', line_id: input.lineIds[0], title: t('Line {x} · from {r}', { x: input.lineIds[0]!, r: name }) };
  return { ...base, scope_kind: 'plant', title: t('From {r}', { r: name }) };
}
