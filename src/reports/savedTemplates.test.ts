import { describe, expect, it } from 'vitest';
import { SAVED_REPORTS_MAX, type SavedReportTemplate } from '../api/types';
import { cleanSavedReports } from '../api/mockNotifications';
import {
  addTemplate, deleteTemplate, parseSavedTemplates, renameTemplate, serializeSavedTemplates, templateNameError, TEMPLATE_NAME_MAX,
} from './savedTemplates';
import { applyTemplate, defaultSetup, fromSavedTemplate, parseSetup, serializeSetup, setupsEqual, toSavedTemplate, type ReportSetup } from './setup';

const custom = (): ReportSetup => ({
  ...applyTemplate(defaultSetup('monthly'), 'custom'),
  preset: 'lastmonth', compare: false,
  filters: { lineIds: ['L.1'], areaIds: ['CR', 'RM.1'], equipmentIds: ['131.ST200'], classifications: ['MEC'], criticality: ['INC'], failuresOnly: true },
  sections: ['summary', 'top_equipment', 'pareto', 'events'],
  options: { top_equipment: { top: 20, measure: 'count' }, pareto: { top: 5, measure: 'hours' }, events: { top: 'all' } },
});
const t1 = (id: string, name: string, s = custom()): SavedReportTemplate => toSavedTemplate(s, id, name);

describe('saved report templates', () => {
  it('a template stores the period PRESET (not dates), filters, sections and per-section options', () => {
    const t = t1('t1', 'Crushing');
    expect(t.period).toEqual({ preset: 'lastmonth', from: '', to: '', compare: false });
    expect(t.filters).toEqual({ lines: ['L.1'], areas: ['CR', 'RM.1'], equipment: ['131.ST200'], classifications: ['MEC'], criticality: ['INC'], failuresOnly: true });
    expect(t.sections).toEqual(['summary', 'top_equipment', 'pareto', 'events']);
    expect(t.options).toEqual({ top_equipment: { top: 20, measure: 'count' }, pareto: { top: 5, measure: 'hours' }, events: { top: 'all' } });
    expect(JSON.stringify(t)).not.toMatch(/2026/);
  });

  it('applying it gives the same setup back (so Last full month stays relative); a custom range keeps its dates', () => {
    const s = custom();
    const back = fromSavedTemplate(parseSavedTemplates(serializeSavedTemplates([t1('t1', 'A', s)]))[0]!);
    expect(setupsEqual(back, s)).toBe(true);
    expect(back.preset).toBe('lastmonth');
    expect(back.from).toBe('');
    const range: ReportSetup = { ...s, preset: 'custom', from: '2026-03-01', to: '2026-03-31' };
    const r = fromSavedTemplate(parseSavedTemplates(serializeSavedTemplates([t1('t2', 'B', range)]))[0]!);
    expect(r).toMatchObject({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });
    // the setup link of a restored template is the original's
    expect(serializeSetup(parseSetup(serializeSetup(r)))).toEqual(serializeSetup(range));
  });

  it('parses leniently: unreadable text, wrong shapes and unknown ids are dropped, unknown sections are removed', () => {
    expect(parseSavedTemplates(undefined)).toEqual([]);
    expect(parseSavedTemplates('[oops')).toEqual([]);
    expect(parseSavedTemplates('{}')).toEqual([]);
    const good = t1('ok', 'Fine');
    const text = JSON.stringify([good, { id: 'bad', name: 'Bad' }, 3, { ...good, id: 'ok' }, { ...good, id: 'x2', name: 'X', sections: ['summary', 'nonsense'] }, { ...good, id: 'x3', name: 'Y', template: 'weird' }]);
    const list = parseSavedTemplates(text);
    expect(list.map((x) => x.id)).toEqual(['ok', 'x2']);
    expect(list[1]!.sections).toEqual(['summary']);
  });

  it('name rules: 1 to 60 characters, unique ignoring case, not a ready-made template name', () => {
    const list = [t1('t1', 'Crushing')];
    expect(templateNameError('', list)).toMatch(/Type a name/);
    expect(templateNameError('  ', list)).toMatch(/Type a name/);
    expect(templateNameError('x'.repeat(TEMPLATE_NAME_MAX + 1), list)).toMatch(/at most 60/);
    expect(templateNameError('x'.repeat(TEMPLATE_NAME_MAX), list)).toBeNull();
    expect(templateNameError('crushing ', list)).toMatch(/already have/);
    expect(templateNameError('Crushing', list, 't1')).toBeNull();
    expect(templateNameError('Failure analysis', list)).toMatch(/ready-made/);
    expect(templateNameError('custom', list)).toMatch(/ready-made/);
  });

  it('save: trims the name and keeps the setup; refused with a clear message at 20 templates', () => {
    const r = addTemplate([], custom(), '  My review ', 't-1');
    expect(r.ok && r.item?.name).toBe('My review');
    const full = Array.from({ length: SAVED_REPORTS_MAX }, (_, i) => t1(`t${i}`, `Template ${i}`));
    const refused = addTemplate(full, custom(), 'Template 21', 'new');
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/saved 20 templates, the most you can keep/);
    expect(addTemplate(full.slice(1), custom(), 'Template 21', 'new').ok).toBe(true);
  });

  it('refuses a list that would be too large for the stored text (20,000 characters)', () => {
    const big: ReportSetup = { ...custom(), filters: { ...custom().filters, equipmentIds: Array.from({ length: 100 }, (_, i) => `EQUIPMENT-CODE-${String(i).padStart(3, '0')}-${'x'.repeat(20)}`) } };
    let list: SavedReportTemplate[] = [];
    let refused = '';
    for (let i = 0; i < SAVED_REPORTS_MAX; i++) {
      const r = addTemplate(list, big, `Big ${i}`, `b${i}`);
      if (!r.ok) { refused = r.error; break; }
      list = r.list;
    }
    expect(refused).toMatch(/too large/);
    expect(serializeSavedTemplates(list).length).toBeLessThanOrEqual(20000);
  });

  it('rename and delete change only that template', () => {
    const list = [t1('a', 'Alpha'), t1('b', 'Beta'), t1('c', 'Gamma')];
    const r = renameTemplate(list, 'b', ' Delta ');
    expect(r.ok && r.list.map((x) => x.name)).toEqual(['Alpha', 'Delta', 'Gamma']);
    expect(r.ok && r.list[1]!.sections).toEqual(list[1]!.sections);
    expect(renameTemplate(list, 'b', 'alpha').ok).toBe(false);
    expect(renameTemplate(list, 'zzz', 'New').ok).toBe(false);
    const d = deleteTemplate(list, 'a');
    expect(d.ok && d.list.map((x) => x.id)).toEqual(['b', 'c']);
    expect(deleteTemplate(list, 'zzz').ok).toBe(false);
  });

  it('serialises an empty list to blank and stays within the wire rules (ids 1-40, names 1-60)', () => {
    expect(serializeSavedTemplates([])).toBe('');
    const a = addTemplate([], custom(), 'N', 'id-1');
    expect(a.ok && JSON.parse(serializeSavedTemplates(a.list))[0]).toMatchObject({ id: 'id-1', name: 'N', template: 'custom' });
  });

  it('what is saved passes the server\'s own checks (the mock runs the same rules as cleanSavedReports_)', () => {
    const list = [t1('a', 'Alpha'), t1('b', 'Beta', { ...custom(), preset: 'custom', from: '2026-03-01', to: '2026-03-31' }), t1('c', 'Plain', defaultSetup('area'))];
    expect(() => cleanSavedReports(serializeSavedTemplates(list))).not.toThrow();
    const full = Array.from({ length: SAVED_REPORTS_MAX }, (_, i) => t1(`t${i}`, `Template ${i}`));
    expect(() => cleanSavedReports(serializeSavedTemplates(full))).not.toThrow();
  });
});
