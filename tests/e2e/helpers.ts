import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Demo-Pass-1234';
export type Role = 'admin' | 'manager' | 'engineer' | 'viewer';

/** Fonts come from Google Fonts: answer with empty files so offline test runs stay free of network errors. */
export async function stubFonts(page: Page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: route.request().url().includes('googleapis') ? 'text/css' : 'font/woff2', body: '' }),
  );
}

/** Collects console errors and uncaught exceptions. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

export async function setTheme(page: Page, theme: string) {
  await page.addInitScript((name) => {
    try {
      localStorage.setItem('acc_dt_theme', name);
    } catch {
      /* ignore */
    }
  }, theme);
}

export async function signIn(page: Page, role: Role | string, password = PASSWORD) {
  await page.goto('/');
  await page.getByTestId('login-email').fill(role.includes('@') ? role : `${role}@demo.test`);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function signInAndWait(page: Page, role: Role) {
  await signIn(page, role);
  await expect(page.getByTestId('page-title')).toBeVisible();
}

export async function noSidewaysScroll(page: Page): Promise<{ scrollWidth: number; innerWidth: number; ok: boolean }> {
  return page.evaluate(() => {
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return { scrollWidth, innerWidth: window.innerWidth, ok: scrollWidth <= window.innerWidth };
  });
}
