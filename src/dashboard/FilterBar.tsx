// The one filter bar every Analyze page shows. State lives in the URL query and is shared between the four pages
// (see useDash.ts and sharedFilters.ts). One compact row: date range, comparison, and a Filters button with the
// number of active filters. The button opens the full set of fields as an inline panel on a desktop and as the
// bottom sheet on a phone; the active filters sit below as removable chips with Reset.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ClassificationCode } from '../api/types';
import { matchKey } from '../calc';
import { BottomSheet, ChipRow, CountChip } from '../components/PhoneParts';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { areasInScope, activeCount, DEFAULT_PRESET, PRESET_LABELS, RANGE_PRESETS, type CompareMode, type RangePreset } from './filters';
import { dayLabel, fint, rangeLabel } from './format';
import type { Dash } from './useDash';

interface Opt { value: string; label: string; hint?: string }

export function MultiPick({ id, label, options, value, onChange, allLabel, searchable, stacked, testid }: {
  id: string; label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; allLabel: string; searchable?: boolean; stacked?: boolean; testid: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || stacked) return;
    const onDoc = (e: Event) => ref.current && e.target instanceof Node && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, stacked]);
  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => (needle ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options), [options, needle]);
  const shown = matches.slice(0, 80);
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0]!) : t('{n} selected', { n: value.length });
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className={stacked ? 'field mp mp--stacked' : 'field mp'} ref={ref}>
      <label htmlFor={id}>{label}</label>
      <button type="button" id={id} className="select mp-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((v) => !v)} data-testid={testid}>
        <span>{summary}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && (
        <div className="mp-panel" role="group" aria-label={label}>
          {searchable && (
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search…')} aria-label={t('Search {what}', { what: label })} autoComplete="off" data-testid={`${testid}-search`} />
          )}
          <div className="mp-list" role="listbox" aria-multiselectable="true" aria-label={label}>
            {shown.map((o) => (
              <label key={o.value} className="mp-opt" role="option" aria-selected={value.includes(o.value)}>
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} data-testid={`${testid}-opt`} data-value={o.value} />
                <span>{o.label}{o.hint && <> <small>{o.hint}</small></>}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="muted" style={{ margin: 6, fontSize: 13 }}>{t('Nothing matches.')}</p>}
          </div>
          {matches.length > shown.length && <p className="field-hint">{t('{n} more; type to narrow the list.', { n: matches.length - shown.length })}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            {value.length > 0 && <button type="button" className="btn btn-sm" onClick={() => onChange([])}>{t('Clear')}</button>}
            <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setQ(''); }}>{t('Done')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CMP_LABELS: Record<CompareMode, string> = {
  previous_period: 'Previous period', same_period_last_year: 'Same period last year', none: 'None',
};
const CMP_SHORT: Record<CompareMode, string> = { previous_period: 'Previous', same_period_last_year: 'Last year', none: 'None' };

/** Date range select and its extra pickers (year, month, custom dates). */
function RangeFields({ dash }: { dash: Dash }) {
  const { filters: f, setFilters, startup, range } = dash;
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `fb-${n}-${uid}`;
  const years = startup?.years ?? [];
  const setPreset = (p: RangePreset) => setFilters({
    preset: p,
    year: p === 'year' ? (f.year ?? years[0] ?? null) : f.year,
    month: p === 'month' ? (f.month ?? (range ? range.to.slice(0, 7) : null)) : f.month,
    from: p === 'custom' ? (f.from || range?.from || '') : f.from,
    to: p === 'custom' ? (f.to || range?.to || '') : f.to,
  });
  return (
    <>
      <div className="field fb-range-field">
        <label htmlFor={id('preset')}>{t('Date range')}</label>
        <select id={id('preset')} className="select" value={f.preset} onChange={(e) => setPreset(e.target.value as RangePreset)} data-testid="fb-preset">
          {RANGE_PRESETS.map((p) => <option key={p} value={p}>{t(PRESET_LABELS[p])}</option>)}
        </select>
      </div>
      {f.preset === 'year' && (
        <div className="field fb-extra">
          <label htmlFor={id('year')}>{t('Year')}</label>
          <select id={id('year')} className="select" value={f.year ?? ''} onChange={(e) => setFilters({ year: Number(e.target.value) })} data-testid="fb-year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
      {f.preset === 'month' && (
        <div className="field fb-extra">
          <label htmlFor={id('month')}>{t('Month')}</label>
          <input id={id('month')} className="input mono" type="month" value={f.month ?? ''} onChange={(e) => e.target.value && setFilters({ month: e.target.value })} data-testid="fb-month" />
        </div>
      )}
      {f.preset === 'custom' && (
        <>
          <div className="field fb-extra">
            <label htmlFor={id('from')}>{t('From date')}</label>
            <input id={id('from')} className="input mono" type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} data-testid="fb-from" />
          </div>
          <div className="field fb-extra">
            <label htmlFor={id('to')}>{t('To date')}</label>
            <input id={id('to')} className="input mono" type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} data-testid="fb-to" />
          </div>
        </>
      )}
    </>
  );
}

/** Previous period / Same period last year / None. */
function CompareToggle({ dash, short }: { dash: Dash; short: boolean }) {
  const { filters: f, setFilters, ctx } = dash;
  const cmp: CompareMode = f.compare ?? ctx?.master.settings.defaultComparison ?? 'previous_period';
  return (
    <div className="field fb-compare">
      <span className="field-label">{t('Compare with')}</span>
      <ChipRow label={t('Comparison')}>
        {(['previous_period', 'same_period_last_year', 'none'] as CompareMode[]).map((c) => (
          <button key={c} type="button" className={cmp === c ? 'chip chip--on' : 'chip'} aria-pressed={cmp === c} onClick={() => setFilters({ compare: c })}
            aria-label={c === 'none' ? t('No comparison') : t(CMP_LABELS[c])} data-testid={`fb-cmp-${c}`}>
            {t(short ? CMP_SHORT[c] : CMP_LABELS[c])}
          </button>
        ))}
      </ChipRow>
    </div>
  );
}

/** The narrowing fields: line, area, equipment, type, reason and the classification / criticality / failure / duration chips. */
function Fields({ dash, stacked }: { dash: Dash; stacked?: boolean }) {
  const { filters: f, setFilters, startup, ctx } = dash;
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `fb-${stacked ? 's' : 'd'}-${n}-${uid}`;
  const lines = startup?.lines ?? [];
  const areas = useMemo(() => (startup?.areas ?? []).filter((a) => a.active && a.in_downtime_sheet), [startup]);
  const areaOpts: Opt[] = useMemo(
    () => areas.filter((a) => f.lineIds.length === 0 || f.lineIds.includes(a.line_id)).sort((a, b) => a.sort_order - b.sort_order).map((a) => ({ value: a.area_id, label: a.area_id, hint: a.name })),
    [areas, f.lineIds],
  );
  const equipOpts: Opt[] = useMemo(() => {
    if (!startup) return [];
    const allowed = new Set(areasInScope(startup.areas, f));
    const narrowed = f.lineIds.length > 0 || f.areaIds.length > 0;
    const inScope = new Set(startup.equipment_areas.filter((ea) => allowed.has(ea.area_id)).map((ea) => ea.equipment_id));
    return startup.equipment
      .filter((e) => e.status === 'Active' && (!narrowed || inScope.has(e.equipment_id)))
      .sort((a, b) => (a.equipment_id < b.equipment_id ? -1 : 1))
      .map((e) => ({ value: e.equipment_id, label: e.equipment_id, hint: e.description }));
  }, [startup, f]);
  const typeOpts: Opt[] = useMemo(() => [...new Set((startup?.equipment ?? []).map((e) => e.equipment_type).filter((x): x is string => !!x))].sort().map((x) => ({ value: x, label: x })), [startup]);
  const reasonOpts: Opt[] = useMemo(() => {
    const m = new Map<string, { text: string; n: number }>();
    for (const r of dash.allRows) {
      const text = (r.reason_raw ?? '').trim().replace(/\s+/g, ' ');
      if (!text || r.is_void) continue;
      const k = matchKey(text);
      const cur = m.get(k);
      if (cur) cur.n++;
      else m.set(k, { text, n: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].text < b[1].text ? -1 : 1)).map(([k, v]) => ({ value: k, label: v.text }));
  }, [dash.allRows]);
  const settings = ctx?.master.settings;
  const toggleCls = (c: ClassificationCode) => setFilters({ classifications: f.classifications.includes(c) ? f.classifications.filter((x) => x !== c) : [...f.classifications, c] });
  const gridClass = stacked ? 'bottom-sheet-body' : 'fb-grid';

  return (
    <>
      <div className={gridClass} style={stacked ? { padding: 0 } : undefined}>
        <MultiPick id={id('line')} label={t('Line')} testid="fb-line" stacked={stacked} allLabel={t('All lines')}
            options={lines.map((l) => ({ value: l.line_id, label: l.name }))} value={f.lineIds}
            onChange={(v) => setFilters({ lineIds: v, areaIds: f.areaIds.filter((a) => areas.find((x) => x.area_id === a && (v.length === 0 || v.includes(x.line_id)))) })} />
        <MultiPick id={id('area')} label={t('Area')} testid="fb-area" stacked={stacked} allLabel={t('All areas')} options={areaOpts} value={f.areaIds} onChange={(v) => setFilters({ areaIds: v })} />
        <MultiPick id={id('code')} label={t('Equipment code')} testid="fb-code" stacked={stacked} allLabel={t('All equipment')} searchable options={equipOpts} value={f.equipmentIds} onChange={(v) => setFilters({ equipmentIds: v })} />
        {typeOpts.length > 0 && (
          <MultiPick id={id('type')} label={t('Equipment type')} testid="fb-type" stacked={stacked} allLabel={t('All types')} options={typeOpts} value={f.equipmentTypes} onChange={(v) => setFilters({ equipmentTypes: v })} />
        )}
        <MultiPick id={id('reason')} label={t('Reason')} testid="fb-reason" stacked={stacked} allLabel={t('All reasons')} searchable options={reasonOpts} value={f.reasonKeys} onChange={(v) => setFilters({ reasonKeys: v })} />
      </div>

      <div className="fb-line">
        <div className="field">
          <span className="field-label">{t('Classification')}</span>
          <ChipRow label={t('Classification')}>
            {(startup?.classifications ?? []).map((c) => (
              <CountChip key={c.code} on={f.classifications.includes(c.code)} onClick={() => toggleCls(c.code)} testid={`fb-cls-${c.code}`}>{c.code}</CountChip>
            ))}
          </ChipRow>
        </div>
        <div className="field">
          <span className="field-label">{t('Criticality')}</span>
          <ChipRow label={t('Criticality')}>
            {(['INC', 'NO_INC'] as const).map((c) => (
              <CountChip key={c} on={f.criticality.includes(c)} onClick={() => setFilters({ criticality: f.criticality.includes(c) ? f.criticality.filter((x) => x !== c) : [...f.criticality, c] })} testid={`fb-crit-${c}`}>{c}</CountChip>
            ))}
          </ChipRow>
        </div>
        <div className="field">
          <span className="field-label">{t('Failures')}</span>
          <CountChip on={f.failureOnly} onClick={() => setFilters({ failureOnly: !f.failureOnly })} testid="fb-fail">{t('Failures only')}</CountChip>
        </div>
        <div className="field">
          <span className="field-label">{t('Duration')}</span>
          <ChipRow label={t('Duration band')}>
            {(['short', 'medium', 'long'] as const).map((b) => (
              <CountChip key={b} on={f.durationBand === b} onClick={() => setFilters({ durationBand: f.durationBand === b ? null : b })} testid={`fb-band-${b}`}>
                {b === 'short' ? t('Short ≤ {m} min', { m: settings?.durationShortMaxMin ?? 30 }) : b === 'long' ? t('Long ≥ {m} min', { m: settings?.durationLongMinMin ?? 120 }) : t('Medium')}
              </CountChip>
            ))}
          </ChipRow>
        </div>
      </div>
    </>
  );
}

/** Removable chips for every active filter, then Reset. */
function ActiveChips({ dash }: { dash: Dash }) {
  const { filters: f, setFilters, startup } = dash;
  const items: { id: string; text: string; clear: () => void }[] = [];
  const lineName = (id: string) => startup?.lines.find((l) => l.line_id === id)?.name ?? id;
  f.lineIds.forEach((v) => items.push({ id: `line-${v}`, text: `${t('Line')}: ${lineName(v)}`, clear: () => setFilters({ lineIds: f.lineIds.filter((x) => x !== v) }) }));
  f.areaIds.forEach((v) => items.push({ id: `area-${v}`, text: `${t('Area')}: ${v}`, clear: () => setFilters({ areaIds: f.areaIds.filter((x) => x !== v) }) }));
  f.equipmentIds.forEach((v) => items.push({ id: `code-${v}`, text: `${t('Code')}: ${v}`, clear: () => setFilters({ equipmentIds: f.equipmentIds.filter((x) => x !== v) }) }));
  f.equipmentTypes.forEach((v) => items.push({ id: `type-${v}`, text: `${t('Type')}: ${v}`, clear: () => setFilters({ equipmentTypes: f.equipmentTypes.filter((x) => x !== v) }) }));
  f.classifications.forEach((v) => items.push({ id: `cls-${v}`, text: `${t('Class')}: ${v}`, clear: () => setFilters({ classifications: f.classifications.filter((x) => x !== v) }) }));
  f.criticality.forEach((v) => items.push({ id: `crit-${v}`, text: v, clear: () => setFilters({ criticality: f.criticality.filter((x) => x !== v) }) }));
  if (f.failureOnly) items.push({ id: 'fail', text: t('Failures only'), clear: () => setFilters({ failureOnly: false }) });
  f.reasonKeys.forEach((v) => items.push({ id: `reason-${v}`, text: `${t('Reason')}: ${v.length > 28 ? `${v.slice(0, 27)}…` : v}`, clear: () => setFilters({ reasonKeys: f.reasonKeys.filter((x) => x !== v) }) }));
  if (f.durationBand) items.push({ id: 'band', text: `${t('Duration')}: ${f.durationBand}`, clear: () => setFilters({ durationBand: null }) });
  const changed = items.length > 0 || f.preset !== DEFAULT_PRESET || f.compare !== null;
  if (!changed) return null;
  return (
    <div className="fb-active" role="group" aria-label={t('Active filters')} data-testid="fb-active">
      {items.map((it) => (
        <button key={it.id} type="button" className="chip chip--on" onClick={it.clear} aria-label={t('Remove filter {f}', { f: it.text })} data-testid={`fb-chip-${it.id}`}>
          {it.text} <Icon name="close" size={12} />
        </button>
      ))}
      <button type="button" className="chip" onClick={dash.reset} data-testid="fb-reset">{t('Reset')}</button>
    </div>
  );
}

export default function FilterBar({ dash, eventCount, hideCompare }: { dash: Dash; eventCount: number | null; hideCompare?: boolean }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const panelId = useId().replace(/:/g, '');
  const { filters: f, range, ctx } = dash;
  const n = activeCount(f);
  const effective = ctx?.win.effective ?? null;
  const cov = ctx?.coverage ?? null;
  const rangeText = range ? rangeLabel(range) : '…';
  const days = range ? Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1 : 0;
  const filtersBtn = (
    <button
      type="button" className={n ? 'btn fb-filters-btn fb-filters-btn--on' : 'btn fb-filters-btn'} onClick={() => setOpen((v) => !v)}
      aria-expanded={open} aria-controls={mobile ? undefined : `fb-panel-${panelId}`} aria-haspopup={mobile ? 'dialog' : undefined} data-testid="fb-filters-pill"
    >
      <Icon name="filter" size={14} /> {t('Filters')}
      {n > 0 && <span className="fb-badge" data-testid="fb-badge" aria-label={t('{n} active', { n })}>{n}</span>}
      {!mobile && <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />}
    </button>
  );

  return (
    <section className="card filter-bar" aria-label={t('Filters')} data-testid="filter-bar">
      <div className="fb-row">
        <RangeFields dash={dash} />
        {filtersBtn}
        {!hideCompare && <CompareToggle dash={dash} short={mobile} />}
      </div>
      {!mobile && open && (
        <div className="fb-panel" id={`fb-panel-${panelId}`} role="group" aria-label={t('All filters')} data-testid="fb-panel">
          <Fields dash={dash} />
        </div>
      )}
      <ActiveChips dash={dash} />
      <div className="fb-scope" data-testid="fb-scope">
        <span data-testid="fb-range">{t('Range')}: <b>{rangeText}</b>{range && ` (${t('{n} days', { n: days })})`}</span>
        <span data-testid="fb-count"><b>{eventCount === null ? '…' : fint(eventCount)}</b> {t('events in scope')}</span>
        {cov && <span data-testid="fb-coverage">{t('Data covers')} <b>{dayLabel(cov.from)}</b> {t('to')} <b>{dayLabel(cov.to)}</b></span>}
        {range && effective && (effective.from !== range.from || effective.to !== range.to) && (
          <span data-testid="fb-clipped">{t('Calculated for {r}, where data exists', { r: rangeLabel(effective) })}</span>
        )}
      </div>
      {mobile && open && (
        <BottomSheet
          title={t('Filters')}
          onClose={() => setOpen(false)}
          testid="fb-sheet"
          footer={
            <>
              <button type="button" className="btn" onClick={dash.reset} data-testid="fb-sheet-reset">{t('Reset')}</button>
              <button type="button" className="btn-primary" onClick={() => setOpen(false)} data-testid="fb-sheet-apply">{eventCount === null ? t('Show events') : t('Show {n} events', { n: fint(eventCount) })}</button>
            </>
          }
        >
          <Fields dash={dash} stacked />
          <p className="field-hint" style={{ marginTop: 8 }}>{rangeText}</p>
        </BottomSheet>
      )}
    </section>
  );
}
