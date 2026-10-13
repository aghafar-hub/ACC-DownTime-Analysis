// R0 of docs/redesign: correctness and safety fixes that show in the browser.
import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, stubFonts, watchConsole } from './helpers';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function waitSettled(page: Page) {
  await expect(page.getByTestId('chart-summary').first().or(page.getByTestId('no-data')).or(page.getByTestId('empty-scope'))).toBeVisible({ timeout: 20000 });
}

test.describe('R0 (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  test('filters that leave no record: one clear state with Reset, a warning for chips that exclude each other, no 100% figures', async ({ page }) => {
    const errors = watchConsole(page);
    await signInAndWait(page, 'engineer');
    for (const path of ['overview', 'pareto', 'repeats', 'reliability']) {
      await page.goto(`/#/${path}?cls=PL&fail=1`);
      await expect(page.getByTestId(`page-${path}`)).toBeVisible();
      await expect(page.getByTestId('empty-scope')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('empty-scope')).toContainText('No records match these filters');
      await expect(page.getByTestId('empty-scope')).toContainText('exclude each other');
      await expect(page.getByTestId('fb-clash')).toBeVisible();
      await expect(page.getByTestId('fb-count')).toContainText(/^0 events in scope/);
      await expect(page.getByTestId('takeaway')).toHaveText('No records match these filters.');
      await expect(page.getByTestId('takeaway')).not.toContainText('no failures');
    }
    // nothing computed from nothing on the Overview
    await page.goto('/#/overview?cls=PL&fail=1');
    await expect(page.getByTestId('empty-scope')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('kpi-availability')).toHaveCount(0);
    await expect(page.getByTestId('hero-kpis')).toHaveCount(0);
    await expect(page.getByText('100.0%')).toHaveCount(0);
    // Reset brings the figures back
    await page.getByTestId('empty-scope-reset').click();
    await expect(page.getByTestId('hero-kpis')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('empty-scope')).toHaveCount(0);
    await expect(page.getByTestId('fb-clash')).toHaveCount(0);
    await expect(page).not.toHaveURL(/fail=1/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Event Explorer keeps its filters, search and shown count in the address: Back brings the same list back', async ({ page }) => {
    const errors = watchConsole(page);
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    await expect(page.getByTestId('event-table')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('failure-only').click();
    await page.getByTestId('filter-crit').selectOption('INC');
    await page.getByTestId('event-search').fill('a ');
    await expect(page).toHaveURL(/fail=1/);
    await expect(page).toHaveURL(/crit=INC/);
    await expect(page.getByTestId('event-search')).toHaveValue('a '); // typing keeps the trailing space
    await page.getByTestId('event-search').fill('a');
    await page.getByTestId('show-more').click();
    await expect(page).toHaveURL(/[?&]n=100/);
    await expect.poll(() => page.getByTestId('event-table').locator('tbody tr').count()).toBeGreaterThan(50);
    const shown = await page.getByTestId('tile-shown').textContent();
    const rowsBefore = await page.getByTestId('event-table').locator('tbody tr').count();

    // another tab, then Back
    await page.goto('/#/overview');
    await waitSettled(page);
    await page.goBack();
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('failure-only')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('filter-crit')).toHaveValue('INC');
    await expect(page.getByTestId('event-search')).toHaveValue('a');
    await expect(page.getByTestId('tile-shown')).toHaveText(shown!);
    await expect(page.getByTestId('event-table').locator('tbody tr')).toHaveCount(rowsBefore);

    // a reload keeps them too; Reset clears the address
    await page.reload();
    await expect(page.getByTestId('failure-only')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
    await page.getByTestId('reset-filters').click();
    await expect(page).not.toHaveURL(/fail=1|crit=|[?&]n=/);
    await expect(page.getByTestId('failure-only')).toHaveAttribute('aria-pressed', 'false');
    // fast typing keeps every key, and the address follows
    await page.getByTestId('event-search').pressSequentially('belt c');
    await expect(page.getByTestId('event-search')).toHaveValue('belt c');
    await expect(page).toHaveURL(/q=belt(\+|%20)c/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test("'This month' while the month runs is marked as a month in progress; a whole month is not", async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview?r=thismonth');
    await waitSettled(page);
    await expect(page.getByTestId('fb-partial')).toContainText('Month in progress');
    await page.goto('/#/overview?r=prevmonth');
    await waitSettled(page);
    await expect(page.getByTestId('fb-partial')).toHaveCount(0);
  });

  test('Views and Export panels close with Back and the page stays', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview');
    await waitSettled(page);
    await page.getByTestId('views-btn').click();
    await expect(page.getByTestId('views-btn-panel')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('views-btn-panel')).toHaveCount(0);
    await expect(page.getByTestId('page-overview')).toBeVisible();
    await expect(page).toHaveURL(/#\/overview/);

    await page.goto('/#/events');
    await expect(page.getByTestId('event-table')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('export-btn').click();
    await expect(page.getByTestId('export-btn-panel')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('export-btn-panel')).toHaveCount(0);
    await expect(page.getByTestId('page-events')).toBeVisible();
    // closing from the panel itself does not take the page back
    await page.getByTestId('export-btn').click();
    await expect(page.getByTestId('export-btn-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('export-btn-panel')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('page-events')).toBeVisible();
  });

  test('table headings stay in view under the top bar while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    const table = page.getByTestId('event-table');
    await expect(table).toBeVisible({ timeout: 20000 });
    const head = table.locator('thead th').first();
    const before = await head.boundingBox();
    // scroll the page well past the table's top
    await table.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + 900));
    await expect.poll(async () => {
      const bar = await page.locator('.shell-topbar').boundingBox();
      const th = await head.boundingBox();
      return th && bar ? Math.round(th.y - (bar.y + bar.height)) : 999;
    }, { timeout: 5000 }).toBeLessThanOrEqual(1);
    const th = (await head.boundingBox())!;
    const bar = (await page.locator('.shell-topbar').boundingBox())!;
    expect(th.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(th.y).not.toBe(before!.y);
    await expect(head).toBeInViewport();
    // the heading is on top of the rows, not under them
    const topEl = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('th') !== null, { x: th.x + 10, y: th.y + th.height / 2 });
    expect(topEl).toBe(true);
    // back at the top it sits in its place again
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => Math.round((await head.boundingBox())!.y)).toBe(Math.round(before!.y));
  });
});

test.describe('R0 (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true });
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  test('the install banner does not cover Show more at the end of a list', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('acc_dt_install_dismissed'); } catch { /* ignore */ }
    });
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    const banner = page.getByTestId('install-banner');
    await expect(banner).toBeVisible({ timeout: 20000 });
    const more = page.getByTestId('show-more');
    await expect(more).toBeAttached({ timeout: 20000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const b = (await banner.boundingBox())!;
    const m = (await more.boundingBox())!;
    // Show more ends above the banner, and a tap on it reaches the button
    expect(m.y + m.height).toBeLessThanOrEqual(b.y + 1);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="show-more"]') !== null, { x: m.x + m.width / 2, y: m.y + m.height / 2 });
    expect(hit).toBe(true);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    // 'Not now' gives the room back
    await banner.getByRole('button', { name: 'Not now' }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--install-banner-h').trim())).toBe('');
  });

  test('the empty-scope state fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview?cls=PL&fail=1');
    await expect(page.getByTestId('empty-scope')).toBeVisible({ timeout: 20000 });
    const reset = (await page.getByTestId('empty-scope-reset').boundingBox())!;
    expect(reset.height).toBeGreaterThanOrEqual(43.5);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });
});
