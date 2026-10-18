import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { store } from '../storagePrefix';
import { buildStyles, DEFAULT_THEME, resolveThemeName, THEME_NAMES, THEMES, type Tokens } from './themes';
import type { CSSProperties } from 'react';
import { TYPE_DARK, TYPE_LIGHT } from '../charts/palette';

// The five platform themes. The choice is kept on this device under
// `acc_dt_theme` and applied to <body> as CSS custom properties, so the
// shell, the pages and anything drawn on <body> (menus, popups) all follow it.
// Signed in, the account's theme wins (src/theme/accountTheme.tsx, backend 1.5.0);
// this device's value stays as the fallback (sign-in page, offline, older server).
const DARK_THEMES = ['Navy Dark', 'Carbon Dark'];

export type ThemePalette = { name: string; dark: boolean } & Pick<Tokens, 'appBg' | 'sidebarBg' | 'accent'>;
export const THEME_PALETTES: ThemePalette[] = THEME_NAMES.map((name) => ({
  name,
  dark: DARK_THEMES.includes(name),
  appBg: THEMES[name].appBg,
  sidebarBg: THEMES[name].sidebarBg,
  accent: THEMES[name].accent,
}));

function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function themeVars(T: Tokens, dark: boolean): Record<string, string> {
  // A light theme with a dark top bar (High Contrast) needs light text there.
  const topbarInverse = !dark && isDarkColor(T.topbarBg);
  const vars: Record<string, string> = {
    '--shell-bg': T.appBg,
    '--shell-sidebar-bg': T.sidebarBg,
    '--shell-card-bg': T.cardBg,
    '--shell-border': T.border,
    '--shell-text': T.textPrimary,
    '--shell-text-secondary': T.textSecondary,
    '--shell-sidebar-text': T.sidebarText,
    '--shell-sidebar-text-secondary': T.sidebarTextSecondary,
    '--shell-accent': T.accent,
    '--shell-accent-text': T.accentText,
    '--shell-brand': T.brand,
    '--shell-brand-text': T.brandText,
    '--shell-brand-soft': T.brandSoft,
    '--shell-brand-ink': T.brandInk,
    // orange on the navy rail (the rail is dark in every theme)
    '--shell-brand-on-dark': '#F6A25A',
    '--shell-text-muted': T.textMuted,
    '--shell-danger': T.danger,
    '--shell-warning': T.warning,
    '--shell-success': T.success,
    '--shell-topbar-bg': T.topbarBg,
    '--shell-topbar-text': topbarInverse ? '#FFFFFF' : T.textPrimary,
    '--shell-topbar-text-secondary': topbarInverse ? '#E0E0E0' : T.textSecondary,
    '--shell-topbar-border': topbarInverse ? '#3A3A3A' : T.border,
    '--shell-topbar-success': topbarInverse ? '#4CC38A' : T.success,
    '--shell-topbar-danger': topbarInverse ? '#FF6B6B' : T.danger,
    '--shell-grid-strength': topbarInverse ? '10%' : '55%',
    // the three stop types (INC, PL, CIR): one colour each on every page, chart, timeline and report
    '--type-inc': (dark ? TYPE_DARK : TYPE_LIGHT).inc,
    '--type-pl': (dark ? TYPE_DARK : TYPE_LIGHT).pl,
    '--type-cir': (dark ? TYPE_DARK : TYPE_LIGHT).cir,
  };
  // every token as --tk-<name> for the page stylesheets
  for (const [k, v] of Object.entries(T)) vars[`--tk${kebab(k).replace(/^-?/, '-')}`] = v;
  return vars;
}

type ThemeCtx = {
  themeName: string;
  T: Tokens;
  s: Record<string, CSSProperties>;
  dark: boolean;
  setThemeName: (name: string) => void;
};
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setName] = useState(() => resolveThemeName(store.get('theme')));
  const T = THEMES[themeName] ?? THEMES[DEFAULT_THEME];
  const dark = DARK_THEMES.includes(themeName);

  const value = useMemo<ThemeCtx>(
    () => ({
      themeName, T, dark, s: buildStyles(T),
      setThemeName: (name: string) => {
        const next = resolveThemeName(name);
        setName(next);
        store.set('theme', next);
      },
    }),
    [themeName, T, dark],
  );

  useEffect(() => {
    const vars = themeVars(T, dark);
    const style = document.body.style;
    for (const [k, v] of Object.entries(vars)) style.setProperty(k, v);
    document.documentElement.dataset.theme = themeName;
    // the phone's status bar follows the top bar's colour
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', T.topbarBg);
  }, [T, dark, themeName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
