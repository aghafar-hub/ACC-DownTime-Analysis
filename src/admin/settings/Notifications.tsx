import { useMemo, useState } from 'react';
import { api } from '../../api';
import { ChipRow, CountChip } from '../../components/PhoneParts';
import { Icon } from '../../icons';
import { t } from '../../i18n/t';
import { ALERT_TYPE_GROUPS, enabledGroups, serializeAlertTypes, serializeAreas, type Digest } from '../../notifications/prefs';
import { useNotifications } from '../../notifications/NotificationsContext';
import { num } from '../../util/format';
import { useAction } from '../useAction';
import SettingsForm from '../SettingsForm';
import EmailSender from './EmailSender';
import { useSettingsData } from './useSettingsData';
import '../../components/ui.css';
import '../admin.css';

interface Draft { groups: string[]; areas: string[]; digest: Digest }

const DIGESTS: { id: Digest; label: string; help: string }[] = [
  { id: 'none', label: 'No email', help: 'Only the bell inside the app.' },
  { id: 'daily', label: 'Daily', help: 'One email each morning when there is something to say.' },
  { id: 'weekly', label: 'Weekly', help: 'One email on Sunday morning.' },
];

/** Your own alert types, watched areas and digest email. Saved for you only. */
function PersonalBlock({ areas, onSaved }: { areas: string[]; onSaved: (text: string) => void }) {
  const n = useNotifications();
  const stored = useMemo<Draft>(
    () => ({ groups: enabledGroups(n.prefs.alertTypes), areas: n.prefs.watchAreas, digest: n.prefs.digest }),
    [n.prefs],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = draft ?? stored;
  const edit = (patch: Partial<Draft>) => setDraft({ ...view, ...patch });
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const dirty = !same(view.groups, stored.groups) || !same(view.areas, stored.areas) || view.digest !== stored.digest;
  const noTypes = view.groups.length === 0;
  const toggle = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    setShown(true);
    setError(null);
    if (noTypes || !dirty) return;
    const patch: Record<string, string> = {};
    if (!same(view.groups, stored.groups)) patch.alert_types = serializeAlertTypes(view.groups) ?? '';
    if (!same(view.areas, stored.areas)) patch.watch_areas = serializeAreas(view.areas);
    if (view.digest !== stored.digest) patch.digest = view.digest;
    setBusy(true);
    const res = await n.savePrefs(patch);
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      setShown(false);
      onSaved(t('Your notification settings are saved.'));
    } else setError(res.error);
  }

  return (
    <section className="card" data-testid="notif-prefs" aria-labelledby="np-prefs-h">
      <h2 id="np-prefs-h"><Icon name="bell" size={16} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />{t('For you')}</h2>
      <p className="adm-note">{t('These choices are saved for your account only and follow you to every device. Items that need action (records to check, unknown codes, equipment to review) are always shown to people who can fix them.')}</p>
      {!n.loaded && <p className="adm-muted-sm" data-testid="notif-prefs-loading">{t('Loading your settings…')}</p>}
      <fieldset className="np-fieldset" disabled={!n.loaded || busy}>
        <legend>{t('Alerts and updates I want')}</legend>
        <div className="np-checks" data-testid="pref-types">
          {ALERT_TYPE_GROUPS.map((g) => (
            <label key={g.id} className="np-check">
              <input type="checkbox" checked={view.groups.includes(g.id)} onChange={() => edit({ groups: toggle(view.groups, g.id) })} data-testid={`pref-type-${g.id}`} />
              <span><b>{t(g.label)}</b><small>{t(g.help)}</small></span>
            </label>
          ))}
        </div>
        {shown && noTypes && <span className="field-error" role="alert" data-testid="pref-types-error">{t('Keep at least one type switched on.')}</span>}
      </fieldset>
      <fieldset className="np-fieldset" disabled={!n.loaded || busy}>
        <legend>{t('Areas I follow')}</legend>
        <p className="adm-muted-sm">{view.areas.length === 0 ? t('No area chosen: you see alerts for every area.') : t('You see alerts for {n} chosen areas only.', { n: num(view.areas.length) })}</p>
        <ChipRow label={t('Areas I follow')}>
          <CountChip on={view.areas.length === 0} onClick={() => edit({ areas: [] })} testid="pref-area-all">{t('All areas')}</CountChip>
          {areas.map((a) => (
            <CountChip key={a} on={view.areas.includes(a)} onClick={() => edit({ areas: toggle(view.areas, a) })} testid={`pref-area-${a}`}>{a}</CountChip>
          ))}
        </ChipRow>
      </fieldset>
      <fieldset className="np-fieldset" disabled={!n.loaded || busy}>
        <legend>{t('Digest email')}</legend>
        <div className="np-checks" role="radiogroup" aria-label={t('Digest email')} data-testid="pref-digest">
          {DIGESTS.map((d) => (
            <label key={d.id} className="np-check">
              <input type="radio" name="digest" checked={view.digest === d.id} onChange={() => edit({ digest: d.id })} data-testid={`pref-digest-${d.id}`} />
              <span><b>{t(d.label)}</b><small>{t(d.help)}</small></span>
            </label>
          ))}
        </div>
        <p className="adm-muted-sm" data-testid="digest-note">
          {t('Emails are sent from the system account, only to an address on your account, and only once the owner has installed the daily job in the backend. Until then nothing is sent, whatever you choose here.')}
        </p>
      </fieldset>
      {error && <div className="callout callout--danger" role="alert" data-testid="pref-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <div className="np-save">
        <button type="button" className="btn" onClick={() => { setDraft(null); setShown(false); setError(null); }} disabled={!dirty || busy} data-testid="pref-revert">{t('Undo changes')}</button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={!dirty || busy || !n.loaded} data-testid="pref-save">{busy ? t('Saving…') : t('Save my settings')}</button>
      </div>
    </section>
  );
}

/** Administrators: the rule thresholds (Edit on Settings) and "Run checks now". */
function AdminBlock({ onSaved }: { onSaved: (text: string) => void }) {
  const { st, settings } = useSettingsData();
  const n = useNotifications();
  const { run, busy, error } = useAction();
  const [result, setResult] = useState<string | null>(null);
  async function runNow() {
    setResult(null);
    const res = await run((tok) => api.runNotificationChecks(tok));
    if (res.ok) {
      const r = res.value;
      setResult(t('{c} created, {r} resolved', { c: num(r.created), r: num(r.resolved) }) + (r.expired > 0 ? t(', {e} expired', { e: num(r.expired) }) : ''));
      void n.refresh();
    }
  }
  return (
    <div data-testid="notif-admin">
      <h2 className="np-admin-h">{t('For administrators')}</h2>
      <section className="card" aria-label={t('Run checks now')}>
        <p className="adm-note">{t('The checks look at the stored data and raise or close alerts. They run after every upload and once a day; run them now after changing a rule below.')}</p>
        <div className="np-save np-save--start">
          <button type="button" className="btn" onClick={() => void runNow()} disabled={busy} data-testid="run-checks">
            <Icon name="sync" size={14} /> {busy ? t('Running…') : t('Run checks now')}
          </button>
          {result && <span role="status" className="np-result" data-testid="run-checks-result"><span aria-hidden="true">✓ </span>{result}</span>}
        </div>
        {error && <div className="callout callout--danger" role="alert" data-testid="run-checks-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </section>
      {st.startup && <SettingsForm settings={settings} canEdit groupIds={['alert-rules']} onSaved={(text) => { onSaved(text); st.reload(); }} />}
      {st.startup && <EmailSender settings={settings} onSaved={(text) => { onSaved(text); st.reload(); }} />}
    </div>
  );
}

/** Settings > Notifications: your own preferences for everyone; the rule thresholds only with Edit on Settings. */
export default function Notifications() {
  const { st, edit, toastNode, toast } = useSettingsData();
  const areas = useMemo(() => (st.startup?.areas ?? []).filter((a) => a.active !== false).sort((a, b) => a.sort_order - b.sort_order).map((a) => a.area_id), [st.startup]);
  return (
    <div data-testid="settings-notifications">
      <PersonalBlock areas={areas} onSaved={toast} />
      {edit && <AdminBlock onSaved={toast} />}
      {toastNode}
    </div>
  );
}
