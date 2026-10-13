import { useCallback, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { attributedHours, chainHours, isBlocked, rangeToInterval } from '../calc';
import DataStatus from '../components/DataStatus';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import type { DrillState } from './drill';
import { conflictingFilters } from './filters';
import type { Dash } from './useDash';

/** Loading, error and offline notes for the master data and every year the filters need (the months not uploaded are in the shell's data status strip). */
export function DashStatus({ dash }: { dash: Dash }) {
  const { st, data } = dash;
  if (st.error || (st.loading && !st.data)) return <DataStatus state={st} onRetry={st.reload} what={t('master data')} />;
  return (
    <>
      <DataStatus state={data.state} onRetry={data.reload} what={t('events')} />
    </>
  );
}


/** On the phone a section folds away under a 48 px heading; on a desktop it is simply shown. */
export function Collapsible({ title, defaultOpen = false, children, testid }: { title: string; defaultOpen?: boolean; children: ReactNode; testid?: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen);
  if (!mobile) return <>{children}</>;
  return (
    <div className="dash-collapse" data-testid={testid}>
      <button type="button" className="dash-collapse-head" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={testid ? `${testid}-toggle` : undefined}>
        <span>{title}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open && <div className="dash-collapse-body">{children}</div>}
    </div>
  );
}

export function NoData({ reason }: { reason: string }) {
  return (
    <div className="callout" role="status" data-testid="no-data">
      <Icon name="info" size={16} />
      <span>{reason}</span>
    </div>
  );
}

/**
 * The filters leave no record in the range: say so plainly, with Reset, instead of showing figures computed from
 * nothing (100% availability, 'no failures'). Names the clash when two chips exclude each other.
 */
export function EmptyScope({ dash }: { dash: Dash }) {
  const clash = conflictingFilters(dash.filters);
  return (
    <div className="card empty-scope" role="status" data-testid="empty-scope">
      <Icon name="filter" size={20} />
      <div>
        <b>{t('No records match these filters')}</b>
        <p className="muted">{clash ? t(clash) : t('Nothing in this range passes every filter. Widen the range or remove a filter.')}</p>
      </div>
      <button type="button" className="btn-primary" onClick={dash.reset} data-testid="empty-scope-reset">{t('Reset filters')}</button>
    </div>
  );
}

/** The one-line takeaway when the filters leave nothing. */
export const EMPTY_SCOPE_TAKEAWAY = 'No records match these filters.';

/**
 * Opens the Event Explorer with these events. The drill carries the chart's window, the page to go back to and the
 * hours the chart counts for exactly these events (in the window, overlapping time once), so the records page can say
 * 'From: Pareto › 141.VL170 · Aug 2026 · 9 events, 15.7 h ✓ matches the bar'.
 */
export function useDrill(dash: Dash, source: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const { ctx } = dash;
  return useCallback(
    (label: string, ids: { eventIds?: string[]; rowIds?: string[] }) => {
      const drill: DrillState = { label, years: dash.years, source, ...ids, back: { pathname: location.pathname, search: location.search } };
      const window = ctx?.win.effective ?? null;
      if (window) {
        drill.range = { from: window.from, to: window.to };
        const iv = rangeToInterval(window);
        let h = 0;
        if (ids.eventIds) {
          const want = new Set(ids.eventIds);
          for (const c of ctx!.scope.chains) if (want.has(c.id)) h += chainHours(c, iv, ctx!.scope.attribution);
        } else if (ids.rowIds) {
          const want = new Set(ids.rowIds);
          for (const r of ctx!.scope.kpiRows) if (want.has(r.event_id) && !r.is_void && !isBlocked(r)) h += attributedHours(r, iv, ctx!.scope.attribution);
        }
        drill.bar = { hours: h };
      }
      navigate('/events', { state: { drill } });
    },
    [navigate, dash.years, source, ctx, location.pathname, location.search],
  );
}

/** Round toggle chips for 2-5 options. */
export function Toggle<T extends string | number>({ value, options, onChange, label, testid }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testid?: string }) {
  return (
    <div className="toggle-group" role="group" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? 'chip chip--on' : 'chip'} aria-pressed={o.value === value} onClick={() => onChange(o.value)} data-testid={testid ? `${testid}-${o.value}` : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The "events in scope" count: rows that pass every filter inside the range. */
export { rowsInRange } from './scope';
