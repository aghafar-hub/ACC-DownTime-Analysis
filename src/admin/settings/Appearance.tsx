import { InstallCard } from '../../components/InstallGuide';
import ThemePicker from '../../components/ThemePicker';
import { Tile } from '../../components/Tile';
import { t } from '../../i18n/t';
import { useTheme } from '../../theme/ThemeContext';
import '../../components/ui.css';
import '../admin.css';

/** Settings > Appearance: the theme picker and the install card. Everyone sees it, whatever their role. */
export default function Appearance() {
  const { themeName } = useTheme();
  return (
    <div data-testid="settings-appearance">
      <div className="tiles">
        <Tile icon="palette" label={t('Theme on this device')} value={t(themeName)} testid="fact-theme" />
      </div>
      <section className="card" data-testid="appearance-section">
        <h2>{t('Appearance')}</h2>
        <p style={{ marginBottom: 12 }}>{t('Pick the theme that suits where you work. It is kept on this device.')}</p>
        <ThemePicker />
      </section>
      <InstallCard />
    </div>
  );
}
