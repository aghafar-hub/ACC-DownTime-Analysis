import { t } from '../i18n/t';
import { THEME_PALETTES, useTheme } from '../theme/ThemeContext';
import './ThemePicker.css';

// What each theme is for, shown under its name so people pick by situation.
const THEME_HINTS: Record<string, string> = {
  'ACC Light': 'Default · offices and everyday use',
  'Warm Paper': 'Softer light · long reading and reports',
  'High Contrast': 'Outdoors in sunlight · dusty screens',
  'Navy Dark': 'Control room · wall screens',
  'Carbon Dark': 'Night shift · easier on phone batteries',
};

/** The five-theme swatch grid. The choice is kept on this device and applies at once. */
export default function ThemePicker() {
  const { themeName, setThemeName } = useTheme();
  return (
    <div className="theme-grid" role="radiogroup" aria-label={t('Theme')} data-testid="theme-picker">
      {THEME_PALETTES.map((theme) => {
        const active = theme.name === themeName;
        return (
          <button
            key={theme.name}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
            onClick={() => setThemeName(theme.name)}
            data-theme-name={theme.name}
          >
            <span className="theme-swatch-preview" style={{ background: theme.appBg, borderColor: active ? theme.accent : 'transparent' }}>
              <span className="theme-swatch-sidebar" style={{ background: theme.sidebarBg }} />
              <span className="theme-swatch-accent" style={{ background: theme.accent }} />
            </span>
            <span className="theme-swatch-label">
              {t(theme.name)}
              {active && <span className="theme-swatch-check" aria-hidden="true">✓</span>}
            </span>
            {THEME_HINTS[theme.name] && <span className="theme-swatch-hint">{t(THEME_HINTS[theme.name])}</span>}
          </button>
        );
      })}
    </div>
  );
}
