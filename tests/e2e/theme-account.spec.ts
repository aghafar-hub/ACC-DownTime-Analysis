import { expect, test } from '@playwright/test';
import { PASSWORD, signInAndWait, stubFonts, watchConsole } from './helpers';

// The theme follows the account (backend 1.5.0). Mock mode: the demo API keeps each demo account's saved theme in the
// browser's storage (key acc_dt_mock_account_themes), standing in for the server. A "fresh device" is a new browser
// context that gets only that server-side value, never the first device's own theme (acc_dt_theme).

const THEMES_KEY = 'acc_dt_mock_account_themes';
const html = (p: import('@playwright/test').Page) => p.locator('html');

test('a theme chosen on one device is used when the same person signs in on a fresh device', async ({ page, browser }) => {
  const errors = watchConsole(page);
  await stubFonts(page);
  await signInAndWait(page, 'viewer');
  await page.goto('/#/settings/appearance');
  await expect(page.getByTestId('theme-picker')).toBeVisible();
  await expect(page.getByTestId('settings-appearance')).toContainText('saved with your account');
  await page.getByRole('radio', { name: /Navy Dark/ }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'Navy Dark');
  // saved with the account (the demo API's stand-in for the server)
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) ?? '', THEMES_KEY)).toContain('Navy Dark');
  const server = await page.evaluate((k) => localStorage.getItem(k) ?? '', THEMES_KEY);

  // a fresh device: nothing of the first device's own storage, only what the "server" holds
  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  const freshErrors = watchConsole(fresh);
  await stubFonts(fresh);
  await fresh.addInitScript(([k, v]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(k, v);
      sessionStorage.setItem('seeded', '1');
    }
  }, [THEMES_KEY, server] as const);
  await fresh.goto('/');
  await expect(fresh.getByTestId('login-email')).toBeVisible();
  // the sign-in page uses this device's theme (none yet: the default)
  await expect(html(fresh)).toHaveAttribute('data-theme', 'ACC Light');
  await fresh.getByTestId('login-email').fill('viewer@demo.test');
  await fresh.getByTestId('login-password').fill(PASSWORD);
  await fresh.getByTestId('login-submit').click();
  await expect(fresh.getByTestId('page-title')).toBeVisible();
  // the account's theme wins at sign-in, and this device keeps it as its own fallback
  await expect(html(fresh)).toHaveAttribute('data-theme', 'Navy Dark');
  await expect.poll(() => fresh.evaluate(() => localStorage.getItem('acc_dt_theme'))).toBe('Navy Dark');

  // someone else on that device without a saved theme keeps the device's theme
  await fresh.getByTestId('user-menu-trigger').click();
  await fresh.getByTestId('sign-out').click();
  await expect(fresh.getByTestId('login-email')).toBeVisible();
  await expect(html(fresh)).toHaveAttribute('data-theme', 'Navy Dark');
  await fresh.getByTestId('login-email').fill('engineer@demo.test');
  await fresh.getByTestId('login-password').fill(PASSWORD);
  await fresh.getByTestId('login-submit').click();
  await expect(fresh.getByTestId('page-title')).toBeVisible();
  await expect(html(fresh)).toHaveAttribute('data-theme', 'Navy Dark');

  // a reload with the session kept: the account's theme wins over a device value changed meanwhile
  await page.evaluate(() => localStorage.setItem('acc_dt_theme', 'Warm Paper'));
  await page.reload();
  await expect(page.getByTestId('page-settings')).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'Navy Dark');

  await ctx.close();
  expect(errors, errors.join('\n')).toEqual([]);
  expect(freshErrors, freshErrors.join('\n')).toEqual([]);
});
