import { useMemo, useState, type ReactNode } from 'react';
import { tsText } from '../util/dates';
import { api } from '../api';
import type { Setting } from '../api/types';
import { ChipRow, CountChip } from '../components/PhoneParts';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useAuth } from '../auth/AuthContext';
import { useAction } from './useAction';
import { BASIS_FORMULA, changedSettings, groups, SETTING_FALLBACKS, validateSettings, WHEN_TEXT, type Field } from './settingsSchema';
import './admin.css';

/** The editable settings. Saved together with one call: all or nothing. */
export default function SettingsForm({ settings, canEdit, onSaved, groupIds, badge, hideKeys }: {
  settings: Setting[]; canEdit: boolean; onSaved: (text: string) => void; groupIds?: string[];
  /** fields edited elsewhere on the page (e.g. the closers people picker) */
  hideKeys?: string[];
  /** shown at the end of the summary line (the View only badge) */
  badge?: ReactNode;
}) {
  const stored = useMemo(() => ({ ...SETTING_FALLBACKS, ...Object.fromEntries(settings.map((s) => [s.key, s.value])) }) as Record<string, string>, [settings]);
  const meta = useMemo(() => new Map(settings.map((s) => [s.key, s])), [settings]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(false);
  const { run, busy, error } = useAction();
  const { user } = useAuth();
  const who = (id?: string): string => (id && id === user?.user_id ? t('You') : id || '-');
  const values = { ...stored, ...draft };
  const problems = validateSettings(values);
  const changes = changedSettings(stored, values);
  const dirty = Object.keys(changes).length;
  const last = settings.filter((s) => s.updated_at).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setShown(true);
    if (Object.keys(problems).length || dirty === 0) return;
    const res = await run((tok) => api.saveSettings(tok, changes));
    if (res.ok) {
      setDraft({});
      setShown(false);
      onSaved(t('Settings saved.'));
    }
  }

  const control = (f: Field) => {
    const bad = shown && problems[f.key];
    if (f.kind === 'choice') {
      return (
        <div className="field" key={f.key}>
          <span className="field-label" id={`lbl-${f.key}`}>{f.label}</span>
          <ChipRow label={f.label}>
            {f.options.map((o) => <CountChip key={o.value} on={values[f.key] === o.value} onClick={() => set(f.key, o.value)} testid={`${f.key}-${o.value}`}>{o.label}</CountChip>)}
          </ChipRow>
          {f.key === 'availability_basis' && <span className="field-hint" data-testid="basis-formula">{t(BASIS_FORMULA[values[f.key] ?? 'B'] ?? '')}</span>}
          <span className="field-hint">{f.help}</span>
        </div>
      );
    }
    const m = meta.get(f.key);
    if (f.kind === 'text') {
      return (
        <div className={bad ? 'field field--error span-2' : 'field span-2'} key={f.key}>
          <label htmlFor={`set-${f.key}`}>{f.label}</label>
          <input id={`set-${f.key}`} className="input mono" type="url" inputMode="url" autoComplete="off" placeholder={f.placeholder} maxLength={f.maxLength + 20} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} data-testid={`set-${f.key}`} aria-describedby={`help-${f.key}`} />
          <span className="field-hint" id={`help-${f.key}`}>{f.help}</span>
          {bad && <span className="field-error" role="alert" data-testid={`error-${f.key}`}>{problems[f.key]}</span>}
          {m?.updated_at && <span className="field-hint">{t('Changed {when}{who}', { when: tsText(m.updated_at), who: m.updated_by ? ` · ${who(m.updated_by)}` : '' })}</span>}
        </div>
      );
    }
    return (
      <div className={bad ? 'field field--error' : 'field'} key={f.key}>
        <label htmlFor={`set-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</label>
        <input id={`set-${f.key}`} className="input mono" inputMode="decimal" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} data-testid={`set-${f.key}`} aria-describedby={`help-${f.key}`} />
        <span className="field-hint" id={`help-${f.key}`}>{f.help}</span>
        {bad && <span className="field-error" role="alert" data-testid={`error-${f.key}`}>{problems[f.key]}</span>}
        {m?.updated_at && <span className="field-hint">{t('Changed {when}{who}', { when: tsText(m.updated_at), who: m.updated_by ? ` · ${who(m.updated_by)}` : '' })}</span>}
      </div>
    );
  };

  return (
    <div data-testid="settings-form">
      <p className="status-line set-summary" data-testid="settings-summary">
        <Icon name="clock" size={14} />
        <span data-testid="last-changed">
          {last ? t('Last changed {when} by {who}.', { when: tsText(String(last.updated_at)), who: who(last.updated_by) }) : t('No setting has been changed yet. These are the starting values.')}
        </span>
        {badge}
      </p>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {shown && Object.keys(problems).length > 0 && <div className="callout callout--warning" role="alert" data-testid="settings-problems"><Icon name="alert" size={16} /><span>{t('Fix the marked settings first. Nothing was saved.')}</span></div>}
      {groups().filter((g) => !groupIds || groupIds.includes(g.id)).map((g) => (
        <section className="card" key={g.id} data-testid={`settings-${g.id}`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}><Icon name={g.icon} size={16} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />{g.title}</h2>
            <span className={g.when === 'now' ? 'badge badge--success' : 'badge badge--info'} data-testid={`when-${g.id}`}><span aria-hidden="true">{g.when === 'now' ? '●' : '◷'}</span> {t(WHEN_TEXT[g.when].badge)}</span>
          </div>
          <p className="adm-note">{g.intro} {t(WHEN_TEXT[g.when].detail)}</p>
          <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="form-grid">{g.fields.filter((f) => !hideKeys?.includes(f.key)).map(control)}</div>
          </fieldset>
        </section>
      ))}
      {canEdit && (
        <div className="adm-actionbar" data-testid="settings-bar">
          <div className="adm-actionbar-text" role="status">{dirty === 0 ? t('No changes yet.') : <><span aria-hidden="true">▲ </span>{t('{n} unsaved', { n: dirty })}</>}</div>
          <div className="adm-actionbar-buttons">
            <button type="button" className="btn" onClick={() => { setDraft({}); setShown(false); }} disabled={dirty === 0 || busy} data-testid="settings-revert">{t('Undo changes')}</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={dirty === 0 || busy} data-testid="settings-save">{busy ? t('Saving…') : t('Save settings')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
