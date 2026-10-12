import DataNotes from '../components/DataNotes';
import { InstallCard } from '../components/InstallGuide';
import PlaceholderPage from '../components/PlaceholderPage';
import ThemePicker from '../components/ThemePicker';
import { Tile } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { useTheme } from '../theme/ThemeContext';
import { whenText } from '../util/format';

export default function Settings() {
  const st = useStartup();
  const { themeName } = useTheme();
  const settings = st.startup?.settings ?? [];
  const last = settings.map((s) => s.updated_at).filter(Boolean).sort().pop();
  return (
    <PlaceholderPage
      tab="settings"
      subtitle={st.startup ? t('{n} settings · theme {theme}', { n: settings.length, theme: t(themeName) }) : t('Loading…')}
      tiles={
        <>
          <Tile icon="settings" label={t('Settings on record')} value={st.startup ? settings.length : '-'} testid="fact-settings" />
          <Tile icon="palette" label={t('Theme on this device')} value={t(themeName)} testid="fact-theme" />
          <Tile icon="clock" label={t('Last changed')} value={last ? last.slice(0, 10) : t('never')} sub={last ? whenText(last.replace(' ', 'T')) : undefined} testid="fact-last-changed" />
        </>
      }
      next={{
        title: t('Rules you can adjust'),
        points: [
          'Availability basis, scheduled hours, the repeat rule, duration bands and the availability target',
          'Sign-in rules: lock-out attempts, lock time, session length and minimum password length',
          'Every change is recorded with who made it and when',
        ],
      }}
    >
      <DataNotes st={st} />
      <section className="card" data-testid="appearance-section">
        <h2>{t('Appearance')}</h2>
        <p style={{ marginBottom: 12 }}>{t('Pick the theme that suits where you work. It is kept on this device.')}</p>
        <ThemePicker />
      </section>
      <InstallCard />
      {settings.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} data-testid="settings-table">
          <h2>{t('Current values')}</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t('Setting')}</th><th>{t('Value')}</th><th>{t('Meaning')}</th></tr></thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.key}>
                    <td className="mono">{s.key}</td>
                    <td className="mono">{s.value || '-'}</td>
                    <td>{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PlaceholderPage>
  );
}
