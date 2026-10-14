import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { categoryOf, countByCategory, dayGroupOf, groupByDay, canCreateFrom } from '../notifications/categories';
import type { FeedItem } from '../notifications/model';
import { eventPrefill, notificationPrefill, paretoPrefill, repeatPrefill, reportPrefill } from './prefill';

const EV = 'EV-0123456789abcdef';
const row = (over: Partial<EventRow> = {}): EventRow => ({
  event_id: EV, batch_id: 'B', event_date: '2026-10-12', line_id: 'L.2', area_id: 'CM.4', code_raw: '364.MT110', is_area_level: false,
  stop_ts: '2026-10-12 01:00:00', start_ts: '2026-10-12 10:12:00', duration_s: 9.2 * 3600, freq: 1, classification: 'MEC', criticality: 'INC',
  is_failure: true, reason_raw: 'Bearing seized', fingerprint: 'f', edited: false, is_void: false, created_at: '', ...over,
});
const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'NT-1', kind: 'alert', type: 'long_stop', title: 'CM.4 stopped 9.2 h', detail: 'Bearing seized', area_id: 'CM.4', line_id: 'L.2', created_at: '2026-10-13 08:00:00.000',
  source_ref: EV, dedupe_key: `long_stop|${EV}`, link: null, linkLabel: '', unseen: true, ...over,
});

describe('create action from a notification', () => {
  it('a long stop: equipment scope from its event, the event as evidence', () => {
    const p = notificationPrefill(item(), 'Reliability', { findEvent: () => row(), isEquipment: () => true });
    expect(p).toMatchObject({ source: 'notification', source_ref: 'NT-1', scope_kind: 'equipment', equipment_id: '364.MT110', area_id: 'CM.4', reason_key: 'Bearing seized', eventIds: [EV] });
    expect(p.hours).toBeCloseTo(9.2, 6);
    expect(p.trail).toEqual(['Notification', 'Reliability', 'CM.4 stopped 9.2 h']);
  });
  it('a long stop whose event is not loaded, or area-level: the area', () => {
    expect(notificationPrefill(item(), 'Reliability', {})).toMatchObject({ scope_kind: 'area', area_id: 'CM.4', eventIds: [EV] });
    expect(notificationPrefill(item(), 'Reliability', { findEvent: () => row({ is_area_level: true }) })).toMatchObject({ scope_kind: 'area' });
  });
  it('a repeated group carries code and reason in its key', () => {
    const p = notificationPrefill(item({ type: 'repeat_group', dedupe_key: `repeat|K.1|231.CP190|hydraulic pressure low|${EV}` }), 'Reliability');
    expect(p).toMatchObject({ scope_kind: 'equipment', equipment_id: '231.CP190', area_id: 'K.1', reason_key: 'hydraulic pressure low', eventIds: [EV] });
  });
  it('area alerts, line and plant', () => {
    expect(notificationPrefill(item({ type: 'planned_overrun', source_ref: '' }), 'Availability & planned')).toMatchObject({ scope_kind: 'area', area_id: 'CM.4' });
    expect(notificationPrefill(item({ type: 'upload_gap', area_id: '', line_id: 'L.1', source_ref: '' }), 'Data quality')).toMatchObject({ scope_kind: 'line', line_id: 'L.1' });
    expect(notificationPrefill(item({ type: 'upload_gap', area_id: '', line_id: '', source_ref: '' }), 'Data quality')).toMatchObject({ scope_kind: 'plant' });
  });
});

describe('create action from charts, rows, records and reports', () => {
  it('Pareto bars', () => {
    expect(paretoPrefill({ dim: 'equipment', key: '262.MT120', label: '262.MT120', eventIds: ['a'], hours: 40.2, chart: 'Equipment by failure hours' }))
      .toMatchObject({ source: 'pareto', scope_kind: 'equipment', equipment_id: '262.MT120', eventIds: ['a'], hours: 40.2 });
    expect(paretoPrefill({ dim: 'area', key: 'K.2', label: 'K.2', eventIds: [], chart: 'Areas' })).toMatchObject({ scope_kind: 'area', area_id: 'K.2' });
    expect(paretoPrefill({ dim: 'line', key: 'L.1', label: 'L.1', eventIds: [], chart: 'Lines' })).toMatchObject({ scope_kind: 'line', line_id: 'L.1' });
    expect(paretoPrefill({ dim: 'reason', key: 'x', label: 'Belt torn', eventIds: [], chart: 'Reasons', equipment: '131.BC100' }))
      .toMatchObject({ scope_kind: 'equipment', equipment_id: '131.BC100', reason_key: 'Belt torn' });
    expect(paretoPrefill({ dim: 'reason', key: 'x', label: 'Belt torn', eventIds: [], chart: 'Reasons' })).toMatchObject({ scope_kind: 'plant', reason_key: 'Belt torn' });
    expect(paretoPrefill({ dim: 'equipment', key: 'k', label: 'k', eventIds: Array.from({ length: 300 }, (_, i) => String(i)), chart: 'c' }).eventIds).toHaveLength(200);
  });
  it('a repeated-failure row', () => {
    const p = repeatPrefill({ equipmentId: '372.SP160', reasonLabel: 'Bearing high temp', areaIds: ['CM.2'], occurrences: 4, totalHours: 6.2, eventIds: ['a', 'b'] }, 30);
    expect(p).toMatchObject({ scope_kind: 'equipment', equipment_id: '372.SP160', area_id: 'CM.2', reason_key: 'Bearing high temp', eventIds: ['a', 'b'], title: '372.SP160 · Bearing high temp · 4 times · 6.2 h' });
  });
  it('an event record', () => {
    expect(eventPrefill(row(), () => true)).toMatchObject({ source: 'event', source_ref: EV, scope_kind: 'equipment', equipment_id: '364.MT110', eventIds: [EV], title: '364.MT110 · Bearing seized' });
    expect(eventPrefill(row({ code_raw: 'AFR2' }), () => false)).toMatchObject({ scope_kind: 'area', area_id: 'CM.4', equipment_id: undefined });
  });
  it('a report: one equipment, one area, one line, else the plant', () => {
    const base = { title: 'Monthly management report', period: 'Aug 2026', equipmentIds: [], areaIds: [], lineIds: [] };
    expect(reportPrefill({ ...base, equipmentIds: ['262.MT120'], areaIds: ['K.2'] })).toMatchObject({ source: 'report', scope_kind: 'equipment', equipment_id: '262.MT120', area_id: 'K.2', source_ref: 'Monthly management report Aug 2026' });
    expect(reportPrefill({ ...base, areaIds: ['K.1'] })).toMatchObject({ scope_kind: 'area', area_id: 'K.1' });
    expect(reportPrefill({ ...base, areaIds: ['K.1', 'K.2'], lineIds: ['L.1'] })).toMatchObject({ scope_kind: 'line', line_id: 'L.1' });
    expect(reportPrefill(base)).toMatchObject({ scope_kind: 'plant', trail: ['Report', 'Monthly management report Aug 2026'] });
  });
});

describe('notification categories', () => {
  it('stored types by the backend table; derived items are Data quality', () => {
    expect(categoryOf(item())).toBe('Reliability');
    expect(categoryOf(item({ type: 'planned_overrun' }))).toBe('Availability & planned');
    expect(categoryOf(item({ type: 'action_due' }))).toBe('Actions');
    expect(categoryOf(item({ type: 'user_event', kind: 'update' }))).toBe('System');
    expect(categoryOf(item({ kind: 'action', type: 'validate' }))).toBe('Data quality');
  });
  it('Create action only for alerts about the plant', () => {
    expect(canCreateFrom(item())).toBe(true);
    expect(canCreateFrom(item({ type: 'action_due' }))).toBe(false);
    expect(canCreateFrom(item({ kind: 'update', type: 'upload_done' }))).toBe(false);
    expect(canCreateFrom(item({ kind: 'action', type: 'validate' }))).toBe(false);
  });
  it('counts per category and new ones', () => {
    const c = countByCategory([item(), item({ unseen: false }), item({ kind: 'action', type: 'validate', unseen: false })]);
    expect(c.Reliability).toEqual({ total: 2, fresh: 1 });
    expect(c['Data quality']).toEqual({ total: 1, fresh: 1 });
    expect(c.System).toEqual({ total: 0, fresh: 0 });
  });
  it('day groups', () => {
    const now = new Date(2026, 9, 14, 12, 0).getTime();
    expect(dayGroupOf('2026-10-14 08:00:00.000', now)).toBe('today');
    expect(dayGroupOf('2026-10-13 23:00:00.000', now)).toBe('yesterday');
    expect(dayGroupOf('2026-10-09 08:00:00.000', now)).toBe('week');
    expect(dayGroupOf('2026-09-01 08:00:00.000', now)).toBe('older');
    expect(dayGroupOf('', now)).toBe('live');
    expect(groupByDay([item({ created_at: '' }), item({ created_at: '2026-09-01 08:00:00.000' }), item({ created_at: '2026-10-14 01:00:00.000' })], now).map((g) => g.group))
      .toEqual(['live', 'today', 'older']);
  });
});
