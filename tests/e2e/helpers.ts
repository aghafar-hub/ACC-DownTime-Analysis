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

/** Visible controls smaller than 44 px (checkboxes and radios excluded: their label is the target). */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')]
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && (r.height < 43.5 || r.width < 43.5))
      .map(({ el, r }) => `${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
}

/** Every visible text node smaller than 12 px. */
export async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const txt = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!txt || !el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (parseFloat(cs.fontSize) < 12 - 0.01) out.push(`${el.tagName}.${el.className} "${txt.slice(0, 30)}" ${cs.fontSize}`);
    }
    return out;
  });
}

/** Desktop scope bar: open the Period panel and pick a preset (the panel stays open for the year, month or dates). */
export async function pickPeriod(page: Page, preset: string) {
  if ((await page.getByTestId(`fb-preset-${preset}`).count()) === 0) await page.getByTestId('scope-period').click();
  await page.getByTestId(`fb-preset-${preset}`).click();
}

/** Desktop scope bar: open the Type panel (types and the "More filters": classification, criticality, failures, duration ...). */
export async function openType(page: Page) {
  if ((await page.getByTestId('fb-fail').count()) === 0) await page.getByTestId('scope-type').click();
}

/** Close the open scope panel. */
export async function closePanel(page: Page) {
  await page.keyboard.press('Escape');
}

/** The app's latin font faces are loaded (src/fonts.ts preloads them when idle): wait before going offline in a test,
 * where the service worker that keeps them is blocked. */
export async function fontsLoaded(page: Page) {
  await page.waitForFunction(() => [...document.fonts].filter((f) => /U\+0000/i.test(f.unicodeRange)).every((f) => f.status === 'loaded'), undefined, { timeout: 15_000 });
}
