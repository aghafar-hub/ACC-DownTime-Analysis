import { InstallCard } from '../../components/InstallGuide';
import ThemePicker from '../../components/ThemePicker';
import { t } from '../../i18n/t';
import { useTheme } from '../../theme/ThemeContext';
import AppVersionCard from '../../update/AppVersionCard';
import '../../components/ui.css';
import '../admin.css';

/** Settings > Appearance: the theme picker, the install card and the app version. Everyone sees it, whatever their role. */
export default function Appearance() {
  const { themeName } = useTheme();
  return (
    <div data-testid="settings-appearance">
      <section className="card" data-testid="appearance-section">
        <h2>{t('Appearance')}</h2>
        <p style={{ marginBottom: 12 }}>{t('Pick the theme that suits where you work. It is saved with your account, so it follows you to every device you sign in on.')} <span data-testid="fact-theme">{t('In use: {name}.', { name: t(themeName) })}</span></p>
        <ThemePicker />
      </section>
      <InstallCard />
      <AppVersionCard />
    </div>
  );
}
