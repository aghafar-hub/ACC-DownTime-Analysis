import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

// Event Explorer > Timeline (a Gantt of stops per area), mock mode with the made-up demo data.
// The demo data's latest stop day is 11 Oct 2026 (14 stops in 8 areas).

const bars = (page: Page) => page.getByTestId('timeline-bar');
const open = async (page: Page, path = '/#/events?view=timeline') => {
  await signInAndWait(page, 'admin');
  await page.goto(path);
  await expect(page.getByTestId('page-events')).toBeVisible();
};
const ready = async (page: Page) => {
  await expect(page.getByTestId('timeline-view')).toBeVisible();
  await expect(bars(page).first()).toBeVisible();
};

test.describe('timeline (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('List is the default; the switch is kept in the address and survives a reload', async ({ page }) => {
    await open(page, '/#/events');
    await expect(page.getByTestId('event-table')).toBeVisible();
    await expect(page.getByTestId('timeline-view')).toHaveCount(0);
    await expect(page.getByTestId('view-list')).toHaveAttribute('aria-pressed', 'true');
    const sw = await page.getByTestId('view-switch').boundingBox();
    expect(sw!.height).toBeGreaterThanOrEqual(43.5);
    await page.getByTestId('view-timeline').click();
    await expect(page).toHaveURL(/#\/events\?view=timeline/);
    await ready(page);
    await expect(page.getByTestId('event-table')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('view-timeline')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('view-list').click();
    await expect(page).not.toHaveURL(/view=timeline/);
    await expect(page.getByTestId('event-table')).toBeVisible();
  });

  test('Day and Week windows, previous / next, the date box and Latest event', async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-11');
    await expect(page.getByTestId('chart-summary')).toHaveText(/^14 stops in 8 areas on 11 Oct 2026, [\d.]+ area-hours; longest: K\.1 131\.GB140 5\.2 h$/);
    await expect(bars(page)).toHaveCount(14);
    // hour ticks, no "now" marker
    await expect(page.locator('.tl-tick')).toHaveCount(24);
    await expect(page.getByTestId('timeline-view').locator('[data-testid="now"], .now-line')).toHaveCount(0);
    // previous day: a day with fewer or other stops; the date moves by one
    await page.getByTestId('tl-prev').click();
    await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-10');
    await expect(page).toHaveURL(/date=2026-10-10/);
    await page.getByTestId('tl-next').click();
    await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-11');
    // week: Saturday to Friday containing the date, day ticks
    await page.getByTestId('tl-week').click();
    await expect(page).toHaveURL(/span=week/);
    await expect(page.locator('.tl-tick')).toHaveCount(7);
    await expect(page.locator('.tl-tick').first()).toHaveText('Sat 10 Oct');
    await expect(page.getByTestId('chart-summary')).toContainText('from Sat 10 Oct to Fri 16 Oct 2026');
    expect(await bars(page).count()).toBeGreaterThanOrEqual(14);
    await page.getByTestId('tl-prev').click();
    await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-04');
    await expect(page.getByTestId('chart-summary')).toContainText('from Sat 3 Oct to Fri 9 Oct 2026');
    // a week with no stops shows a message, Latest event brings the data back
    await page.getByTestId('tl-date').fill('2020-01-06');
    await expect(page.getByTestId('tl-empty')).toBeVisible();
    await expect(page.getByTestId('chart-summary')).toContainText('No stops');
    await page.getByTestId('tl-latest').click();
    await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-11');
    await expect(page).not.toHaveURL(/date=/);
    await expect(bars(page).first()).toBeVisible();
    // Day / Week survive a reload
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('tl-week')).toHaveAttribute('aria-pressed', 'true');
  });

  test('rows follow master-data order under line headings; Show all areas adds the quiet areas', async ({ page }) => {
    await open(page);
    await ready(page);
    const heads = await page.getByTestId('tl-group').locator('.tl-group-head').allTextContents();
    expect(heads.map((h) => h.trim())).toEqual(['Line 1', 'Line 2']);
    const areas = await page.getByTestId('tl-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-area')));
    expect(areas).toEqual(['RM.1', 'K.1', 'FM.1', 'CM.2', 'RM.2', 'K.2', 'AFR', 'SHR']);
    await page.getByTestId('tl-show-all').click();
    expect(await page.getByTestId('tl-row').count()).toBeGreaterThan(areas.length);
    await expect(page.getByTestId('tl-show-all')).toHaveAttribute('aria-pressed', 'true');
    // every drawn bar sits inside its track
    const outside = await bars(page).evaluateAll((els) => els.filter((b) => {
      const r = b.getBoundingClientRect(); const t = b.parentElement!.getBoundingClientRect();
      return r.left < t.left - 0.5 || r.right > t.right + 0.5;
    }).length);
    expect(outside).toBe(0);
  });

  test('bars: types, patterns, N/A full height, tooltip, minimum width and 44 px targets', async ({ page }) => {
    await open(page);
    await ready(page);
    const kinds = await bars(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    expect(new Set(kinds)).toEqual(new Set(['failure', 'other']));
    // solid red for failures, a pattern image for the other types
    const fills = await page.locator('.tl-vis').evaluateAll((els) => els.filter((e) => e.closest('[data-testid="timeline-bar"]')).map((e) => [e.className, getComputedStyle(e).backgroundImage]));
    for (const [cls, img] of fills as [string, string][]) {
      if (cls.includes('tl-vis--failure') && !cls.includes('blocked')) expect(img).toBe('none');
      if (cls.includes('tl-vis--other')) expect(img).toContain('radial-gradient');
    }
    // N/A: full-height bar with a heavier outline than the others
    const na = page.locator('[data-testid="timeline-bar"][data-arealevel="true"]').first();
    await expect(na).toBeVisible();
    const naBox = await na.locator('.tl-vis').boundingBox();
    const plain = await page.locator('[data-testid="timeline-bar"][data-arealevel="false"]').first().locator('.tl-vis').boundingBox();
    expect(naBox!.height).toBeGreaterThan(plain!.height + 8);
    expect(await na.locator('.tl-vis').evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('2px');
    // short bars keep a drawn width of 6 px and a 44 px button
    const sizes = await bars(page).evaluateAll((els) => els.map((b) => { const v = b.querySelector('.tl-vis')!.getBoundingClientRect(); const r = b.getBoundingClientRect(); return { vw: v.width, bw: r.width, bh: r.height }; }));
    for (const s of sizes) {
      expect(s.vw).toBeGreaterThanOrEqual(5.9);
      expect(s.bw).toBeGreaterThanOrEqual(43.5);
      expect(s.bh).toBeGreaterThanOrEqual(43.5);
    }
    // hover shows area, code, reason, time, duration and class
    await bars(page).first().hover();
    const tip = page.getByTestId('tl-tip');
    await expect(tip).toBeVisible();
    for (const label of ['Reason', 'Time', 'Duration', 'Class']) await expect(tip).toContainText(label);
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);
  });

  test('selecting a bar highlights stops that share its time and writes the overlap line; Enter opens the detail', async ({ page }) => {
    await open(page);
    await ready(page);
    await expect(page.getByTestId('tl-overlap-line')).toContainText('timing only, not cause');
    const k1 = page.locator('[data-testid="timeline-bar"][data-area="K.1"]').first();
    await k1.focus();
    await expect(k1).toHaveAttribute('data-selected', 'true');
    const line = page.getByTestId('tl-overlap-line');
    await expect(line).toHaveText(/^Overlaps with \d+ stops? in (other areas|another area): .*[A-Z.0-9]+ \S+ [\d.]+ h/);
    expect(await line.textContent()).not.toMatch(/K\.1 131\.GB140/); // never lists the same area
    const hot = await page.locator('[data-testid="timeline-bar"][data-overlap="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-area')));
    expect(hot.length).toBeGreaterThan(0);
    expect(hot).not.toContain('K.1');
    for (const a of hot) expect(await line.textContent()).toContain(a);
    // the readout is a live region for screen readers
    await expect(page.getByTestId('tl-readout')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('tl-selected')).toContainText('K.1');
    // Enter opens the same popup as the list
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('event-detail')).toBeVisible();
    const detailId = await k1.getAttribute('data-key');
    await expect(page.getByTestId('event-detail')).toContainText(detailId!);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
    // bars are focusable buttons in time order inside a row
    const order = await page.locator('[data-testid="tl-row"]').first().getByTestId('timeline-bar').evaluateAll((els) => els.map((e) => e.tagName + ':' + Math.round(e.getBoundingClientRect().left)));
    expect(order.every((o) => o.startsWith('BUTTON'))).toBe(true);
    const lefts = order.map((o) => Number(o.split(':')[1]));
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });

  test('a click on a bar opens the event detail', async ({ page }) => {
    await open(page);
    await ready(page);
    await bars(page).nth(2).click();
    await expect(page.getByTestId('event-detail')).toBeVisible();
  });

  test('View as table lists the stops of the window', async ({ page }) => {
    await open(page);
    await ready(page);
    await page.getByTestId('view-table').click();
    const table = page.getByRole('table');
    await expect(table.locator('thead th')).toHaveText(['Area', 'Code', 'Reason', 'Start', 'End', 'Hours', 'Class']);
    await expect(table.locator('tbody tr')).toHaveCount(14);
    await expect(bars(page)).toHaveCount(0);
    await page.getByTestId('view-table').click();
    await expect(bars(page)).toHaveCount(14);
  });

  test('the Explorer filters narrow the chart', async ({ page }) => {
    await open(page);
    await ready(page);
    await page.getByTestId('filter-area').selectOption('K.1');
    await expect(page.getByTestId('tl-row')).toHaveCount(1);
    expect(await bars(page).count()).toBeLessThan(14);
    await expect(page.getByTestId('chart-summary')).toContainText('in 1 area');
    await page.getByTestId('reset-filters').click();
    await expect(bars(page)).toHaveCount(14);
    await page.getByTestId('event-search').fill('131.GB140');
    await expect(page.getByTestId('tl-row')).toHaveCount(1);
    await page.getByTestId('event-search').fill('');
    await page.getByTestId('class-PL').click();
    await expect(page.getByTestId('chart-summary')).toContainText('No stops');
  });

  test('records that cannot be drawn are counted with a link to Validate', async ({ page }) => {
    await open(page);
    await ready(page);
    // find a day that has such a record: the demo data holds unreadable / backwards stops
    await page.getByTestId('tl-week').click();
    let found = false;
    for (let i = 0; i < 45 && !found; i++) {
      found = (await page.getByTestId('tl-undrawable').count()) > 0;
      if (found) break;
      const before = await page.getByTestId('tl-date').inputValue();
      await page.getByTestId('tl-prev').click();
      await expect(page.getByTestId('tl-date')).not.toHaveValue(before);
    }
    test.skip(!found, 'no undrawable record in the demo data');
    await expect(page.getByTestId('tl-undrawable')).toHaveText(/\d+ records? in this window cannot be drawn \(see Validate\)/);
    await page.getByTestId('tl-validate-link').click();
    await expect(page.getByTestId('page-validate')).toBeVisible();
  });
});

for (const width of [360, 390]) {
  test.describe(`timeline (phone ${width})`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    let errors: string[];
    test.beforeEach(async ({ page }) => {
      await stubFonts(page);
      errors = watchConsole(page);
    });
    test.afterEach(() => expect(errors, 'console errors').toEqual([]));

    test('Day by default; chart card scrolls inside itself; labels stay; no sideways page scroll; 44 px; 12 px text', async ({ page }) => {
      await open(page);
      await ready(page);
      await expect(page.getByTestId('tl-day')).toHaveAttribute('aria-pressed', 'true');
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      const sc = page.getByTestId('tl-scroll');
      const m = await sc.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(m.sw).toBeGreaterThan(m.cw);
      const label = page.getByTestId('tl-row').first().locator('.tl-label');
      const x0 = (await label.boundingBox())!.x;
      await sc.evaluate((el) => { el.scrollLeft = 300; });
      expect(Math.abs((await label.boundingBox())!.x - x0)).toBeLessThan(1.5);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      // controls wrap inside the screen
      for (const id of ['tl-day', 'tl-week', 'tl-prev', 'tl-date', 'tl-next', 'tl-latest', 'tl-show-all']) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width, id).toBeLessThanOrEqual(width + 0.5);
      }
      // week, tap a bar: popup opens and the overlap line is there
      await page.getByTestId('tl-week').tap();
      await expect(page.getByTestId('tl-week')).toHaveAttribute('aria-pressed', 'true');
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      await page.getByTestId('tl-day').tap();
      await expect(bars(page)).toHaveCount(14);
      const bar = page.locator('[data-testid="timeline-bar"][data-area="K.1"]').first();
      await bar.scrollIntoViewIfNeeded();
      await bar.tap();
      await expect(page.getByTestId('event-detail')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
    });
  });
}

const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
for (const theme of THEMES) {
  for (const vp of [{ name: 'phone', width: 390, height: 844, phone: true }, { name: 'desktop', width: 1280, height: 900, phone: false }]) {
    test(`timeline screenshots: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await open(page);
      await ready(page);
      const card = page.getByTestId('chart-timeline');
      const shoot = async (name: string) => {
        expect((await noSidewaysScroll(page)).ok, `${name} sideways scroll`).toBe(true);
        await card.scrollIntoViewIfNeeded();
        await card.screenshot({ path: `test-results/screens/timeline-${slug(theme)}-${vp.name}-${name}.png` });
        await page.evaluate(() => { const c = document.querySelector('[data-testid="chart-timeline"]')!; window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 80); });
        await page.screenshot({ path: `test-results/screens/timeline-${slug(theme)}-${vp.name}-${name}-view.png` });
      };
      await page.locator('[data-testid="timeline-bar"][data-area="K.1"]').first().focus();
      await shoot('day');
      await page.getByTestId('tl-week').click();
      await expect(bars(page).first()).toBeVisible();
      await shoot('week');
      expect(errors, errors.join('\n')).toEqual([]);
      await context.close();
    });
  }
}
