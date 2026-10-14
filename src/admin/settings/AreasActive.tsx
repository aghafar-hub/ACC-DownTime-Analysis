import { useMemo, useState } from 'react';
import { api } from '../../api';
import type { Area } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import DataNotes from '../../components/DataNotes';
import { startupResource } from '../../data/stores';
import { useStartup } from '../../data/useStartup';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import ConfirmDialog from '../ConfirmDialog';
import { useAction } from '../useAction';
import { useToast } from '../useToast';
import '../../components/ui.css';
import '../admin.css';
import '../../actions/actions.css';

/**
 * Settings > Areas (Admin only, backend 1.5.0): switch an area on or off for the whole plant. It writes `areas.active`,
 * the same flag the master data has always called "Shown in the app": an inactive area is not offered in any list, and
 * src/data/activeAreas.ts leaves its records out of every number, chart, table, export, report, the Validate list and
 * the alerts. The records stay stored; switching the area on again brings everything back.
 */
export default function AreasActive() {
  const st = useStartup();
  const { user } = useAuth();
  const admin = user?.role_id === 'ROLE-ADMIN';
  const { run, busy, error } = useAction();
  const [toastNode, toast] = useToast();
  const [confirm, setConfirm] = useState<Area | null>(null);
  const startup = st.startup;
  const lineName = useMemo(() => new Map((startup?.lines ?? []).map((l) => [l.line_id, l.name])), [startup]);
  const list = useMemo(
    () => [...(startup?.areas ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.area_id.localeCompare(b.area_id)),
    [startup],
  );
  const off = list.filter((a) => !a.active);

  async function apply(area: Area, active: boolean) {
    const res = await run((tok) => api.setAreaActive(tok, area.area_id, active));
    if (!res.ok) return;
    // every page follows at once; the reload confirms what the server stored
    startupResource.patch((d) => ({ ...d, areas: d.areas.map((a) => (a.area_id === res.value.area_id ? { ...a, active: res.value.active } : a)) }));
    toast(active ? t('{id} is active again. Its records are back in every number.', { id: area.area_id }) : t('{id} is inactive. Its records are left out everywhere.', { id: area.area_id }));
    st.reload();
  }
  const onToggle = (area: Area, next: boolean) => {
    if (!next) setConfirm(area);
    else void apply(area, true);
  };

  return (
    <div data-testid="settings-areas">
      <DataNotes st={st} />
      <section className="card" data-testid="areas-active-section">
        <h2>{t('Active areas')}</h2>
        <p className="adm-note">
          {t('Switch off an area that should not count for now, for example one that is not running yet or is being rebuilt. For everyone in the plant, an inactive area is left out of every number, chart, table, report, export, the Validate list and the alerts, as if its records did not exist. Its records stay stored: switch it on again and everything comes back. Existing actions of the area stay on the Actions page, marked; no new drafts are made for it.')}
        </p>
        {off.length > 0 && (
          <p className="callout" role="note" data-testid="areas-inactive-summary">
            <Icon name="info" size={15} /> {t('Inactive now: {list}.', { list: off.map((a) => a.area_id).join(', ') })}
          </p>
        )}
        {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
        {!admin && <p className="adm-note" data-testid="areas-readonly">{t('Only an Admin can switch areas on or off.')}</p>}
        <div className="table-wrap">
          <table className="data-table" data-testid="areas-active-table">
            <thead>
              <tr><th scope="col">{t('Area')}</th><th scope="col">{t('Name')}</th><th scope="col">{t('Line')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Active')}</th></tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.area_id} data-testid="area-active-row" data-area={a.area_id} data-active={a.active ? 'true' : 'false'}>
                  <td className="nowrap mono">{a.area_id}</td>
                  <td>{a.name}{!a.in_downtime_sheet && <div className="muted" style={{ fontSize: 12 }}>{t('Not in the downtime sheet')}</div>}</td>
                  <td>{lineName.get(a.line_id) ?? a.line_id}</td>
                  <td>
                    {a.active
                      ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span>
                      : <span className="badge"><span aria-hidden="true">⊘</span> {t('Inactive')}</span>}
                  </td>
                  <td>
                    <label className="act-switch">
                      <input type="checkbox" role="switch" checked={a.active} disabled={!admin || busy} onChange={(e) => onToggle(a, e.target.checked)}
                        aria-label={t('{id} active', { id: a.area_id })} data-testid="area-active-switch" />
                      <span className="act-switch-ui" aria-hidden="true" />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {confirm && (
        <ConfirmDialog title={t('Switch off {id}?', { id: confirm.area_id })} danger confirmLabel={t('Switch off')} busy={busy}
          onCancel={() => setConfirm(null)} onConfirm={() => { const a = confirm; setConfirm(null); void apply(a, false); }}>
          {t('For everyone, {id} and all its records are left out of every number, chart, list, report and alert until it is switched on again. Nothing is deleted.', { id: confirm.area_id })}
        </ConfirmDialog>
      )}
      {toastNode}
    </div>
  );
}
