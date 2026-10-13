// The report setup: everything the builder collects (template, period, filters, sections, per-section options),
// its URL query (so a setup link restores it) and its conversion to and from the saved-template shape
// (preference `saved_reports`). Pure: no React, no storage.
import {
  REPORT_PRESETS, REPORT_TEMPLATES, type ClassificationCode, type Criticality, type ReportPreset, type ReportSectionId, type ReportSectionOptions,
  type ReportTemplateId, type SavedReportTemplate,
} from '../api/types';
import { CLASSIFICATION_CODES } from '../calc';
import type { DashFilters } from '../dashboard/filters';
import { defaultFilters } from '../dashboard/filters';
import { effectiveOptions, isSectionId, SECTION_BY_ID, sortSections, TEMPLATE_BY_ID } from './sections';

export interface ReportFilters {
  lineIds: string[];
  areaIds: string[];
  equipmentIds: string[];
  classifications: ClassificationCode[];
  criticality: Criticality[];
  failuresOnly: boolean;
}

export interface ReportSetup {
  template: ReportTemplateId;
  preset: ReportPreset;
  /** custom range, YYYY-MM-DD ('' = not set); used only with preset 'custom' */
  from: string;
  to: string;
  /** compare with the previous period */
  compare: boolean;
  filters: ReportFilters;
  /** chosen sections in report order */
  sections: ReportSectionId[];
  options: Partial<Record<ReportSectionId, ReportSectionOptions>>;
}

export const emptyReportFilters = (): ReportFilters => ({ lineIds: [], areaIds: [], equipmentIds: [], classifications: [], criticality: [], failuresOnly: false });

export function defaultSetup(template: ReportTemplateId = 'monthly'): ReportSetup {
  const def = TEMPLATE_BY_ID[template];
  return { template, preset: def.preset, from: '', to: '', compare: def.compare, filters: emptyReportFilters(), sections: [...def.sections], options: {} };
}

/** Switch template: its sections, period and comparison; the filters and the custom dates stay as they are. */
export function applyTemplate(setup: ReportSetup, template: ReportTemplateId): ReportSetup {
  if (template === 'custom') return { ...setup, template };
  const def = TEMPLATE_BY_ID[template];
  return { ...setup, template, preset: def.preset, compare: def.compare, sections: [...def.sections], options: {} };
}

/** Number of narrowing filters that are on (each list counts once, failures-only counts once). */
export function filterCount(f: ReportFilters): number {
  return [f.lineIds, f.areaIds, f.equipmentIds, f.classifications, f.criticality].filter((a) => a.length > 0).length + (f.failuresOnly ? 1 : 0);
}

/** The setup's options with every chosen section's defaults filled in. */
export function resolvedOptions(setup: ReportSetup): Partial<Record<ReportSectionId, ReportSectionOptions>> {
  const out: Partial<Record<ReportSectionId, ReportSectionOptions>> = {};
  for (const id of setup.sections) {
    const o = effectiveOptions(id, setup.options[id]);
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

/** The dashboards' filter shape for this setup, with the period already resolved to `from`..`to`. */
export function toDashFilters(setup: ReportSetup, range: { from: string; to: string }, compareKind: DashFilters['compare']): DashFilters {
  return {
    ...defaultFilters(),
    lineIds: setup.filters.lineIds, areaIds: setup.filters.areaIds, equipmentIds: setup.filters.equipmentIds,
    classifications: setup.filters.classifications, criticality: setup.filters.criticality, failureOnly: setup.filters.failuresOnly,
    preset: 'custom', from: range.from, to: range.to, compare: setup.compare ? compareKind : 'none',
  };
}

// ---------------------------------------------------------------- URL

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const uniq = (xs: string[]): string[] => [...new Set(xs.filter((x) => x !== ''))];

/** Query keys of a setup; any other key (for example `v`) is not part of it. */
export const SETUP_KEYS = ['tpl', 'p', 'from', 'to', 'cmp', 'line', 'area', 'code', 'cls', 'crit', 'fail', 's', 'o'] as const;

export function hasSetupParams(sp: URLSearchParams): boolean {
  return SETUP_KEYS.some((k) => sp.has(k));
}

/** The setup a query describes; whatever is missing or not valid falls back to the template's default. */
export function parseSetup(sp: URLSearchParams): ReportSetup {
  const tplRaw = sp.get('tpl') ?? '';
  const template = (REPORT_TEMPLATES as readonly string[]).includes(tplRaw) ? (tplRaw as ReportTemplateId) : 'monthly';
  const base = defaultSetup(template);
  const pRaw = sp.get('p') ?? '';
  const preset = (REPORT_PRESETS as readonly string[]).includes(pRaw) ? (pRaw as ReportPreset) : base.preset;
  const sRaw = sp.get('s');
  const sections = sRaw === null ? base.sections : sortSections(sRaw.split(',').map((x) => x.trim()).filter(isSectionId));
  const options: ReportSetup['options'] = {};
  for (const raw of sp.getAll('o')) {
    const [id, top, measure] = raw.split(':');
    if (!id || !isSectionId(id)) continue;
    const def = SECTION_BY_ID[id];
    const o: ReportSectionOptions = {};
    if (def.top && top) {
      const n = top === 'all' ? 'all' : Number(top);
      if (def.top.includes(n as number | 'all')) o.top = n as number | 'all';
    }
    if (def.measure && (measure === 'hours' || measure === 'count')) o.measure = measure;
    if (Object.keys(o).length) options[id] = o;
  }
  return {
    template, preset,
    from: DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : '',
    to: DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : '',
    compare: sp.has('cmp') ? sp.get('cmp') !== '0' : base.compare,
    filters: {
      lineIds: uniq(sp.getAll('line')),
      areaIds: uniq(sp.getAll('area')),
      equipmentIds: uniq(sp.getAll('code')),
      classifications: uniq(sp.getAll('cls')).filter((c): c is ClassificationCode => (CLASSIFICATION_CODES as string[]).includes(c)),
      criticality: uniq(sp.getAll('crit')).filter((c): c is Criticality => c === 'INC' || c === 'NO_INC'),
      failuresOnly: sp.get('fail') === '1',
    },
    sections, options,
  };
}

/** The query of a setup. Every choice is written (even a default one) so a link keeps meaning the same if defaults change. */
export function serializeSetup(setup: ReportSetup): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set('tpl', setup.template);
  sp.set('p', setup.preset);
  if (setup.preset === 'custom') {
    if (setup.from) sp.set('from', setup.from);
    if (setup.to) sp.set('to', setup.to);
  }
  sp.set('cmp', setup.compare ? '1' : '0');
  const f = setup.filters;
  f.lineIds.forEach((v) => sp.append('line', v));
  f.areaIds.forEach((v) => sp.append('area', v));
  f.equipmentIds.forEach((v) => sp.append('code', v));
  f.classifications.forEach((v) => sp.append('cls', v));
  f.criticality.forEach((v) => sp.append('crit', v));
  if (f.failuresOnly) sp.set('fail', '1');
  sp.set('s', sortSections(setup.sections).join(','));
  const resolved = resolvedOptions(setup);
  for (const id of sortSections(setup.sections)) {
    const o = resolved[id];
    if (!o) continue;
    sp.append('o', [id, o.top !== undefined ? String(o.top) : '', o.measure ?? ''].join(':').replace(/:+$/, ''));
  }
  return sp;
}

export const setupsEqual = (a: ReportSetup, b: ReportSetup): boolean => serializeSetup(a).toString() === serializeSetup(b).toString();

// ---------------------------------------------------------------- saved templates (preference `saved_reports`)

/** A setup as a saved template. Options are stored for the chosen sections only. */
export function toSavedTemplate(setup: ReportSetup, id: string, name: string): SavedReportTemplate {
  const f = setup.filters;
  return {
    id, name: name.trim(), template: setup.template,
    period: { preset: setup.preset, from: setup.preset === 'custom' ? setup.from : '', to: setup.preset === 'custom' ? setup.to : '', compare: setup.compare },
    filters: { lines: [...f.lineIds], areas: [...f.areaIds], equipment: [...f.equipmentIds], classifications: [...f.classifications], criticality: [...f.criticality], failuresOnly: f.failuresOnly },
    sections: sortSections(setup.sections), options: resolvedOptions(setup),
  };
}

/** A saved template as a setup (anything not valid is dropped, nothing is invented). */
export function fromSavedTemplate(t: SavedReportTemplate): ReportSetup {
  const options: ReportSetup['options'] = {};
  for (const [id, o] of Object.entries(t.options ?? {})) if (isSectionId(id) && o) options[id] = { ...o };
  return {
    template: t.template, preset: t.period.preset, from: t.period.from, to: t.period.to, compare: t.period.compare,
    filters: {
      lineIds: [...t.filters.lines], areaIds: [...t.filters.areas], equipmentIds: [...t.filters.equipment],
      classifications: t.filters.classifications.filter((c): c is ClassificationCode => (CLASSIFICATION_CODES as string[]).includes(c)),
      criticality: t.filters.criticality.filter((c): c is Criticality => c === 'INC' || c === 'NO_INC'),
      failuresOnly: t.filters.failuresOnly,
    },
    sections: sortSections(t.sections), options,
  };
}
