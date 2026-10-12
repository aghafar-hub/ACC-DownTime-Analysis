import { useAuth } from '../auth/AuthContext';
import SettingsForm from '../admin/SettingsForm';
import { useToast } from '../admin/useToast';
import DataNotes from '../components/DataNotes';
import { InstallCard } from '../components/InstallGuide';
import ThemePicker from '../components/ThemePicker';
import { PageHeader, Tile } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { pageById, pageLabel } from '../navigation';
import { useTheme } from '../theme/ThemeContext';
import { whenText } from '../util/format';
import '../components/ui.css';
import '../admin/admin.css';

export default function Settings() {
  const st = useStartup();
  const { canEdit } = useAuth();
  const { themeName } = useTheme();
  const [toastNode, toast] = useToast();
  const settings = st.startup?.settings ?? [];
  const last = settings.map((s) => s.updated_at).filter(Boolean).sort().pop();
  const edit = canEdit('settings');
  return (
    <div className="page" data-testid="page-settings">
      <PageHeader
        title={pageLabel(pageById('settings'))}
        subtitle={st.startup ? t('{n} settings · theme {theme}', { n: settings.length, theme: t(themeName) }) : t('Loading…')}
      />
      <p className="status-line" style={{ marginBottom: 12 }} data-testid="access-level">
        {edit ? t('Your access to this page: can edit.') : t('Your access to this page: view only.')}
      </p>
      <div className="tiles">
        <Tile icon="settings" label={t('Settings on record')} value={st.startup ? settings.length : '-'} testid="fact-settings" />
        <Tile icon="palette" label={t('Theme on this device')} value={t(themeName)} testid="fact-theme" />
        <Tile icon="clock" label={t('Last changed')} value={last ? last.slice(0, 10) : t('never')} sub={last ? whenText(last.replace(' ', 'T')) : undefined} testid="fact-last-changed" />
      </div>
      <DataNotes st={st} />
      <section className="card" data-testid="appearance-section">
        <h2>{t('Appearance')}</h2>
        <p style={{ marginBottom: 12 }}>{t('Pick the theme that suits where you work. It is kept on this device.')}</p>
        <ThemePicker />
      </section>
      <InstallCard />
      {st.startup && (
        <SettingsForm settings={settings} canEdit={edit} onSaved={(text) => { toast(text); st.reload(); }} />
      )}
      {toastNode}
    </div>
  );
}
