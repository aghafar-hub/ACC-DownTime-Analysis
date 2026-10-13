import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import DataStatus from '../components/DataStatus';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import type { DrillState } from './drill';
import { conflictingFilters } from './filters';
import type { Dash } from './useDash';

/** Loading, error and offline notes for the master data and every year the filters need. */
export function DashStatus({ dash }: { dash: Dash }) {
  const { st, data } = dash;
  if (st.error || (st.loading && !st.data)) return <DataStatus state={st} onRetry={st.reload} what={t('master data')} />;
  return (
    <>
      <DataStatus state={data.state} onRetry={data.reload} what={t('events')} />
      <NotUploadedLine dash={dash} />
    </>
  );
}

const MONTH3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (m: string): string => `${MONTH3[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;

/** P6: the data status line names the months inside the data that have no record at all (information, never 0 h or 100 %). */
export function NotUploadedLine({ dash }: { dash: Dash }) {
  const ctx = dash.ctx;
  if (!ctx || !ctx.coverage || ctx.notUploaded.length === 0) return null;
  return (
    <p className="status-line" role="note" data-testid="data-status-not-uploaded">
      <Icon name="info" size={14} />{' '}
      {t('Data {a} to {b}. Not uploaded (no records at all): {m}. These months are left out of the numbers, never shown as 0 h or 100%.', {
        a: ctx.coverage.from, b: ctx.coverage.to, m: ctx.notUploaded.map(monthText).join(', '),
      })}
    </p>
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

/** Opens the Event Explorer with these events. */
export function useDrill(dash: Dash, source: string) {
  const navigate = useNavigate();
  return useCallback(
    (label: string, ids: { eventIds?: string[]; rowIds?: string[] }) => {
      const drill: DrillState = { label, years: dash.years, source, ...ids };
      navigate('/events', { state: { drill } });
    },
    [navigate, dash.years, source],
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
