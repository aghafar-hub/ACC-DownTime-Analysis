import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

// R4 - phone and PWA: landscape chrome, the one-line update banner, report preview Fit / 100% / zoom, the share
// sheet for files on an iPhone home-screen app, 44 px targets on touch tablets, side safe areas, the sideways
// Pareto on phones with tooltips above the bottom bar, and the offline banner's sync time.

const SHOTS = process.env.R4_SHOTS_DIR || '';
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(350); // let sheets and menus finish opening
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const ready = (page: Page) => page.locator('[data-testid=report][data-ready=true]');
async function openReport(page: Page) {
  await signInAndWait(page, 'manager');
  await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary,daily&v=report');
  await ready(page).waitFor({ timeout: 60_000 });
}
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

let errors: string[];
test.beforeEach(async ({ page }) => {
  await stubFonts(page);
  errors = watchConsole(page);
});
test.afterEach(() => {
  expect(errors, 'console errors').toEqual([]);
});

// ---------------------------------------------------------------- phone, upright
for (const width of [360, 390]) {
  test.describe(`phone ${width} portrait`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

    test('the update banner is one line of at most 48 px; the text truncates, both buttons stay on screen', async ({ page }) => {
      await signInAndWait(page, 'engineer');
      await page.evaluate(() => window.__accTestUpdate?.());
      const banner = page.getByTestId('update-banner');
      await expect(banner).toBeVisible();
      const b = (await banner.boundingBox())!;
      expect(b.height).toBeLessThanOrEqual(48);
      const text = page.locator('.update-banner-text');
      const t = await text.evaluate((el) => ({ ws: getComputedStyle(el).whiteSpace, over: el.scrollWidth > el.clientWidth, h: el.getBoundingClientRect().height }));
      expect(t.ws).toBe('nowrap');
      expect(t.over).toBe(true); // the message is cut with an ellipsis, not wrapped
      for (const id of ['update-reload', 'update-later']) {
        const r = (await page.getByTestId(id).boundingBox())!;
        expect(r.height, id).toBeGreaterThanOrEqual(43.5);
        expect(r.x, id).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width, id).toBeLessThanOrEqual(width + 0.5);
        expect(r.y + r.height, id).toBeLessThanOrEqual(b.y + b.height + 0.5);
      }
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await shot(page, `phone-${width}-update-banner`);
    });

    test('Pareto is drawn sideways (name left, value right) and a tooltip never goes under the bottom bar', async ({ page }) => {
      await signInAndWait(page, 'engineer');
      await page.goto('/#/pareto');
      const card = page.getByTestId('pareto-eq-hours');
      const chart = card.getByTestId('pareto-chart');
      await expect(chart).toHaveAttribute('data-layout', 'rows');
      const bars = card.getByTestId('pareto-bar');
      expect(await bars.count()).toBe(11); // top 10 + Others, as before
      // rows: each hit row is as wide as the chart and the rows stack downwards
      const r0 = (await bars.nth(0).boundingBox())!;
      const r1 = (await bars.nth(1).boundingBox())!;
      expect(r1.y).toBeGreaterThan(r0.y);
      expect(Math.abs(r1.x - r0.x)).toBeLessThan(1);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallText(page)).toEqual([]);
      // bring the last row just above the bottom bar and tap it
      const last = bars.nth(10);
      await last.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-testid=pareto-eq-hours] [data-testid=pareto-bar]');
        const r = rows[rows.length - 1]!.getBoundingClientRect();
        window.scrollBy(0, r.bottom - (window.innerHeight - 70));
      });
      await last.tap();
      const tip = page.getByTestId('chart-tip');
      await expect(tip).toBeVisible();
      await expect(tip.getByTestId('tip-open')).toBeVisible();
      await page.waitForTimeout(100);
      const tb = (await tip.boundingBox())!;
      const nav = await box(page, '.bottom-nav');
      expect(tb.y + tb.height).toBeLessThanOrEqual(nav.y + 0.5);
      expect(tb.x).toBeGreaterThanOrEqual(0);
      expect(tb.x + tb.width).toBeLessThanOrEqual(width + 0.5);
      await shot(page, `phone-${width}-pareto-rows-tip`);
      // the tooltip's button still opens exactly that row's events
      await tip.getByTestId('tip-open').tap();
      await expect(page).toHaveURL(/#\/events/);
    });

    test('offline banner names the time the data was last synced', async ({ page, context }) => {
      await signInAndWait(page, 'engineer');
      await context.setOffline(true);
      const banner = page.getByTestId('offline-banner');
      await expect(banner).toContainText(/Offline · data from \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}\./);
      await expect(banner).toContainText('Uploads and edits need a connection');
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await shot(page, `phone-${width}-offline`);
      await context.setOffline(false);
      await expect(banner).toHaveCount(0);
    });

    test('report preview: Fit fits the screen, 100% is real size scrolling sideways inside the preview only, - / + and pinch zoom there', async ({ page }) => {
      await openReport(page);
      const first = page.locator('[data-testid=rpt-page]').first();
      const scroller = page.getByTestId('rpt-scroll');
      // a phone opens where the text is readable (phase 2); Fit is one tap away
      await expect(page.getByTestId('rpt-zoom-fit')).toHaveAttribute('aria-pressed', 'false');
      await page.getByTestId('rpt-zoom-fit').tap();
      await expect(page.getByTestId('rpt-zoom-fit')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await first.boundingBox())!.width).toBeLessThanOrEqual(width);
      await shot(page, `phone-${width}-report-fit`);

      await page.getByTestId('rpt-zoom-100').tap();
      await expect(page.getByTestId('rpt-zoom-100')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('rpt-zoom-level')).toHaveText('100%');
      await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBe(794);
      const s = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(s.sw).toBeGreaterThan(s.cw); // the preview scrolls sideways ...
      expect((await noSidewaysScroll(page)).ok).toBe(true); // ... the page does not
      await scroller.evaluate((el) => { el.scrollLeft = 200; });
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
      await shot(page, `phone-${width}-report-100`);

      await page.getByTestId('rpt-zoom-in').tap();
      await expect(page.getByTestId('rpt-zoom-level')).toHaveText('125%');
      await page.getByTestId('rpt-zoom-out').tap();
      await page.getByTestId('rpt-zoom-out').tap();
      await expect(page.getByTestId('rpt-zoom-level')).toHaveText('75%');

      // a two-finger pinch inside the preview zooms the pages (the app itself never zooms)
      await page.getByTestId('rpt-zoom-fit').tap();
      const before = Number((await page.getByTestId('rpt-zoom-level').textContent())!.replace('%', ''));
      const sb = (await scroller.boundingBox())!;
      const cy = Math.min(sb.y + 200, 600);
      const cx = sb.x + sb.width / 2;
      const cdp = await page.context().newCDPSession(page);
      const pts = (d: number) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
      for (const d of [60, 80, 100, 120]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => Number((await page.getByTestId('rpt-zoom-level').textContent())!.replace('%', ''))).toBeGreaterThan(before * 2);
      await expect(page.getByTestId('rpt-zoom-fit')).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
      expect((await noSidewaysScroll(page)).ok).toBe(true);

      await page.getByTestId('rpt-zoom-fit').tap();
      await expect.poll(async () => (await first.boundingBox())!.width).toBeLessThanOrEqual(width);
      // the zoom controls are app controls: 44 px (the scaled paper's own links are part of the page)
      expect((await smallTargets(page)).filter((x) => !x.startsWith('A. '))).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------- iPhone home-screen app: the share sheet for files
test.describe('iPhone home-screen app: files go to the share sheet', () => {
  test.use({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const fakeShare = (page: Page, refuseFirst: boolean) => page.addInitScript((refuse) => {
    const w = window as unknown as { __shared: string[]; __shareCalls: number };
    w.__shared = [];
    w.__shareCalls = 0;
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: (d: ShareData) => !!d?.files?.length, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => {
        w.__shareCalls += 1;
        if (refuse && w.__shareCalls === 1) throw new DOMException('no tap', 'NotAllowedError');
        w.__shared.push(...(d.files ?? []).map((f) => `${f.name}|${f.type}|${f.size}`));
      },
    });
  }, refuseFirst);

  test('Excel from the report opens the share sheet with the file, no download', async ({ page }) => {
    await fakeShare(page, false);
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    await openReport(page);
    await page.getByTestId('rp-excel').tap();
    await expect(page.getByTestId('rp-export-note')).toContainText('shared');
    const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/^ACC-downtime-.*\.xlsx\|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\|\d+$/);
    expect(Number(shared[0]!.split('|')[2])).toBeGreaterThan(1000);
    expect(downloads).toBe(0);
  });

  test('a share refused for an expired tap waits in a prompt; its Share button shares the file', async ({ page }) => {
    await fakeShare(page, true);
    await openReport(page);
    await page.getByTestId('rp-csv').tap();
    await page.getByTestId('rp-csv-summary').tap();
    const prompt = page.getByTestId('share-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('.csv');
    await expect(page.getByTestId('rp-export-note')).toContainText('Tap Share');
    const pb = (await prompt.boundingBox())!;
    const nav = await box(page, '.bottom-nav');
    expect(pb.y + pb.height).toBeLessThanOrEqual(nav.y + 0.5);
    await shot(page, 'phone-390-share-prompt');
    await page.getByTestId('share-prompt-go').tap();
    await expect(prompt).toHaveCount(0);
    const shared = await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/\.csv\|text\/csv/);
  });
});

// ---------------------------------------------------------------- phone held sideways
test.describe('phone landscape 844 x 390', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('compact chrome: short top bar, bottom bar and scope bar leave most of the height to the page', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await expect(page.locator('.bottom-nav')).toBeVisible();
    const top = await box(page, '.shell-topbar');
    const nav = await box(page, '.bottom-nav');
    const scope = await box(page, '.scope-slot');
    expect(top.height).toBeLessThanOrEqual(48.5);
    expect(nav.height).toBeLessThanOrEqual(57.5); // 48 px row + home-indicator pad + border (63 upright)
    expect(scope.height).toBeLessThanOrEqual(50.5);
    // bottom bar: icon beside its label, every item still 44 px tall
    const item = await box(page, '[data-testid=bottom-more]');
    expect(item.height).toBeGreaterThanOrEqual(44);
    // scrolled: only the top bar and the scope pills stay; the page gets at least 60 % of the height
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(150);
    const top2 = await box(page, '.shell-topbar');
    const scope2 = await box(page, '.scope-slot');
    const chrome = Math.max(top2.y + top2.height, scope2.y + scope2.height) + (390 - nav.y);
    expect(chrome).toBeLessThanOrEqual(390 * 0.4);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    await shot(page, 'landscape-844-dashboard');
    // the More sheet fits the short screen and stays a phone-wide sheet
    await page.getByTestId('bottom-more').tap();
    const sheet = await box(page, '[data-testid=more-sheet]');
    expect(sheet.height).toBeLessThanOrEqual(390);
    expect(sheet.width).toBeLessThanOrEqual(640.5);
    await shot(page, 'landscape-844-more');
  });

  test('the update banner stays one line and the top bar sits right under it', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.evaluate(() => window.__accTestUpdate?.());
    const b = (await page.getByTestId('update-banner').boundingBox())!;
    expect(b.height).toBeLessThanOrEqual(48);
    const top = await box(page, '.shell-topbar');
    expect(top.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
    expect(top.height).toBeLessThanOrEqual(48.5);
  });

  test('side safe areas: bars, sheets, banners and the page keep out of a notch', async ({ page, context }) => {
    await signInAndWait(page, 'engineer');
    // Chromium has no notch: give the page the insets an iPhone in landscape reports
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-l', '47px');
      document.documentElement.style.setProperty('--safe-r', '47px');
    });
    await page.evaluate(() => window.__accTestUpdate?.());
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    const inside = async (sel: string) => {
      const r = await page.locator(sel).first().boundingBox();
      expect(r, sel).not.toBeNull();
      expect(r!.x, `${sel} left`).toBeGreaterThanOrEqual(47 - 0.5);
      expect(r!.x + r!.width, `${sel} right`).toBeLessThanOrEqual(844 - 47 + 0.5);
    };
    await inside('.shell-topbar .shell-topbar-appicon');
    await inside('.shell-topbar-actions');
    await inside('[data-testid=bottom-more]');
    await inside('.bottom-nav a');
    await inside('.sb-pill');
    await inside('.sb-filters');
    await inside('.update-banner > svg');
    await inside('[data-testid=update-later]');
    await inside('.offline-banner > svg');
    await inside('#main .page');
    await context.setOffline(false);
    await page.getByTestId('bottom-more').tap();
    await inside('.more-sheet .more-tiles');
    // the bands still reach the screen edges (their background fills behind the notch)
    const nav = await box(page, '.bottom-nav');
    expect(nav.x).toBe(0);
    expect(nav.width).toBe(844);
    await shot(page, 'landscape-844-safe-area');
  });
});

// ---------------------------------------------------------------- touch tablet wider than the phone layout
test.describe('touch tablet 1024 x 768 (pointer: coarse)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

  test('every button, chip, tab and menu item is at least 44 px on every main page', async ({ page }) => {
    await signInAndWait(page, 'admin');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('.bottom-nav')).toBeHidden(); // the tablet keeps the desktop layout
    for (const path of ['/dashboard', '/pareto', '/repeats', '/reliability', '/events', '/validate', '/reports', '/upload', '/master', '/settings']) {
      await page.goto(`/#${path}`);
      await expect(page.locator('#main')).toBeVisible();
      await page.waitForTimeout(600);
      expect(await smallTargets(page), path).toEqual([]);
      expect((await noSidewaysScroll(page)).ok, path).toBe(true);
    }
    // an open menu: its items too
    await page.goto('/#/events');
    await page.getByTestId('export-btn').tap();
    await expect(page.getByTestId('export-btn-csv')).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, 'tablet-1024-events-menu');
  });
});
