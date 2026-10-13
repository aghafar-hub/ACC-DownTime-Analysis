import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallTargets, stubFonts, watchConsole } from './helpers';

// "A new version is available" banner and the Settings > Appearance version block.
// Playwright cannot run a real service worker (serviceWorkers are blocked), so the
// demo build's test hook window.__accTestUpdate flips the same state as onNeedRefresh.

const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const SHOTS = process.env.UPDATE_SHOTS_DIR || '';

const banner = (page: Page) => page.getByTestId('update-banner');
const flip = (page: Page) => page.evaluate(() => window.__accTestUpdate?.());

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** WCAG contrast ratio of the banner's text and of each button against what is behind it. */
async function bannerContrasts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: string, b: string) => {
      const la = lum(parse(a));
      const lb = lum(parse(b));
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const bar = document.querySelector<HTMLElement>('[data-testid=update-banner]')!;
    const barBg = getComputedStyle(bar).backgroundColor;
    const reload = getComputedStyle(document.querySelector('[data-testid=update-reload]')!);
    const later = getComputedStyle(document.querySelector('[data-testid=update-later]')!);
    return {
      text: ratio(getComputedStyle(bar).color, barBg),
      reload: ratio(reload.color, reload.backgroundColor),
      later: ratio(later.color, barBg),
    };
  });
}

async function layoutChecks(page: Page, inShell: boolean) {
  const b = await banner(page).boundingBox();
  expect(b).not.toBeNull();
  const vw = page.viewportSize()!.width;
  expect(b!.y).toBeLessThanOrEqual(0.5); // at the very top
  expect(Math.round(b!.width)).toBe(vw); // full width
  const sw = await noSidewaysScroll(page);
  expect(sw.ok, `scrollWidth ${sw.scrollWidth} > ${sw.innerWidth}`).toBe(true);
  for (const id of ['update-reload', 'update-later']) {
    const r = (await page.getByTestId(id).boundingBox())!;
    expect(r.height, id).toBeGreaterThanOrEqual(43.5);
    expect(r.width, id).toBeGreaterThanOrEqual(43.5);
    expect(r.x, id).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width, id).toBeLessThanOrEqual(vw + 0.5);
  }
  const small = await banner(page).evaluate((el) => {
    const out: string[] = [];
    el.querySelectorAll('b, span, button').forEach((n) => {
      if (parseFloat(getComputedStyle(n).fontSize) < 12) out.push(n.tagName);
    });
    return out;
  });
  expect(small).toEqual([]);
  expect(await smallTargets(page).then((l) => l.filter((x) => x.includes('update-banner')))).toEqual([]);
  if (inShell) {
    const top = (await page.locator('.shell-topbar').boundingBox())!;
    expect(top.y).toBeGreaterThanOrEqual(b!.y + b!.height - 1); // the top bar starts under the banner
    const h = await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--update-banner-h')));
    expect(Math.abs(h - b!.height)).toBeLessThanOrEqual(1);
  }
}

test.describe('login screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shows on the sign-in screen, Later hides it, the event also flips it', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await flip(page);
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('A new version is available.');
    await expect(banner(page)).toContainText('Reload to get the latest improvements.');
    // an announcing region, polite
    const region = page.locator('.update-region');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await layoutChecks(page, false);
    await shot(page, 'login-desktop-acc-light');
    await page.getByTestId('update-later').click();
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByTestId('login-email')).toBeVisible();
    // page load brings it back through the same event path
    await page.evaluate(() => window.dispatchEvent(new Event('acc:update-ready')));
    await expect(banner(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Reload now calls the update function', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __applied: number }).__applied = 0;
      window.__accTestUpdate!.onApply = () => {
        (window as unknown as { __applied: number }).__applied += 1;
      };
    });
    await flip(page);
    await page.getByTestId('update-reload').click();
    expect(await page.evaluate(() => (window as unknown as { __applied: number }).__applied)).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('inside the app', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('desktop: pushes the app down, Later returns on the next check, form-open message', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await signInAndWait(page, 'admin');
    const topBefore = (await page.locator('.shell-topbar').boundingBox())!.y;
    await flip(page);
    await expect(banner(page)).toBeVisible();
    await layoutChecks(page, true);
    expect((await page.locator('.shell-topbar').boundingBox())!.y).toBeGreaterThan(topBefore);
    // the top bar stays below the banner after scrolling
    await page.evaluate(() => window.scrollTo(0, 400));
    const b = (await banner(page).boundingBox())!;
    const tb = (await page.locator('.shell-topbar').boundingBox())!;
    expect(tb.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'shell-desktop-acc-light');

    // a form / popup is open
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'fake-dialog';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      document.body.appendChild(d);
    });
    await expect(page.getByTestId('update-banner-reason')).toHaveText('Finish what you are doing, then reload.', { timeout: 5000 });
    await page.evaluate(() => {
      (window as unknown as { __applied: number }).__applied = 0;
      window.__accTestUpdate!.onApply = () => {
        (window as unknown as { __applied: number }).__applied += 1;
      };
    });
    await page.getByTestId('update-reload').click(); // still works, no confirm dialog
    expect(await page.evaluate(() => (window as unknown as { __applied: number }).__applied)).toBe(1);
    await page.evaluate(() => document.getElementById('fake-dialog')?.remove());
    await expect(page.getByTestId('update-banner-reason')).toHaveText('Reload to get the latest improvements.', { timeout: 5000 });

    // Later hides it; the next check cycle (here the Settings button) brings it back
    await page.getByTestId('update-later').click();
    await expect(banner(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--update-banner-h'))).toBe('');
    await page.goto('/#/settings/appearance');
    await expect(page.getByTestId('app-version')).toBeVisible();
    await expect(page.getByTestId('update-status')).toHaveText('New version available'); // still said in Settings
    await expect(banner(page)).toHaveCount(0);
    await page.getByTestId('check-updates').click();
    await expect(banner(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const theme of THEMES) {
    test(`contrast and look in ${theme}`, async ({ page }) => {
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await signInAndWait(page, 'admin');
      await flip(page);
      await expect(banner(page)).toBeVisible();
      const c = await bannerContrasts(page);
      expect(c.text, `${theme} text`).toBeGreaterThanOrEqual(4.5);
      expect(c.reload, `${theme} Reload now`).toBeGreaterThanOrEqual(4.5);
      expect(c.later, `${theme} Later`).toBeGreaterThanOrEqual(4.5);
      await shot(page, `shell-desktop-${theme.toLowerCase().replace(/ /g, '-')}`);
      expect(errors).toEqual([]);
    });
  }
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('login screen and shell: no overlap, no sideways scroll, 44 px', async ({ page }) => {
      await stubFonts(page);
      const errors = watchConsole(page);
      await page.goto('/');
      await expect(page.getByTestId('login-email')).toBeVisible();
      await flip(page);
      await expect(banner(page)).toBeVisible();
      await layoutChecks(page, false);
      await shot(page, `login-phone-${width}-acc-light`);
      await page.getByTestId('login-email').fill('admin@demo.test');
      await page.getByTestId('login-password').fill('Demo-Pass-1234');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('page-title')).toBeVisible();
      await expect(banner(page)).toBeVisible(); // survives the sign-in
      await layoutChecks(page, true);
      // the bottom bar stays reachable and the banner stays on top
      await expect(page.locator('.bottom-nav')).toBeVisible();
      await shot(page, `shell-phone-${width}-acc-light`);
      await page.getByTestId('update-later').click();
      await expect(banner(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('phone Carbon Dark', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('login and shell', async ({ page }) => {
    await stubFonts(page);
    await setTheme(page, 'Carbon Dark');
    await page.goto('/');
    await flip(page);
    await expect(banner(page)).toBeVisible();
    await shot(page, 'login-phone-390-carbon-dark');
    await page.getByTestId('login-email').fill('admin@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await layoutChecks(page, true);
    await shot(page, 'shell-phone-390-carbon-dark');
  });
});

test.describe('Settings > Appearance version block', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('shows the build, the status, and the check button states', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await signInAndWait(page, 'viewer');
    await page.goto('/#/settings/appearance');
    const card = page.getByTestId('app-version');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('app-build')).toHaveText(/^([0-9a-f]{4,40}|dev)$/);
    const btn = page.getByTestId('check-updates');
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByTestId('settings-reload')).toHaveCount(0);

    // no service worker in this browser: say so, never "Up to date"
    await btn.click();
    await expect(page.getByTestId('update-status')).toHaveText(/not available/);

    // up to date
    await page.evaluate(() => { window.__accTestUpdate!.onCheck = async () => 'none'; });
    await btn.click();
    await expect(page.getByTestId('update-status')).toHaveText('Up to date');

    // error (offline)
    await page.evaluate(() => { window.__accTestUpdate!.onCheck = async () => 'error'; });
    await btn.click();
    await expect(page.getByTestId('update-status')).toHaveText(/Could not check/);

    // checking... then found
    await page.evaluate(() => {
      window.__accTestUpdate!.onCheck = () => new Promise((res) => {
        (window as unknown as { __finish: () => void }).__finish = () => res('found');
      });
    });
    await btn.click();
    await expect(page.getByTestId('update-status')).toHaveText('Checking…');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Checking…');
    await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
    await expect(page.getByTestId('update-status')).toHaveText('New version available');
    await expect(banner(page)).toBeVisible();
    const reload = page.getByTestId('settings-reload');
    await expect(reload).toBeVisible();
    expect((await reload.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.getByTestId('update-later').click();
    await shot(page, 'appearance-version-desktop');
    await page.evaluate(() => {
      (window as unknown as { __applied: number }).__applied = 0;
      window.__accTestUpdate!.onApply = () => { (window as unknown as { __applied: number }).__applied += 1; };
    });
    await reload.click();
    expect(await page.evaluate(() => (window as unknown as { __applied: number }).__applied)).toBe(1);
    expect(errors).toEqual([]);
  });
});
