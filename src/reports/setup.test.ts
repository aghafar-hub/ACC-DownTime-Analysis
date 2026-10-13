import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_PRESETS, REPORT_SECTION_IDS, REPORT_TEMPLATES } from '../api/types';
import { cleanSavedReports } from '../api/mockNotifications';
import { SECTION_DEFS, SECTION_ORDER, TEMPLATE_DEFS, effectiveOptions } from './sections';
import { applyTemplate, defaultSetup, fromSavedTemplate, parseSetup, resolvedOptions, serializeSetup, setupsEqual, toSavedTemplate } from './setup';

describe('sections catalogue', () => {
  it('lists every wire section id once, in report order, and the backend mirrors the lists', () => {
    expect(SECTION_ORDER).toEqual([...REPORT_SECTION_IDS]);
    expect(new Set(SECTION_ORDER).size).toBe(SECTION_ORDER.length);
    const src = readFileSync('backend/apps-script/Notifications.js', 'utf8');
    const list = (name: string): string[] => {
      const m = new RegExp(`var ${name} = \\[([^\\]]*)\\]`).exec(src);
      return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    };
    expect(list('REPORT_SECTION_IDS_')).toEqual([...REPORT_SECTION_IDS]);
    expect(list('REPORT_TEMPLATES_')).toEqual([...REPORT_TEMPLATES]);
    expect(list('REPORT_PRESETS_')).toEqual([...REPORT_PRESETS]);
  });
  it('every section has a group, a label and a one-line description', () => {
    for (const s of SECTION_DEFS) {
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.description.length).toBeGreaterThan(10);
    }
    expect(TEMPLATE_DEFS.map((t) => t.id)).toEqual(['monthly', 'area', 'failure', 'custom']);
    expect(TEMPLATE_DEFS[0]!.sections).toHaveLength(SECTION_ORDER.length);
  });
  it('options fall back to the defaults and stay within the choices', () => {
    expect(effectiveOptions('top_equipment', undefined)).toEqual({ top: 10, measure: 'hours' });
    expect(effectiveOptions('top_equipment', { top: 7, measure: 'count' })).toEqual({ top: 10, measure: 'count' });
    expect(effectiveOptions('events', { top: 'all' })).toEqual({ top: 'all' });
    expect(effectiveOptions('daily', { top: 5 })).toEqual({});
  });
});

describe('setup <-> URL', () => {
  it('round-trips template, period, filters, sections and options', () => {
    const s = {
      ...defaultSetup('custom'), preset: 'custom' as const, from: '2026-03-01', to: '2026-04-15', compare: false,
      filters: { lineIds: ['L.1'], areaIds: ['CR', 'RM.1'], equipmentIds: ['131.ST200'], classifications: ['MEC' as const], criticality: ['INC' as const], failuresOnly: true },
      sections: ['cover' as const, 'top_equipment' as const, 'events' as const], options: { top_equipment: { top: 5, measure: 'count' as const }, events: { top: 'all' as const } },
    };
    const back = parseSetup(serializeSetup(s));
    expect(back).toEqual({ ...s, options: resolvedOptions(s) });
    expect(setupsEqual(back, s)).toBe(true);
  });
  it('an empty query is the Monthly management report with every section', () => {
    const s = parseSetup(new URLSearchParams());
    expect(s.template).toBe('monthly');
    expect(s.preset).toBe('lastmonth');
    expect(s.compare).toBe(true);
    expect(s.sections).toEqual(SECTION_ORDER);
  });
  it('ignores values that are not valid and keeps report order', () => {
    const s = parseSetup(new URLSearchParams('tpl=nope&p=never&s=events,cover,bogus&cls=XXX&cls=PL&crit=HIGH&from=bad&o=events:7&o=bogus:5&o=when:5:count&cmp=0'));
    expect(s.template).toBe('monthly');
    expect(s.preset).toBe('lastmonth');
    expect(s.sections).toEqual(['cover', 'events']);
    expect(s.filters.classifications).toEqual(['PL']);
    expect(s.filters.criticality).toEqual([]);
    expect(s.from).toBe('');
    expect(s.options).toEqual({ when: { measure: 'count' } });
    expect(s.compare).toBe(false);
  });
  it('a template switch keeps filters, applies sections and period; Custom keeps the selection', () => {
    const base = { ...defaultSetup('monthly'), filters: { ...defaultSetup().filters, lineIds: ['L.2'] } };
    const area = applyTemplate(base, 'area');
    expect(area.preset).toBe('last3');
    expect(area.filters.lineIds).toEqual(['L.2']);
    expect(area.sections).not.toContain('events');
    const custom = applyTemplate(area, 'custom');
    expect(custom.sections).toEqual(area.sections);
    expect(custom.template).toBe('custom');
  });
});

describe('saved templates', () => {
  it('convert both ways and pass the strict validator', () => {
    const s = { ...defaultSetup('failure'), filters: { ...defaultSetup().filters, areaIds: ['CR'], failuresOnly: true } };
    const saved = toSavedTemplate(s, 't1', ' My report ');
    expect(saved.name).toBe('My report');
    expect(() => cleanSavedReports(JSON.stringify([saved]))).not.toThrow();
    expect(fromSavedTemplate(saved)).toEqual({ ...s, options: resolvedOptions(s) });
    expect(() => cleanSavedReports(JSON.stringify([{ ...saved, sections: ['nope'] }]))).toThrow();
  });
});
