// The one scope bar of the Analyze pages and Event records: Period, Compare, Line, Area, Equipment, Type, Reset, Views
// and Export, with the note that every page shares it. State is the shared filter query (useDash.ts, sharedFilters.ts).
// Desktop: a sticky row of chips under the top bar, each opening a small panel; the active filters follow as removable
// chips. Phone: a row of pills and the orange 'Filters · N' pill, which open the filter sheet (sticky Reset and
// 'Show N events'). Drawn into the shell's scope slot (ScopeSlot.tsx) so it spans the page under the top bar.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ClassificationCode, EventRow, Startup } from '../api/types';
import { matchKey, type CalcSettings, type DateRange } from '../calc';
import { STACK_COLORS } from '../charts/palette';
import PopMenu from '../components/PopMenu';
import { BottomSheet } from '../components/PhoneParts';
import { InScopeSlot } from '../components/ScopeSlot';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dateText, monthText, rangeText } from '../util/dates';
import { VIEW_PAGE_PATH, viewPageOfPath, type SavedView } from '../views/savedViews';
import ViewsMenu from '../views/ViewsMenu';
import { MultiPick, PickList, type Opt } from './FilterBar';
import {
  activeCount, conflictingFilters, DEFAULT_PRESET, parseFilters, PRESET_LABELS, RANGE_PRESETS, serializeFilters, type CompareMode, type DashFilters, type RangePreset,
} from './filters';
import { fint } from './format';
import {
  areaOptions, chosenGroups, compareText, equipmentOptions, periodText, pruneScope, toggleGroup, TYPE_GROUP_BLURB, TYPE_GROUP_CODE, TYPE_GROUP_LABEL, TYPE_GROUPS,
  typeGroups, typeSummary, type TypeGroup,
} from './scopeOptions';
import { rememberQuery } from './sharedFilters';
import type { Dash, FilterPatch } from './useDash';
import './scopebar.css';

/** What the bar needs from a page: the shared filters and enough data to list the choices. */
export interface ScopeSource {
  filters: DashFilters;
  setFilters: (patch: FilterPatch) => void;
  reset: () => void;
  startup: Startup | null;
  /** the range the filters resolve to (null while loading) */
  range: DateRange | null;
  /** the range the numbers are worked out for (the range clipped to the data), when known */
  effective?: DateRange | null;
  compareMode: CompareMode;
  compareRange: DateRange | null;
  settings: Pick<CalcSettings, 'durationShortMaxMin' | 'durationLongMinMin'> | null;
  /** loaded records, for the equipment (cross-area causes) and reason lists */
  rows: readonly EventRow[];
  /** the month in progress (data ends inside the range's month) */
  partialTo?: string | null;
}

export function scopeFromDash(dash: Dash): ScopeSource {
  const ctx = dash.ctx;
  return {
    filters: dash.filters, setFilters: dash.setFilters, reset: dash.reset, startup: dash.startup, range: dash.range,
    effective: ctx?.win.effective ?? null,
    compareMode: dash.filters.compare ?? ctx?.master.settings.defaultComparison ?? 'previous_period',
    compareRange: ctx?.win.compareRange ?? null,
    settings: ctx?.master.settings ?? null,
    rows: dash.allRows,
    partialTo: ctx && ctx.win.effective && ctx.kpis.current.status === 'ok' && ctx.kpis.current.partial
      && ctx.win.effective.from === dash.range?.from && ctx.win.effective.to === dash.range?.to ? ctx.win.effective.to : null,
  };
}

const CMP_LABELS: Record<CompareMode, string> = { previous_period: 'Previous period', same_period_last_year: 'Same period last year', none: 'No comparison' };
const PRESET_ORDER: RangePreset[] = ['month', 'thismonth', 'prevmonth', 'last7', 'last30', 'last90', 'ytd', 'year', 'custom'];
const GROUP_COLOR: Record<TypeGroup, string> = { incidental: STACK_COLORS.failure, planned: STACK_COLORS.planned, other: STACK_COLORS.other };
const days = (r: DateRange): number => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;

/** The shared choices and their option lists, worked out once per render of the bar. */
function useScopeModel(src: ScopeSource) {
  const { filters: f, startup, rows } = src;
  const lines = startup?.lines ?? [];
  const areaOpts = useMemo(() => areaOptions(startup?.areas ?? [], f), [startup, f.lineIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const lineKey = f.lineIds.join('|');
  const areaKey = f.areaIds.join('|');
  const equipOpts = useMemo<Opt[]>(() => (startup ? equipmentOptions(startup, rows, f) : []), [startup, rows, lineKey, areaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeOpts = useMemo<Opt[]>(() => [...new Set((startup?.equipment ?? []).map((e) => e.equipment_type).filter((x): x is string => !!x))].sort().map((x) => ({ value: x, label: x })), [startup]);
  // reasons of the areas in scope (the chosen ones stay listed)
  const reasonOpts = useMemo<Opt[]>(() => {
    const inScope = new Set(areaOpts.filter((a) => f.areaIds.length === 0 || f.areaIds.includes(a.value)).map((a) => a.value));
    const m = new Map<string, { text: string; n: number }>();
    for (const r of rows) {
      if (r.is_void || !inScope.has(r.area_id)) continue;
      const text = (r.reason_raw ?? '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      const k = matchKey(text);
      const cur = m.get(k);
      if (cur) cur.n++;
      else m.set(k, { text, n: 1 });
    }
    for (const k of f.reasonKeys) if (!m.has(k)) m.set(k, { text: k, n: 0 });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].text < b[1].text ? -1 : 1)).map(([k, v]) => ({ value: k, label: v.text }));
  }, [rows, areaOpts, areaKey, f.reasonKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => typeGroups(startup?.classifications ?? []), [startup]);
  /** Every change goes through here: a line or area change prunes the areas and equipment that fell out of scope. */
  const set = (patch: FilterPatch) => src.setFilters((cur) => {
    const p = typeof patch === 'function' ? patch(cur) : patch;
    if (!p.lineIds && !p.areaIds) return p;
    const next = pruneScope({ ...cur, ...p }, startup, rows);
    return { ...p, areaIds: next.areaIds, equipmentIds: next.equipmentIds };
  });
  const lineName = (id: string) => lines.find((l) => l.line_id === id)?.name ?? id;
  const lineText = f.lineIds.length === 0 ? t('All') : f.lineIds.length === 1 ? lineName(f.lineIds[0]!) : t('{n} lines', { n: f.lineIds.length });
  const areaText = f.areaIds.length === 0 ? t('All') : f.areaIds.length <= 2 ? f.areaIds.join(', ') : t('{n} areas', { n: f.areaIds.length });
  const equipText = f.equipmentIds.length === 0 ? t('All') : f.equipmentIds.length === 1 ? f.equipmentIds[0]! : t('{n} codes', { n: f.equipmentIds.length });
  return { f, lines, areaOpts, equipOpts, typeOpts, reasonOpts, groups, set, lineName, lineText, areaText, equipText, typeText: typeSummary(f, groups) };
}
type Model = ReturnType<typeof useScopeModel>;

// ---------------------------------------------------------------- the fields (shared by the panels and the sheet)

function PeriodFields({ src, m, chips }: { src: ScopeSource; m: Model; chips?: boolean }) {
  const { f, set } = m;
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `sb-${n}-${uid}`;
  const years = src.startup?.years ?? [];
  const range = src.range;
  // the phone's row of presets scrolls sideways: bring the chosen one into view when the sheet opens
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const on = row?.querySelector<HTMLElement>('.sb-opt--on');
    if (chips && row && on && on.offsetLeft + on.offsetWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - 16;
  }, [chips]);
  const setPreset = (p: RangePreset) => set({
    preset: p,
    year: p === 'year' ? (f.year ?? years[0] ?? null) : f.year,
    month: p === 'month' ? (f.month ?? (range ? range.to.slice(0, 7) : null)) : f.month,
    from: p === 'custom' ? (f.from || range?.from || '') : f.from,
    to: p === 'custom' ? (f.to || range?.to || '') : f.to,
  });
  return (
    <div className="sb-period">
      <div ref={rowRef} className={chips ? 'sb-chiprow sb-chiprow--scroll' : 'sb-presets'} role="group" aria-label={t('Period')}>
        {PRESET_ORDER.filter((p) => RANGE_PRESETS.includes(p)).map((p) => (
          <button key={p} type="button" className={f.preset === p ? 'sb-opt sb-opt--on' : 'sb-opt'} aria-pressed={f.preset === p} onClick={() => setPreset(p)} data-testid={`fb-preset-${p}`}>
            {f.preset === p && <Icon name="check" size={14} />}{t(PRESET_LABELS[p])}
          </button>
        ))}
      </div>
      {f.preset === 'year' && (
        <div className="field sb-extra">
          <label htmlFor={id('year')}>{t('Year')}</label>
          <select id={id('year')} className="select" value={f.year ?? ''} onChange={(e) => set({ year: Number(e.target.value) })} data-testid="fb-year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
      {f.preset === 'month' && (
        <div className="field sb-extra">
          <label htmlFor={id('month')}>{t('Month')}</label>
          <div className="sb-date">
            <input id={id('month')} className="input mono" type="month" value={f.month ?? ''} onChange={(e) => e.target.value && set({ month: e.target.value })} data-testid="fb-month" />
            {f.month && <span className="sb-date-text" aria-hidden="true">{monthText(f.month)}</span>}
          </div>
        </div>
      )}
      {f.preset === 'custom' && (
        <div className="sb-dates">
          <div className="field sb-extra">
            <label htmlFor={id('from')}>{t('From date')}</label>
            <div className="sb-date">
              <input id={id('from')} className="input mono" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="fb-from" />
              {f.from && <span className="sb-date-text" aria-hidden="true">{dateText(f.from)}</span>}
            </div>
          </div>
          <div className="field sb-extra">
            <label htmlFor={id('to')}>{t('To date')}</label>
            <div className="sb-date">
              <input id={id('to')} className="input mono" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="fb-to" />
              {f.to && <span className="sb-date-text" aria-hidden="true">{dateText(f.to)}</span>}
            </div>
          </div>
        </div>
      )}
      {range && <p className="sb-panel-foot" data-testid="scope-period-range">{rangeText(range)} · {t('{n} days', { n: days(range) })}</p>}
    </div>
  );
}

function CompareFields({ src, m, chips }: { src: ScopeSource; m: Model; chips?: boolean }) {
  return (
    <div className={chips ? 'sb-chiprow' : 'sb-presets'} role="group" aria-label={t('Compare with')}>
      {(['previous_period', 'same_period_last_year', 'none'] as CompareMode[]).map((c) => (
        <button key={c} type="button" className={src.compareMode === c ? 'sb-opt sb-opt--on' : 'sb-opt'} aria-pressed={src.compareMode === c} onClick={() => m.set({ compare: c })}
          aria-label={c === 'none' ? t('No comparison') : t(CMP_LABELS[c])} data-testid={`fb-cmp-${c}`}>
          {src.compareMode === c && <Icon name="check" size={14} />}{t(CMP_LABELS[c])}
          {src.compareMode === c && c !== 'none' && src.compareRange && <small>{rangeText(src.compareRange)}</small>}
        </button>
      ))}
    </div>
  );
}

/** Incidental / Planned / Other with their colour and meaning. */
function TypeGroupsField({ m }: { m: Model }) {
  const on = chosenGroups(m.f.classifications, m.groups);
  return (
    <div className="sb-types" role="group" aria-label={t('Type')}>
      {TYPE_GROUPS.filter((g) => m.groups[g].length > 0).map((g) => (
        <label key={g} className="sb-type">
          <input type="checkbox" checked={on.includes(g)} onChange={() => m.set((cur) => ({ classifications: toggleGroup(cur.classifications, g, m.groups) }))} data-testid={`fb-group-${g}`} />
          <span className={`sb-swatch sb-swatch--${g}`} style={{ background: GROUP_COLOR[g] }} aria-hidden="true" />
          <span className="sb-type-text">
            <b>{t(TYPE_GROUP_LABEL[g])} ({TYPE_GROUP_CODE[g]})</b>
            <small>{t(TYPE_GROUP_BLURB[g])}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Classification, criticality, failures only, duration, reason and equipment type. */
function MoreFields({ src, m, stacked }: { src: ScopeSource; m: Model; stacked?: boolean }) {
  const { f, set } = m;
  const uid = useId().replace(/:/g, '');
  const s = src.settings;
  const toggleCls = (c: ClassificationCode) => set((cur) => ({ classifications: cur.classifications.includes(c) ? cur.classifications.filter((x) => x !== c) : [...cur.classifications, c] }));
  const chip = (on: boolean, onClick: () => void, testid: string, label: ReactNode) => (
    <button type="button" className={on ? 'sb-opt sb-opt--on' : 'sb-opt'} aria-pressed={on} onClick={onClick} data-testid={testid}>{label}</button>
  );
  return (
    <div className="sb-more">
      <div className="sb-more-row">
        <span className="sb-label">{t('Classification')}</span>
        <div className="sb-chiprow">{(src.startup?.classifications ?? []).map((c) => chip(f.classifications.includes(c.code), () => toggleCls(c.code), `fb-cls-${c.code}`, c.code))}</div>
      </div>
      <div className="sb-more-row">
        <span className="sb-label">{t('Criticality')}</span>
        <div className="sb-chiprow">{(['INC', 'NO_INC'] as const).map((c) => chip(f.criticality.includes(c), () => set((cur) => ({ criticality: cur.criticality.includes(c) ? cur.criticality.filter((x) => x !== c) : [...cur.criticality, c] })), `fb-crit-${c}`, c))}</div>
      </div>
      {!stacked && (
        <div className="sb-more-row">
          <span className="sb-label">{t('Failures')}</span>
          <div className="sb-chiprow">{chip(f.failureOnly, () => set((cur) => ({ failureOnly: !cur.failureOnly })), 'fb-fail', t('Failures only'))}</div>
        </div>
      )}
      <div className="sb-more-row">
        <span className="sb-label">{t('Duration')}</span>
        <div className="sb-chiprow">
          {(['short', 'medium', 'long'] as const).map((b) => chip(f.durationBand === b, () => set((cur) => ({ durationBand: cur.durationBand === b ? null : b })), `fb-band-${b}`,
            b === 'short' ? t('Short ≤ {m} min', { m: s?.durationShortMaxMin ?? 30 }) : b === 'long' ? t('Long ≥ {m} min', { m: s?.durationLongMinMin ?? 120 }) : t('Medium')))}
        </div>
      </div>
      <div className="sb-more-grid">
        <MultiPick id={`sb-reason-${uid}`} label={t('Reason')} testid="fb-reason" stacked={stacked} allLabel={t('All reasons')} searchable options={m.reasonOpts} value={f.reasonKeys} onChange={(v) => set({ reasonKeys: v })} />
        {m.typeOpts.length > 0 && (
          <MultiPick id={`sb-type-${uid}`} label={t('Equipment type')} testid="fb-type" stacked={stacked} allLabel={t('All types')} options={m.typeOpts} value={f.equipmentTypes} onChange={(v) => set({ equipmentTypes: v })} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- desktop

/** A chip of the bar: 'Line: All ▾', opening its panel. */
function Chip({ label, value, set, testid, children, wide }: { label: string; value: string; set: boolean; testid: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  return (
    <PopMenu
      label={`${label}: ${value}`} kind="dialog" testid={testid} buttonClass={set ? 'sb-chip sb-chip--set' : 'sb-chip'} panelClass={wide ? 'sb-pop sb-pop--wide' : 'sb-pop'}
      content={<><span className="sb-chip-label">{label}:</span> <span className="sb-chip-value">{value}</span></>}
    >
      {children}
    </PopMenu>
  );
}

/** Removable chips for every active filter (one click takes one out). */
function ActiveChips({ src, m }: { src: ScopeSource; m: Model }) {
  const { f, set } = m;
  const items: { id: string; text: string; clear: () => void }[] = [];
  f.lineIds.forEach((v) => items.push({ id: `line-${v}`, text: `${t('Line')}: ${m.lineName(v)}`, clear: () => set((cur) => ({ lineIds: cur.lineIds.filter((x) => x !== v) })) }));
  f.areaIds.forEach((v) => items.push({ id: `area-${v}`, text: `${t('Area')}: ${v}`, clear: () => set((cur) => ({ areaIds: cur.areaIds.filter((x) => x !== v) })) }));
  f.equipmentIds.forEach((v) => items.push({ id: `code-${v}`, text: `${t('Code')}: ${v}`, clear: () => set((cur) => ({ equipmentIds: cur.equipmentIds.filter((x) => x !== v) })) }));
  f.equipmentTypes.forEach((v) => items.push({ id: `type-${v}`, text: `${t('Type')}: ${v}`, clear: () => set((cur) => ({ equipmentTypes: cur.equipmentTypes.filter((x) => x !== v) })) }));
  f.classifications.forEach((v) => items.push({ id: `cls-${v}`, text: `${t('Class')}: ${v}`, clear: () => set((cur) => ({ classifications: cur.classifications.filter((x) => x !== v) })) }));
  f.criticality.forEach((v) => items.push({ id: `crit-${v}`, text: v, clear: () => set((cur) => ({ criticality: cur.criticality.filter((x) => x !== v) })) }));
  if (f.failureOnly) items.push({ id: 'fail', text: t('Failures only'), clear: () => set({ failureOnly: false }) });
  f.reasonKeys.forEach((v) => items.push({ id: `reason-${v}`, text: `${t('Reason')}: ${v.length > 28 ? `${v.slice(0, 27)}…` : v}`, clear: () => set((cur) => ({ reasonKeys: cur.reasonKeys.filter((x) => x !== v) })) }));
  if (f.durationBand) items.push({ id: 'band', text: `${t('Duration')}: ${f.durationBand}`, clear: () => set({ durationBand: null }) });
  if (!items.length) return null;
  return (
    <div className="sb-active" role="group" aria-label={t('Active filters')} data-testid="fb-active">
      {items.map((it) => (
        <button key={it.id} type="button" className="sb-tag" onClick={it.clear} aria-label={t('Remove filter {f}', { f: it.text })} data-testid={`fb-chip-${it.id}`}>
          {it.text} <Icon name="close" size={12} />
        </button>
      ))}
      <span className="sb-active-count" data-testid="fb-badge" aria-label={t('{n} active', { n: activeCount(src.filters) })}>{activeCount(src.filters)}</span>
    </div>
  );
}

/** The Views button of the page: saves the filters on screen; applying one goes to the page with its query. */
function DashViews({ src }: { src: ScopeSource }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = viewPageOfPath(location.pathname);
  if (!page) return null;
  const apply = (v: SavedView) => {
    const q = serializeFilters(parseFilters(new URLSearchParams(v.query))).toString();
    rememberQuery(q);
    navigate({ pathname: VIEW_PAGE_PATH[page], search: q ? `?${q}` : '' });
  };
  return <ViewsMenu page={page} currentQuery={() => serializeFilters(src.filters).toString()} onApply={apply} />;
}

export const SCOPE_NOTE = 'Shared by Dashboard, Losses, Repeated failures, Reliability, Event records — change it once, every page follows.';

function DesktopBar({ src, m, eventCount, hideCompare, views, exportMenu, extra }: BarProps & { m: Model }) {
  const { f, set } = m;
  const clash = conflictingFilters(f);
  const range = src.range;
  const eff = src.effective ?? null;
  return (
    <>
    <section className="scope-bar" aria-label={t('Scope')} data-testid="filter-bar">
      <div className="sb-row">
        <Chip label={t('Period')} value={periodText(f, range)} set={f.preset !== DEFAULT_PRESET} testid="scope-period" wide>
          {() => <PeriodFields src={src} m={m} />}
        </Chip>
        {!hideCompare && (
          <Chip label={t('Compare')} value={compareText(src.compareMode, src.compareRange)} set={f.compare !== null} testid="scope-compare">
            {() => <CompareFields src={src} m={m} />}
          </Chip>
        )}
        <Chip label={t('Line')} value={m.lineText} set={f.lineIds.length > 0} testid="fb-line">
          {(close) => <PickList label={t('Line')} options={m.lines.map((l) => ({ value: l.line_id, label: l.name }))} value={f.lineIds} onChange={(v) => set({ lineIds: v })} testid="fb-line" onDone={close} />}
        </Chip>
        <Chip label={t('Area')} value={m.areaText} set={f.areaIds.length > 0} testid="fb-area">
          {(close) => <PickList label={t('Area')} options={m.areaOpts} value={f.areaIds} onChange={(v) => set({ areaIds: v })} testid="fb-area" onDone={close} />}
        </Chip>
        <Chip label={t('Equipment')} value={m.equipText} set={f.equipmentIds.length > 0} testid="fb-code" wide>
          {(close) => (
            <PickList label={t('Equipment')} options={m.equipOpts} value={f.equipmentIds} onChange={(v) => set({ equipmentIds: v })} testid="fb-code" searchable onDone={close}
              placeholder={t('Code or description')} />
          )}
        </Chip>
        <Chip label={t('Type')} value={m.typeText} set={m.typeText !== t('All')} testid="scope-type" wide>
          {() => (
            <>
              <TypeGroupsField m={m} />
              <h3 className="sb-subhead">{t('More filters')}</h3>
              <MoreFields src={src} m={m} />
              {clash && <p className="sb-clash" role="status">{t(clash)}</p>}
            </>
          )}
        </Chip>
        <button type="button" className="sb-reset" onClick={src.reset} data-testid="fb-reset"><Icon name="reset" size={15} /> {t('Reset')}</button>
        <span className="sb-end">
          {views ?? <DashViews src={src} />}
          {exportMenu}
        </span>
      </div>
    </section>
    <InScopeSlot info>
    <div className="scope-info" data-testid="scope-info">
      <div className="sb-info">
        <span className="sb-note" data-testid="scope-note" title={t(SCOPE_NOTE)} aria-label={t(SCOPE_NOTE)} role="note"><Icon name="link" size={14} /> {t('Shared filters')}</span>
        <p className="sb-scope" data-testid="fb-scope">
          {range && <span data-testid="fb-range">{rangeText(range)} ({t('{n} days', { n: days(range) })})</span>}
          {eventCount !== null && <span data-testid="fb-count"><b>{fint(eventCount)}</b> {t('events in scope')}</span>}
          {range && eff && (eff.from !== range.from || eff.to !== range.to) && <span data-testid="fb-clipped">{t('Calculated for {r}, where data exists', { r: rangeText(eff) })}</span>}
          {src.partialTo && <span data-testid="fb-partial">{t('Month in progress: data to {d}, not a whole month', { d: dateText(src.partialTo) })}</span>}
          {extra}
        </p>
      </div>
      <ActiveChips src={src} m={m} />
      {clash && <div className="callout callout--warning fb-clash" role="status" data-testid="fb-clash"><Icon name="alert" size={16} /><span>{t(clash)}</span></div>}
    </div>
    </InScopeSlot>
    </>
  );
}

// ---------------------------------------------------------------- phone

function PhoneBar({ src, m, eventCount, hideCompare, views, exportMenu }: BarProps & { m: Model }) {
  const [open, setOpen] = useState(false);
  const { f, set } = m;
  const n = activeCount(f);
  const clash = conflictingFilters(f);
  const pill = (testid: string, text: string, on = false) => (
    <button type="button" className={on ? 'sb-pill sb-pill--set' : 'sb-pill'} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid={testid}>
      <span>{text}</span>
    </button>
  );
  const allAreas = m.areaOpts.length;
  return (
    <section className="scope-bar scope-bar--phone" aria-label={t('Scope')} data-testid="filter-bar">
      <div className="sb-pills">
        <div className="sb-pills-scroll">
          <button type="button" className="sb-pill sb-pill--period" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="scope-period">
            <span>{periodText(f, src.range)}</span><Icon name="chevronDown" size={14} />
          </button>
          {pill('scope-line', f.lineIds.length ? m.lineText : t('All lines'), f.lineIds.length > 0)}
          {pill('scope-area', f.areaIds.length ? m.areaText : t('All areas'), f.areaIds.length > 0)}
        </div>
        <button type="button" className={n ? 'sb-filters sb-filters--on' : 'sb-filters'} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="fb-filters-pill">
          <Icon name="sliders" size={16} /> {t('Filters')}{n > 0 && <> · <span data-testid="fb-badge" aria-label={t('{n} active', { n })}>{n}</span></>}
        </button>
      </div>
      {clash && <div className="callout callout--warning fb-clash" role="status" data-testid="fb-clash"><Icon name="alert" size={16} /><span>{t(clash)}</span></div>}
      {/* under the sticky pills, scrolling with the page: Views and Export (their panels need room), then the active filters */}
      <InScopeSlot info>
        <div className="scope-info scope-info--phone">
          <div className="sb-phone-tools" data-testid="scope-tools">
            {views ?? <DashViews src={src} />}
            {exportMenu}
          </div>
          {n > 0 && <ActiveChips src={src} m={m} />}
        </div>
      </InScopeSlot>
      {open && (
        <BottomSheet
          title={t('Filters')}
          badge={n > 0 ? t('{n} active', { n }) : undefined}
          withClose
          onClose={() => setOpen(false)}
          testid="fb-sheet"
          footer={
            <>
              <button type="button" className="btn sb-sheet-reset" onClick={src.reset} data-testid="fb-sheet-reset"><Icon name="reset" size={16} /> {t('Reset')}</button>
              <button type="button" className="btn-brand" onClick={() => setOpen(false)} data-testid="fb-sheet-apply">{eventCount === null ? t('Show events') : t('Show {n} events', { n: fint(eventCount) })}</button>
            </>
          }
        >
          <div className="sb-sec sb-sec--switch">
            <span><b>{t('Failures only')}</b> <small>· {t('breakdowns only')}</small></span>
            <button type="button" role="switch" aria-checked={f.failureOnly} aria-label={t('Failures only')} className={f.failureOnly ? 'sb-switch sb-switch--on' : 'sb-switch'} onClick={() => set((cur) => ({ failureOnly: !cur.failureOnly }))} data-testid="fb-fail">
              <span className="sb-switch-knob" aria-hidden="true" />
            </button>
          </div>
          <div className="sb-sec">
            <div className="sb-sec-head"><b>{t('Period')}</b>{src.range && <small data-testid="fb-range">{periodText(f, src.range)} · {rangeText(src.range)}</small>}</div>
            <PeriodFields src={src} m={m} chips />
          </div>
          {!hideCompare && (
            <div className="sb-sec">
              <div className="sb-sec-head"><b>{t('Compare with')}</b></div>
              <CompareFields src={src} m={m} chips />
            </div>
          )}
          <div className="sb-sec sb-sec--inline">
            <div className="sb-sec-head"><b>{t('Line')}</b></div>
            <div className="sb-chiprow" role="group" aria-label={t('Line')}>
              <button type="button" role="checkbox" aria-checked={f.lineIds.length === 0} className={f.lineIds.length === 0 ? 'sb-opt sb-opt--on' : 'sb-opt'} onClick={() => set({ lineIds: [] })} data-testid="fb-line-all">
                {f.lineIds.length === 0 && <Icon name="check" size={14} />}{t('All lines')}
              </button>
              {m.lines.map((l) => {
                const on = f.lineIds.includes(l.line_id);
                return (
                  <button key={l.line_id} type="button" role="checkbox" aria-checked={on} className={on ? 'sb-opt sb-opt--on' : 'sb-opt'} data-testid="fb-line-opt" data-value={l.line_id}
                    onClick={() => set((cur) => ({ lineIds: on ? cur.lineIds.filter((x) => x !== l.line_id) : [...cur.lineIds, l.line_id] }))}>
                    {on && <Icon name="check" size={14} />}{l.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sb-sec">
            <div className="sb-sec-head"><b>{t('Area')}</b><small>{f.areaIds.length ? t('{n} picked', { n: f.areaIds.length }) : t('None picked = all {n}', { n: allAreas })}</small></div>
            <div className="sb-chiprow" role="group" aria-label={t('Area')}>
              {m.areaOpts.map((a) => {
                const on = f.areaIds.includes(a.value);
                return (
                  <button key={a.value} type="button" role="checkbox" aria-checked={on} className={on ? 'sb-opt sb-opt--on' : 'sb-opt'} title={a.hint} data-testid="fb-area-opt" data-value={a.value}
                    onClick={() => set((cur) => ({ areaIds: on ? cur.areaIds.filter((x) => x !== a.value) : [...cur.areaIds, a.value] }))}>
                    {on && <Icon name="check" size={14} />}{a.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sb-sec">
            <div className="sb-sec-head"><b>{t('Equipment')}</b></div>
            <PickList label={t('Equipment')} options={m.equipOpts} value={f.equipmentIds} onChange={(v) => set({ equipmentIds: v })} testid="fb-code" searchable limit={30} placeholder={t('Code or description')} />
          </div>
          <div className="sb-sec">
            <div className="sb-sec-head"><b>{t('Type')}</b></div>
            <TypeGroupsField m={m} />
          </div>
          <details className="sb-sec sb-details">
            <summary data-testid="fb-more">{t('More filters')} <Icon name="chevronDown" size={18} /></summary>
            <MoreFields src={src} m={m} stacked />
          </details>
          {clash && <p className="sb-clash" role="status">{t(clash)}</p>}
        </BottomSheet>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the bar

interface BarProps {
  src: ScopeSource;
  /** records in scope ('Show N events', 'N events in scope'); null while loading */
  eventCount: number | null;
  /** pages without a comparison (Pareto, Reliability, Event records keep it: it is shared) */
  hideCompare?: boolean;
  /** the page's own Views menu (Event records); the dashboards' one by default */
  views?: ReactNode;
  /** the page's Export menu, when it has one */
  exportMenu?: ReactNode;
  /** more facts after the range on a desktop */
  extra?: ReactNode;
}

export default function ScopeBar(props: BarProps) {
  const mobile = useIsMobile();
  const m = useScopeModel(props.src);
  return <InScopeSlot>{mobile ? <PhoneBar {...props} m={m} /> : <DesktopBar {...props} m={m} />}</InScopeSlot>;
}
