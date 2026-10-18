// Inspection phase 2 (phone space): the install line, phone landscape, the report preview and the login keyboard.
import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, stubFonts, watchConsole } from './helpers';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SHOTS = process.env.PHASE2_SHOTS_DIR || '';
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
// once per test: a reload must keep what × stored
const showInstall = (page: Page) => page.addInitScript(() => {
  try { if (!sessionStorage.getItem('p2_reset')) { sessionStorage.setItem('p2_reset', '1'); localStorage.removeItem('acc_dt_install_dismissed'); } } catch { /* ignore */ }
});
const fixedChrome = (page: Page) => page.evaluate(() => {
  const h = (sel: string) => { const e = document.querySelector(sel); if (!e) return 0; const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight ? r.height : 0; };
  return { top: h('.shell-topbar'), scope: h('.scope-slot'), tabs: h('.module-tabs'), bottom: h('.bottom-nav'), install: h('[data-testid=install-banner]'), vh: innerHeight };
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 844 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });

    test('the install line is one thin line, never on "+ New", and × hides it for good', async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await showInstall(page);
      await signInAndWait(page, 'manager');
      await page.goto('/#/actions');
      const banner = page.getByTestId('install-banner');
      await expect(banner).toBeVisible({ timeout: 20000 });
      const b = (await banner.boundingBox())!;
      expect(b.height).toBeLessThanOrEqual(56);
      expect(b.width).toBeGreaterThanOrEqual(width - 1); // docked, full width
      // it sits right on the bottom bar
      const nav = (await page.locator('.bottom-nav').boundingBox())!;
      expect(Math.abs(b.y + b.height - nav.y)).toBeLessThan(2);
      // "+ New" sits above it and a tap reaches it
      const fab = page.getByTestId('new-action');
      await expect(fab).toBeVisible();
      const f = (await fab.boundingBox())!;
      expect(f.y + f.height).toBeLessThanOrEqual(b.y);
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="new-action"]') !== null, { x: f.x + f.width / 2, y: f.y + f.height / 2 })).toBe(true);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await shot(page, `after-${width}-actions-install`);
      await page.getByTestId('install-dismiss').click();
      await expect(banner).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('new-action')).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(500);
      await expect(page.getByTestId('install-banner')).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('the report preview opens with text of at least 12 px; Fit is still one tap away', async ({ page }) => {
      await stubFonts(page);
      await signInAndWait(page, 'manager');
      await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary,daily&v=report');
      await page.locator('[data-testid=report][data-ready=true]').waitFor({ timeout: 60_000 });
      await expect(page.getByTestId('rpt-zoom-fit')).toHaveAttribute('aria-pressed', 'false');
      const px = await page.evaluate(() => {
        const els = [...document.querySelectorAll<HTMLElement>('.rpt-page--section .rpt-pb p, .rpt-page--section .rpt-pb td, .rpt-page--section .rpt-pb li')].slice(0, 200);
        const scale = (e: HTMLElement) => e.getBoundingClientRect().height / e.offsetHeight || 1;
        const v = els.filter((e) => e.offsetHeight > 0).map((e) => parseFloat(getComputedStyle(e).fontSize) * scale(e)).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)] ?? 0;
      });
      expect(px).toBeGreaterThanOrEqual(11.99);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await shot(page, `after-${width}-report`);
      await page.getByTestId('rpt-zoom-fit').tap();
      await expect.poll(async () => (await page.locator('[data-testid=rpt-page]').first().boundingBox())!.width).toBeLessThanOrEqual(width);
    });

    test('sign-in does not open the keyboard by itself', async ({ page }) => {
      await stubFonts(page);
      await page.goto('/');
      await expect(page.getByTestId('login-email')).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
      const submit = (await page.getByTestId('login-submit').boundingBox())!;
      expect(submit.y + submit.height).toBeLessThanOrEqual(844);
    });
  });
}

test.describe('phone landscape 844×390', () => {
  test.use({ viewport: { width: 844, height: 390 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });

  test('the fixed bars take about a quarter of the height; chips and pills scroll away; no install line', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await showInstall(page);
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview');
    await expect(page.getByTestId('hero-kpis')).toBeVisible({ timeout: 20000 });
    await shot(page, 'after-landscape-top');
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    const c = await fixedChrome(page);
    expect(c.scope).toBe(0);
    expect(c.tabs).toBe(0);
    expect(c.install).toBe(0);
    expect((c.top + c.bottom) / c.vh).toBeLessThanOrEqual(0.26);
    // controls stay touch-sized
    for (const sel of ['.bottom-nav-item', '.shell-topbar button']) {
      const hs = await page.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect().height));
      for (const h of hs) expect(h).toBeGreaterThanOrEqual(40);
    }
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    await shot(page, 'after-landscape-scrolled');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('sign-in fits without the keyboard', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await expect(page.getByTestId('login-email')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  });
});

test.describe('tablet 1024', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  test('no install line and nothing cut off', async ({ page }) => {
    await stubFonts(page);
    await showInstall(page);
    await signInAndWait(page, 'engineer');
    await page.goto('/#/actions');
    await page.waitForTimeout(800);
    expect(await page.getByTestId('install-banner').isVisible().catch(() => false)).toBe(false);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    await shot(page, 'after-tablet-actions');
  });
});
