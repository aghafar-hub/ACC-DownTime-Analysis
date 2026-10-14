import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError } from '../../api';
import { AUDIT_GROUPS, type AuditEntry, type AuditFilter, type AuditGroup } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { CSV_MIME, toCsv } from '../../export/csv';
import { deliveredText, deliverFile } from '../../export/deliverFile';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { tsText } from '../../util/dates';
import { num } from '../../util/format';
import { actorName, auditGroupLabel, auditSentence } from './activityText';
import '../../components/ui.css';
import '../admin.css';
import './activity.css';

const PAGE_SIZE = 100;
const EXPORT_PAGE = 200;
const EXPORT_MAX = 20_000;

interface Filters { user: string; group: '' | AuditGroup; from: string; to: string; q: string }
const EMPTY: Filters = { user: '', group: '', from: '', to: '', q: '' };

function toApi(f: Filters, limit: number): AuditFilter {
  const out: AuditFilter = { limit };
  if (f.user) out.user_id = f.user;
  if (f.group) out.group = f.group;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}

/**
 * Settings > Activity log (Admin only, backend 1.6.0): every change made in the app, newest first, in plain words.
 * The server filters and pages the audit log (100 at a time, "Load more"); the CSV holds every change that matches.
 */
export default function ActivityLog() {
  const { token } = useAuth();
  const mobile = useIsMobile();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [query, setQuery] = useState<Filters>(EMPTY); // the filters in force (the search box waits for a pause in typing)
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const seq = useRef(0);

  // typing in the search box waits 300 ms; the other filters apply at once
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(filters), filters.q === query.q ? 0 : 300);
    return () => window.clearTimeout(id);
  }, [filters, query.q]);

  const fetchPage = useCallback((f: Filters, from: string | null) => {
    if (!token) return;
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    api.listAuditLog(token, toApi(f, PAGE_SIZE), from).then(
      (page) => {
        if (my !== seq.current) return;
        setNames(new Map(page.users.map((u) => [u.user_id, u.display_name])));
        setEntries((cur) => (from ? [...cur, ...page.entries] : page.entries));
        setCursor(page.next_cursor);
        setLoading(false);
        setLoaded(true);
      },
      (e) => {
        if (my !== seq.current) return;
        setError(describeError(e));
        setLoading(false);
      },
    );
  }, [token]);

  useEffect(() => {
    if (query.from && query.to && query.from > query.to) { seq.current++; setEntries([]); setCursor(null); return; }
    fetchPage(query, null);
  }, [query, fetchPage]);

  const name = useCallback((id: string) => actorName(id, names), [names]);
  const people = useMemo(() => [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])), [names]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const rangeBad = !!(filters.from && filters.to && filters.from > filters.to);

  async function exportCsv() {
    if (!token) return;
    setExporting(true);
    setExportNote('');
    try {
      const all: AuditEntry[] = [];
      let next: string | null = null;
      do {
        const page = await api.listAuditLog(token, toApi(query, EXPORT_PAGE), next);
        all.push(...page.entries);
        next = page.next_cursor;
      } while (next && all.length < EXPORT_MAX);
      const rows = [
        [t('When'), t('Who'), t('User id'), t('Kind of change'), t('What happened'), t('Action'), t('Record'), t('Record id'), t('Detail')],
        ...all.map((e) => [e.at, name(e.user_id), e.user_id, auditGroupLabel(e.group), auditSentence(e, name), e.action, e.entity, e.entity_id, e.detail]),
      ];
      const fileName = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      const r = await deliverFile(fileName, toCsv(rows), CSV_MIME);
      setExportNote(deliveredText(r, t('{name} downloaded: {n} changes.', { name: fileName, n: num(all.length) }), fileName));
    } catch (e) {
      setExportNote(describeError(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div data-testid="settings-activity-log">
      <section className="card al-filters" aria-label={t('Filters')}>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="al-user">{t('Who')}</label>
            <select id="al-user" className="select" value={filters.user} onChange={(e) => set({ user: e.target.value })} data-testid="al-user">
              <option value="">{t('Everyone')}</option>
              {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              <option value="system">{t('System (automatic)')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="al-group">{t('Kind of change')}</label>
            <select id="al-group" className="select" value={filters.group} onChange={(e) => set({ group: e.target.value as Filters['group'] })} data-testid="al-group">
              <option value="">{t('All kinds')}</option>
              {AUDIT_GROUPS.map((g) => <option key={g} value={g}>{auditGroupLabel(g)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="al-from">{t('From')}</label>
            <input id="al-from" type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="al-from" />
          </div>
          <div className="field">
            <label htmlFor="al-to">{t('To')}</label>
            <input id="al-to" type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="al-to" />
          </div>
          <div className="field al-search">
            <label htmlFor="al-q">{t('Search')}</label>
            <input id="al-q" type="search" className="input" value={filters.q} placeholder={t('Name, record, setting, file…')} maxLength={100}
              onChange={(e) => set({ q: e.target.value })} data-testid="al-q" />
          </div>
        </div>
        <div className="al-bar">
          <p className="status-line al-count" data-testid="al-count" aria-live="polite">
            {!loaded && loading ? t('Loading…')
              : rangeBad ? t('The start date is after the end date.')
                : entries.length === 0 ? (filtered ? t('No change matches these filters.') : t('No changes logged yet.'))
                  : cursor ? t('Showing the newest {n} changes. Older ones: Load more.', { n: num(entries.length) })
                    : t('{n} changes', { n: num(entries.length) })}
          </p>
          <div className="al-buttons">
            {filtered && <button type="button" className="btn btn-sm" onClick={() => setFilters(EMPTY)} data-testid="al-clear"><Icon name="reset" size={15} /> {t('Clear filters')}</button>}
            <button type="button" className="btn btn-sm" onClick={() => void exportCsv()} disabled={exporting || entries.length === 0} data-testid="al-export">
              <Icon name="download" size={15} /> {exporting ? t('Preparing…') : t('Export CSV')}
            </button>
          </div>
        </div>
        {exportNote && <p className="status-line" role="status" data-testid="al-export-note">{exportNote}</p>}
      </section>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span><button type="button" className="btn btn-sm" onClick={() => fetchPage(query, null)}>{t('Try again')}</button></div>}

      {entries.length > 0 && !mobile && (
        <div className="table-wrap" data-testid="al-table">
          <table className="data-table">
            <thead><tr><th scope="col">{t('When')}</th><th scope="col">{t('Who')}</th><th scope="col">{t('Kind')}</th><th scope="col">{t('What happened')}</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} data-testid="al-row" data-action={e.action} data-group={e.group} data-user={e.user_id}>
                  <td className="mono nowrap">{tsText(e.at)}</td>
                  <td className="nowrap">{name(e.user_id)}</td>
                  <td className="nowrap"><span className="badge al-kind">{auditGroupLabel(e.group)}</span></td>
                  <td className="al-what" data-testid="al-what">{auditSentence(e, name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length > 0 && mobile && (
        <div className="adm-cards" data-testid="al-cards">
          {entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className="adm-card" data-testid="al-row" data-action={e.action} data-group={e.group} data-user={e.user_id}>
              <div className="adm-card-top">
                <span className="adm-card-title" style={{ fontFamily: 'var(--sans)' }}>{name(e.user_id)}</span>
                <span className="badge al-kind">{auditGroupLabel(e.group)}</span>
              </div>
              <div className="al-what" data-testid="al-what">{auditSentence(e, name)}</div>
              <div className="adm-card-line mono">{tsText(e.at)}</div>
            </div>
          ))}
        </div>
      )}
      {cursor && (
        <div className="al-more">
          <button type="button" className="btn" onClick={() => fetchPage(query, cursor)} disabled={loading} data-testid="al-more">
            {loading ? t('Loading…') : t('Load more')}
          </button>
        </div>
      )}
    </div>
  );
}
