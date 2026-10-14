import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { THEME_NAMES } from './themes';
import { useTheme } from './ThemeContext';

// The theme follows the person (backend 1.5.0): the choice is saved with the account (preference `theme`) and sent back
// at sign-in and with every access refresh (getMyAccess). The account's theme wins whenever it arrives or changes; the
// device's own choice (ThemeContext, `acc_dt_theme`) stays as the fallback: on the sign-in page, offline, and against an
// older server, which refuses the unknown preference (the choice then simply stays on this device, without a message).

/** Applies the account's theme when the person signs in, the app opens with a kept session, or it changes elsewhere. */
export function AccountThemeSync(): null {
  const { token, accountTheme } = useAuth();
  const { themeName, setThemeName } = useTheme();
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!token) {
      applied.current = null;
      return;
    }
    if (!accountTheme || !THEME_NAMES.includes(accountTheme) || accountTheme === applied.current) return;
    applied.current = accountTheme;
    if (accountTheme !== themeName) setThemeName(accountTheme);
    // only a new account value applies; the person's own clicks change themeName and must not be undone here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, accountTheme]);
  return null;
}

/** Picks a theme: at once on this device, then saved with the account when signed in (silently device-only when refused). */
export function useChooseTheme(): (name: string) => void {
  const { token, setAccountTheme } = useAuth();
  const { setThemeName } = useTheme();
  return useCallback(
    (name: string) => {
      setThemeName(name);
      if (!token || !THEME_NAMES.includes(name)) return;
      api.saveNotificationPrefs(token, { theme: name }).then(
        () => setAccountTheme(name),
        () => { /* an older server (unknown preference) or offline: the choice stays on this device */ },
      );
    },
    [token, setThemeName, setAccountTheme],
  );
}
