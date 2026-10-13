import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '../api/types';
import { ALERT_TYPE_GROUPS, enabledGroups, parsePrefs, serializeAlertTypes, serializeAreas, wanted } from './prefs';

describe('parsePrefs', () => {
  it('a person who never chose gets every type, every area and no digest', () => {
    expect(parsePrefs({})).toEqual({ alertTypes: NOTIFICATION_TYPES, watchAreas: [], digest: 'none', lastSeenAt: '', savedViews: '', savedReports: '' });
    expect(parsePrefs(undefined).watchAreas).toEqual([]);
  });
  it('carries the stored saved views and saved report templates as text, untouched', () => {
    const p = parsePrefs({ saved_views: '[{"id":"v1"}]', saved_reports: '[]' });
    expect(p.savedViews).toBe('[{"id":"v1"}]');
    expect(p.savedReports).toBe('[]');
  });
  it('reads the saved values and ignores unknown types and digests', () => {
    const p = parsePrefs({ alert_types: 'long_stop, upload_gap,bogus', watch_areas: 'K.1,RM.2,K.1', digest: 'weekly', last_seen_at: '2026-03-05 10:00:00.000' });
    expect(p).toEqual({ alertTypes: ['long_stop', 'upload_gap'], watchAreas: ['K.1', 'RM.2'], digest: 'weekly', lastSeenAt: '2026-03-05 10:00:00.000', savedViews: '', savedReports: '' });
    expect(parsePrefs({ digest: 'hourly' }).digest).toBe('none');
  });
});

describe('alert type groups', () => {
  it('cover every stored type exactly once', () => {
    expect(ALERT_TYPE_GROUPS.flatMap((g) => g.types).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
  it('everything on is stored as blank (the server reads blank as all); some off lists the types; none is not storable', () => {
    expect(serializeAlertTypes(ALERT_TYPE_GROUPS.map((g) => g.id))).toBe('');
    expect(serializeAlertTypes(['long_stop', 'updates'])).toBe('long_stop,upload_done,user_event');
    expect(serializeAlertTypes([])).toBeNull();
  });
  it('maps the stored types back to the groups that are fully on', () => {
    expect(enabledGroups(['long_stop', 'upload_done'])).toEqual(['long_stop']);
    expect(enabledGroups(['long_stop', 'upload_done', 'user_event'])).toEqual(['long_stop', 'updates']);
    expect(enabledGroups(NOTIFICATION_TYPES)).toHaveLength(ALERT_TYPE_GROUPS.length);
  });
  it('serializes areas without repeats', () => {
    expect(serializeAreas(['K.1', 'K.1', 'RM.2'])).toBe('K.1,RM.2');
    expect(serializeAreas([])).toBe('');
  });
});

describe('wanted', () => {
  const prefs = (over: Partial<ReturnType<typeof parsePrefs>> = {}) => ({ ...parsePrefs({}), ...over });
  it('filters by the chosen types', () => {
    expect(wanted({ type: 'long_stop', area_id: 'K.1' }, prefs({ alertTypes: ['upload_gap'] }))).toBe(false);
    expect(wanted({ type: 'upload_gap', area_id: '' }, prefs({ alertTypes: ['upload_gap'] }))).toBe(true);
  });
  it('filters by watched areas; an empty list means all; an item without an area always matches', () => {
    expect(wanted({ type: 'long_stop', area_id: 'K.1' }, prefs({ watchAreas: ['RM.2'] }))).toBe(false);
    expect(wanted({ type: 'long_stop', area_id: 'rm.2' }, prefs({ watchAreas: ['RM.2'] }))).toBe(true);
    expect(wanted({ type: 'long_stop', area_id: 'K.1' }, prefs())).toBe(true);
    expect(wanted({ type: 'upload_done', area_id: '' }, prefs({ watchAreas: ['RM.2'] }))).toBe(true);
    expect(wanted({ type: 'upload_done' }, prefs({ watchAreas: ['RM.2'] }))).toBe(true);
  });
});
