// The report builder: template, period, filters, sections, and a summary card with the Build button. Everything lives
// in one ReportSetup the page keeps in the URL query, so a setup link restores it exactly.
import { useMemo, useState, type ReactNode } from 'react';
import ReportExport from './ReportExport';
import { useTemplateUi } from './SavedTemplates';
import type { ReportModel } from './model';
import type { ClassificationCode, Criticality, ReportSectionId, ReportSectionOptions, Startup } from '../api/types';
import { areasInScope, type DashFilters } from '../dashboard/filters';
import { MultiPick } from '../dashboard/FilterBar';
import { dayLabel, fh, fint, rangeLabel } from '../dashboard/format';
import { Toggle } from '../dashboard/parts';
import type { DateRange } from '../calc';
import { ChipRow, CountChip } from '../components/PhoneParts';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import {
  PERIOD_PRESETS, SECTION_DEFS, SECTION_GROUPS, SECTION_ORDER, TEMPLATE_DEFS, effectiveOptions, sortSections, type SectionDef,
} from './sections';
import { applyTemplate, filterCount, fromDashFilters, type NotCopied, type ReportFilters, type ReportSetup } from './setup';
import { parseFilters, resolveRange } from '../dashboard/filters';
import { rememberedQuery } from '../dashboard/sharedFilters';
import './reports.css';

export interface BuilderProps {
  setup: ReportSetup;
  onChange: (next: ReportSetup) => void;
  startup: Startup | null;
  /** the period the setup resolves to, and its comparison, once data is known */
  range: DateRange | null;
  compareRange: DateRange | null;
  /** events and area-hours in scope; null while loading */
  scope: { events: number; areaHours: number } | null;
  coverage: DateRange | null;
  onBuild: () => void;
  onCopyLink: () => void;
  copied: boolean;
  /** the report model for Download Excel / CSV (built on the click); null while the data is not ready */
  getModel: (only?: ReportSectionId[]) => ReportModel | null;
  dataReady: boolean;
  /** the last day with data (the dashboards' relative periods count back from it) */
  asOf?: string | null;
}

function Step({ n, title, hint, children, testid }: { n: number; title: string; hint?: string; children: ReactNode; testid: string }) {
  return (
    <section className="card rb-step" aria-labelledby={`rb-h-${testid}`} data-testid={testid}>
      <h2 id={`rb-h-${testid}`} className="rb-step-title"><span className="rb-n" aria-hidden="true">{n}</span>{title}</h2>
      {hint && <p className="rb-hint">{hint}</p>}
      {children}
    </section>
  );
}

const CLASS_CODES: ClassificationCode[] = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];

function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function Builder(p: BuilderProps) {
  const { setup, onChange, startup } = p;
  const f = setup.filters;
  const tpl = useTemplateUi(setup, onChange);
  const setFilters = (patch: Partial<ReportFilters>) => onChange({ ...setup, filters: { ...f, ...patch } });
  // 'Use current dashboard filters': the shared filters of the Analyze pages and Event records, with their period
  const [copied, setCopied] = useState<{ notCopied: NotCopied[] } | null>(null);
  const useDashboard = () => {
    const dash = parseFilters(new URLSearchParams(rememberedQuery()));
    const asOf = p.asOf ?? p.coverage?.to ?? new Date().toISOString().slice(0, 10);
    const r = fromDashFilters(setup, dash, resolveRange(dash, asOf));
    onChange(r.setup);
    setCopied({ notCopied: r.notCopied });
  };

  const lines = startup?.lines ?? [];
  const areas = useMemo(() => (startup?.areas ?? []).filter((a) => a.active && a.in_downtime_sheet), [startup]);
  const areaOpts = useMemo(
    () => areas.filter((a) => f.lineIds.length === 0 || f.lineIds.includes(a.line_id)).sort((a, b) => a.sort_order - b.sort_order).map((a) => ({ value: a.area_id, label: a.area_id, hint: a.name })),
    [areas, f.lineIds],
  );
  const equipOpts = useMemo(() => {
    if (!startup) return [];
    const allowed = new Set(areasInScope(startup.areas, { lineIds: f.lineIds, areaIds: f.areaIds } as DashFilters));
    const narrowed = f.lineIds.length > 0 || f.areaIds.length > 0;
    const inScope = new Set(startup.equipment_areas.filter((ea) => allowed.has(ea.area_id)).map((ea) => ea.equipment_id));
    return startup.equipment
      .filter((e) => e.status === 'Active' && (!narrowed || inScope.has(e.equipment_id)))
      .sort((a, b) => (a.equipment_id < b.equipment_id ? -1 : 1))
      .map((e) => ({ value: e.equipment_id, label: e.equipment_id, hint: e.description }));
  }, [startup, f.lineIds, f.areaIds]);

  const chips: { id: string; text: string; clear: () => void }[] = [];
  const lineName = (id: string) => lines.find((l) => l.line_id === id)?.name ?? id;
  f.lineIds.forEach((v) => chips.push({ id: `line-${v}`, text: `${t('Line')}: ${v === lineName(v) ? v : `${v} (${lineName(v)})`}`, clear: () => setFilters({ lineIds: f.lineIds.filter((x) => x !== v) }) }));
  f.areaIds.forEach((v) => chips.push({ id: `area-${v}`, text: `${t('Area')}: ${v}`, clear: () => setFilters({ areaIds: f.areaIds.filter((x) => x !== v) }) }));
  f.equipmentIds.forEach((v) => chips.push({ id: `code-${v}`, text: `${t('Equipment')}: ${v}`, clear: () => setFilters({ equipmentIds: f.equipmentIds.filter((x) => x !== v) }) }));
  f.classifications.forEach((v) => chips.push({ id: `cls-${v}`, text: `${t('Class')}: ${v}`, clear: () => setFilters({ classifications: f.classifications.filter((x) => x !== v) }) }));
  f.criticality.forEach((v) => chips.push({ id: `crit-${v}`, text: `${t('Criticality')}: ${v}`, clear: () => setFilters({ criticality: f.criticality.filter((x) => x !== v) }) }));
  if (f.failuresOnly) chips.push({ id: 'fail', text: t('Failures only'), clear: () => setFilters({ failuresOnly: false }) });

  const chosen = new Set(setup.sections);
  const setSections = (ids: ReportSectionId[]) => onChange({ ...setup, template: 'custom', sections: sortSections(ids) });
  const toggleSection = (id: ReportSectionId) => setSections(chosen.has(id) ? setup.sections.filter((x) => x !== id) : [...setup.sections, id]);
  const setOption = (id: ReportSectionId, patch: ReportSectionOptions) => onChange({
    ...setup, template: 'custom', options: { ...setup.options, [id]: { ...effectiveOptions(id, setup.options[id]), ...patch } },
  });

  const periodName = PERIOD_PRESETS.find((x) => x.id === setup.preset)?.label ?? '';
  const none = setup.sections.length === 0;
  const todayCmp = p.compareRange ? rangeLabel(p.compareRange) : '';

  const summary = (
    <aside className="card rb-summary" aria-label={t('Your report')} data-testid="rb-summary">
      <h2 className="rb-sum-title">{t('Your report')}</h2>
      <p className="rb-sum-name" data-testid="rb-sum-name">{t(TEMPLATE_DEFS.find((x) => x.id === setup.template)?.label ?? '')}</p>
      <dl className="rb-sum-facts">
        <dt>{t('Period')}</dt>
        <dd data-testid="rb-sum-period">{p.range ? rangeLabel(p.range) : '…'}<small>{t(periodName)}</small></dd>
        <dt>{t('Compared with')}</dt>
        <dd data-testid="rb-sum-compare">{setup.compare ? (todayCmp || '…') : t('No comparison')}</dd>
        <dt>{t('Filters')}</dt>
        <dd data-testid="rb-sum-filters">{filterCount(f) === 0 ? t('None: all lines and areas') : t('{n} active', { n: filterCount(f) })}</dd>
        <dt>{t('Sections')}</dt>
        <dd data-testid="rb-sum-sections">{t('{n} of {m}', { n: setup.sections.length, m: SECTION_DEFS.length })}</dd>
      </dl>
      <p className="rb-scope" data-testid="rb-scope" role="status">
        {p.scope === null ? t('Counting…') : t('{n} events, {h} area-hours in scope', { n: fint(p.scope.events), h: fh(p.scope.areaHours) })}
      </p>
      {p.coverage && <p className="rb-hint" data-testid="rb-coverage">{t('Data covers {a} to {b}', { a: dayLabel(p.coverage.from), b: dayLabel(p.coverage.to) })}</p>}
      <div className="rb-actions">
        <button type="button" className="btn-primary rb-build" onClick={p.onBuild} disabled={none} data-testid="rb-build">
          <Icon name="registry" size={16} /> {t('Build report')}
        </button>
        <button type="button" className="btn rb-copy" onClick={p.onCopyLink} data-testid="rb-copy-link">
          <Icon name="share" size={16} /> {t('Copy link')}
        </button>
      </div>
      <ReportExport sections={setup.sections} getModel={p.getModel} ready={p.dataReady} testid="rb" />
      {none && <p className="rb-hint rb-warn" role="status" data-testid="rb-none">{t('Choose at least one section to build a report.')}</p>}
      <p className="rb-copied" role="status" aria-live="polite" data-testid="rb-copied">{p.copied ? t('Link copied. It opens this setup.') : ''}</p>
    </aside>
  );

  return (
    <div className="rb-layout" data-testid="builder">
      <div className="rb-main">
        <Step n={1} title={t('Template')} hint={t('Start from a ready-made report, then change anything below.')} testid="rb-template">
          <ChipRow label={t('Template')}>
            {TEMPLATE_DEFS.map((x) => (
              <CountChip key={x.id} on={setup.template === x.id && !tpl.active} onClick={() => onChange(applyTemplate(setup, x.id))} testid={`rb-tpl-${x.id}`}>{t(x.label)}</CountChip>
            ))}
            {tpl.chips}
          </ChipRow>
          {tpl.actions}
          <p className="rb-blurb" data-testid="rb-tpl-blurb">{t(TEMPLATE_DEFS.find((x) => x.id === setup.template)?.blurb ?? '')}</p>
        </Step>

        <div className="card rb-use-dash" data-testid="rb-use-dash-card">
          <div>
            <b>{t('Start from the dashboards')}</b>
            <p className="rb-hint">{t('Copy the period and filters you have on the Dashboard, Causes, Repeated failures, Reliability and Events.')}</p>
            {copied && (
              <p className="rb-hint" role="status" data-testid="rb-use-dash-note">
                {copied.notCopied.length
                  ? t('Copied. Not in a report: {what} (the report has no such filter).', { what: copied.notCopied.map((x) => t(x)).join(', ') })
                  : t('Copied the dashboard period and filters.')}
              </p>
            )}
          </div>
          <button type="button" className="btn" onClick={useDashboard} data-testid="rb-use-dash"><Icon name="filter" size={15} /> {t('Use current dashboard filters')}</button>
        </div>

        <Step n={2} title={t('Period')} testid="rb-period">
          <ChipRow label={t('Period')}>
            {PERIOD_PRESETS.map((x) => (
              <CountChip key={x.id} on={setup.preset === x.id} onClick={() => onChange({ ...setup, preset: x.id, from: x.id === 'custom' ? (setup.from || p.range?.from || '') : setup.from, to: x.id === 'custom' ? (setup.to || p.range?.to || '') : setup.to })} testid={`rb-period-${x.id}`}>{t(x.label)}</CountChip>
            ))}
          </ChipRow>
          {setup.preset === 'custom' && (
            <div className="rb-dates">
              <div className="field">
                <label htmlFor="rb-from">{t('From date')}</label>
                <input id="rb-from" className="input mono" type="date" value={setup.from} max={setup.to || undefined} onChange={(e) => onChange({ ...setup, from: e.target.value })} data-testid="rb-from" />
              </div>
              <div className="field">
                <label htmlFor="rb-to">{t('To date')}</label>
                <input id="rb-to" className="input mono" type="date" value={setup.to} min={setup.from || undefined} onChange={(e) => onChange({ ...setup, to: e.target.value })} data-testid="rb-to" />
              </div>
            </div>
          )}
          <button type="button" role="switch" aria-checked={setup.compare} className={setup.compare ? 'rb-switch rb-switch--on' : 'rb-switch'} onClick={() => onChange({ ...setup, compare: !setup.compare })} data-testid="rb-compare">
            <span className="rb-switch-track" aria-hidden="true"><span className="rb-switch-knob" /></span>
            <span>{t('Compare with previous period')}</span>
          </button>
          <p className="rb-hint" data-testid="rb-period-text">
            {p.range ? <>{t('Period')}: <b>{rangeLabel(p.range)}</b></> : t('Working out the period…')}
            {setup.compare && p.compareRange ? <> · {setup.preset === 'ytd' ? t('Same dates last year') : t('Previous period')}: <b>{rangeLabel(p.compareRange)}</b></> : null}
          </p>
        </Step>

        <Step n={3} title={t('Filters')} hint={t('All optional. Leave a filter empty to include everything.')} testid="rb-filters">
          <div className="rb-filter-grid">
            <MultiPick id="rb-line" label={t('Line')} testid="rb-line" stacked allLabel={t('All lines')} options={lines.map((l) => ({ value: l.line_id, label: l.line_id, hint: l.name }))} value={f.lineIds}
              onChange={(v) => setFilters({ lineIds: v, areaIds: f.areaIds.filter((a) => areas.find((x) => x.area_id === a && (v.length === 0 || v.includes(x.line_id)))) })} />
            <MultiPick id="rb-area" label={t('Area')} testid="rb-area" stacked allLabel={t('All areas')} options={areaOpts} value={f.areaIds} onChange={(v) => setFilters({ areaIds: v })} />
            <MultiPick id="rb-code" label={t('Equipment ID')} testid="rb-code" stacked allLabel={t('All equipment')} searchable options={equipOpts} value={f.equipmentIds} onChange={(v) => setFilters({ equipmentIds: v })} />
          </div>
          <div className="rb-chip-fields">
            <div className="field">
              <span className="field-label">{t('Classification')}</span>
              <ChipRow label={t('Classification')}>
                {(startup?.classifications.map((c) => c.code) ?? CLASS_CODES).map((c) => (
                  <CountChip key={c} on={f.classifications.includes(c)} onClick={() => setFilters({ classifications: toggleIn(f.classifications, c) })} testid={`rb-cls-${c}`}>{c}</CountChip>
                ))}
              </ChipRow>
            </div>
            <div className="field">
              <span className="field-label">{t('Criticality')}</span>
              <ChipRow label={t('Criticality')}>
                {(['INC', 'NO_INC'] as Criticality[]).map((c) => (
                  <CountChip key={c} on={f.criticality.includes(c)} onClick={() => setFilters({ criticality: toggleIn(f.criticality, c) })} testid={`rb-crit-${c}`}>{c}</CountChip>
                ))}
              </ChipRow>
            </div>
            <div className="field">
              <span className="field-label">{t('Records')}</span>
              <CountChip on={f.failuresOnly} onClick={() => setFilters({ failuresOnly: !f.failuresOnly })} testid="rb-fail">{t('Failures only')}</CountChip>
            </div>
          </div>
          {chips.length > 0 && (
            <div className="fb-active rb-active" role="group" aria-label={t('Active filters')} data-testid="rb-active">
              {chips.map((c) => (
                <button key={c.id} type="button" className="chip chip--on" onClick={c.clear} aria-label={t('Remove filter {f}', { f: c.text })} data-testid={`rb-chip-${c.id}`}>
                  {c.text} <Icon name="close" size={12} />
                </button>
              ))}
              <button type="button" className="chip" onClick={() => onChange({ ...setup, filters: { lineIds: [], areaIds: [], equipmentIds: [], classifications: [], criticality: [], failuresOnly: false } })} data-testid="rb-reset-filters">{t('Clear all')}</button>
            </div>
          )}
          <p className="rb-scope rb-scope--inline" data-testid="rb-scope-inline" role="status">
            {p.scope === null ? t('Counting…') : t('{n} events, {h} area-hours in scope', { n: fint(p.scope.events), h: fh(p.scope.areaHours) })}
          </p>
        </Step>

        <Step n={4} title={t('Sections')} hint={t('Tick what goes into the report. It is built in this order.')} testid="rb-sections">
          <div className="rb-sec-tools">
            <button type="button" className="btn btn-sm" onClick={() => setSections([...SECTION_ORDER])} data-testid="rb-sec-all">{t('Select all')}</button>
            <button type="button" className="btn btn-sm" onClick={() => setSections([])} data-testid="rb-sec-none">{t('Select none')}</button>
            <span className="rb-count" data-testid="rb-sec-count" role="status">{t('{n} of {m} selected', { n: setup.sections.length, m: SECTION_DEFS.length })}</span>
          </div>
          {SECTION_GROUPS.map((g) => (
            <div key={g.id} className="rb-group" role="group" aria-label={t(g.label)} data-testid={`rb-group-${g.id}`}>
              <h3 className="rb-group-title">{t(g.label)}</h3>
              {SECTION_DEFS.filter((s) => s.group === g.id).map((s) => (
                <SectionRow key={s.id} def={s} on={chosen.has(s.id)} onToggle={() => toggleSection(s.id)} options={effectiveOptions(s.id, setup.options[s.id])} onOption={(patch) => setOption(s.id, patch)} />
              ))}
            </div>
          ))}
        </Step>
      </div>
      <div className="rb-side">{summary}</div>
    </div>
  );
}

function SectionRow({ def, on, onToggle, options, onOption }: { def: SectionDef; on: boolean; onToggle: () => void; options: ReportSectionOptions; onOption: (patch: ReportSectionOptions) => void }) {
  const label = t(def.label);
  return (
    <div className={on ? 'rb-sec rb-sec--on' : 'rb-sec'} data-testid={`rb-secrow-${def.id}`}>
      <label className="rb-sec-label">
        <input type="checkbox" checked={on} onChange={onToggle} data-testid={`rb-sec-${def.id}`} />
        <span><b>{label}</b><small>{t(def.description)}</small></span>
      </label>
      {on && (def.top || def.measure) && (
        <div className="rb-opts">
          {def.top && (
            <Toggle
              value={String(options.top)} label={t('{s}: number of rows', { s: label })} testid={`rb-opt-${def.id}-top`}
              options={def.top.map((n) => ({ value: String(n), label: n === 'all' ? t('All') : t('Top {n}', { n }) }))}
              onChange={(v) => onOption({ top: v === 'all' ? 'all' : Number(v) })}
            />
          )}
          {def.measure && (
            <Toggle
              value={options.measure ?? 'hours'} label={t('{s}: measure', { s: label })} testid={`rb-opt-${def.id}-measure`}
              options={[{ value: 'hours' as const, label: t('Hours') }, { value: 'count' as const, label: t('Count') }]}
              onChange={(v) => onOption({ measure: v })}
            />
          )}
        </div>
      )}
    </div>
  );
}

