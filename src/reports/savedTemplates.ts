// A person's saved report templates (preference `saved_reports`): reading what is stored, name rules, the limits, and the
// changes (save, rename, delete) as new lists. A template keeps the period PRESET (so 'Last full month' stays relative and
// means the latest full month whenever it is applied), the filters, the sections and the per-section options; the
// conversion to and from the builder's setup is toSavedTemplate / fromSavedTemplate in setup.ts. Pure.
import { REPORT_PRESETS, REPORT_TEMPLATES, SAVED_REPORTS_MAX, type SavedReportTemplate } from '../api/types';
import { newId, type ListResult } from '../views/savedViews';
import { TEMPLATE_DEFS, isSectionId } from './sections';
import { fromSavedTemplate, toSavedTemplate, type ReportSetup } from './setup';

export { SAVED_REPORTS_MAX };
export const TEMPLATE_NAME_MAX = 60;
/** Longest stored text the server accepts. */
export const SAVED_REPORTS_TEXT_MAX = 20000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** One stored entry as a clean template, or null when it is not one. Round-trips through the setup so only valid values stay. */
function clean(v: unknown): SavedReportTemplate | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.name !== 'string' || !v.name.trim()) return null;
  if (typeof v.template !== 'string' || !(REPORT_TEMPLATES as readonly string[]).includes(v.template)) return null;
  const p = v.period;
  if (!isObj(p) || typeof p.preset !== 'string' || !(REPORT_PRESETS as readonly string[]).includes(p.preset)) return null;
  const f = isObj(v.filters) ? v.filters : {};
  const raw: SavedReportTemplate = {
    id: v.id, name: v.name, template: v.template as SavedReportTemplate['template'],
    period: { preset: p.preset as SavedReportTemplate['period']['preset'], from: typeof p.from === 'string' ? p.from : '', to: typeof p.to === 'string' ? p.to : '', compare: p.compare === true },
    filters: {
      lines: strList(f.lines), areas: strList(f.areas), equipment: strList(f.equipment), classifications: strList(f.classifications),
      criticality: strList(f.criticality), failuresOnly: f.failuresOnly === true,
    },
    sections: strList(v.sections).filter(isSectionId),
    options: isObj(v.options) ? (v.options as SavedReportTemplate['options']) : {},
  };
  return toSavedTemplate(fromSavedTemplate(raw), raw.id, raw.name);
}

/** The list a stored text holds; unreadable text gives an empty list and invalid entries are skipped. */
export function parseSavedTemplates(raw: string | undefined | null): SavedReportTemplate[] {
  if (!raw || !raw.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: SavedReportTemplate[] = [];
  for (const v of data as unknown[]) {
    const c = clean(v);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export const serializeSavedTemplates = (list: readonly SavedReportTemplate[]): string => (list.length ? JSON.stringify(list) : '');

const BUILT_IN_NAMES = TEMPLATE_DEFS.map((d) => d.label.toLowerCase());

/** null when the name is fine, else a plain sentence. Unique ignoring case and edge spaces; the ready-made names are taken. */
export function templateNameError(name: string, list: readonly SavedReportTemplate[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Type a name for the template.';
  if (n.length > TEMPLATE_NAME_MAX) return `Use at most ${TEMPLATE_NAME_MAX} characters for the name.`;
  const low = n.toLowerCase();
  if (BUILT_IN_NAMES.includes(low)) return 'This name belongs to a ready-made template. Choose another name.';
  if (list.some((x) => x.id !== exceptId && x.name.trim().toLowerCase() === low)) return 'You already have a template with this name.';
  return null;
}

const LIMIT = `You have saved ${SAVED_REPORTS_MAX} templates, the most you can keep. Delete one to save another.`;
const TOO_BIG = 'Your saved templates are too large to save another. Delete one first.';

export function addTemplate(list: readonly SavedReportTemplate[], setup: ReportSetup, name: string, id: string): ListResult<SavedReportTemplate> {
  const err = templateNameError(name, list);
  if (err) return { ok: false, error: err };
  if (list.length >= SAVED_REPORTS_MAX) return { ok: false, error: LIMIT };
  const item = toSavedTemplate(setup, id, name);
  const next = [...list, item];
  if (serializeSavedTemplates(next).length > SAVED_REPORTS_TEXT_MAX) return { ok: false, error: TOO_BIG };
  return { ok: true, list: next, item };
}

export function renameTemplate(list: readonly SavedReportTemplate[], id: string, name: string): ListResult<SavedReportTemplate> {
  const cur = list.find((x) => x.id === id);
  if (!cur) return { ok: false, error: 'This template no longer exists.' };
  const err = templateNameError(name, list, id);
  if (err) return { ok: false, error: err };
  const item = { ...cur, name: name.trim() };
  return { ok: true, list: list.map((x) => (x.id === id ? item : x)), item };
}

export function deleteTemplate(list: readonly SavedReportTemplate[], id: string): ListResult<SavedReportTemplate> {
  const cur = list.find((x) => x.id === id);
  if (!cur) return { ok: false, error: 'This template no longer exists.' };
  return { ok: true, list: list.filter((x) => x.id !== id), item: cur };
}

export const newTemplateId = (taken: readonly string[]): string => newId('t', taken);
