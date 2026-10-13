// Pick lists of the filters: a searchable list of check boxes (PickList), used inside the scope bar's menus and the phone's
// filter sheet, and MultiPick, a labelled field with its own drop-down list (the report builder and the scope bar's
// "More filters"). The scope bar itself is ScopeBar.tsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/t';
import { Icon } from '../icons';

export interface Opt { value: string; label: string; hint?: string }

/** A searchable list of check boxes with Clear (and Done when `onDone` is given). */
export function PickList({ label, options, value, onChange, searchable, testid, onDone, limit = 80, placeholder }: {
  label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; searchable?: boolean; testid: string; onDone?: () => void; limit?: number; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => (needle ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options), [options, needle]);
  // chosen values stay listed first, even when the search leaves them out
  const shown = useMemo(() => {
    const chosen = options.filter((o) => value.includes(o.value));
    const rest = matches.filter((o) => !value.includes(o.value));
    return [...chosen, ...rest].slice(0, Math.max(limit, chosen.length));
  }, [options, matches, value, limit]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="mp-pick" role="group" aria-label={label}>
      {searchable && (
        <div className="mp-search">
          <Icon name="search" size={15} />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? t('Search…')} aria-label={t('Search {what}', { what: label })} autoComplete="off" data-testid={`${testid}-search`} />
          {searchable && <span className="mp-matches" aria-live="polite">{t('{a} of {b} matches', { a: matches.length, b: options.length })}</span>}
        </div>
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
      {(value.length > 0 || onDone) && (
        <div className="mp-actions">
          {value.length > 0 && <button type="button" className="btn btn-sm" onClick={() => onChange([])} data-testid={`${testid}-clear`}>{t('Clear')}</button>}
          {onDone && <button type="button" className="btn btn-sm" onClick={() => { setQ(''); onDone(); }}>{t('Done')}</button>}
        </div>
      )}
    </div>
  );
}

/** A labelled field that opens a PickList under it. */
export function MultiPick({ id, label, options, value, onChange, allLabel, searchable, stacked, testid }: {
  id: string; label: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void; allLabel: string; searchable?: boolean; stacked?: boolean; testid: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || stacked) return;
    const onDoc = (e: Event) => ref.current && e.target instanceof Node && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    ref.current?.addEventListener('keydown', onKey);
    const node = ref.current;
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      node?.removeEventListener('keydown', onKey);
    };
  }, [open, stacked]);
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0]!) : t('{n} selected', { n: value.length });
  return (
    <div className={stacked ? 'field mp mp--stacked' : 'field mp'} ref={ref}>
      <label htmlFor={id}>{label}</label>
      <button type="button" id={id} className="select mp-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((v) => !v)} data-testid={testid}>
        <span>{summary}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && (
        <div className="mp-panel">
          <PickList label={label} options={options} value={value} onChange={onChange} searchable={searchable} testid={testid} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
