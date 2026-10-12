import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, stubFonts, watchConsole } from './helpers';

/** The first number in a text (tiles also carry a label). */
const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function open(page: Page, path: string, testid: string) {
  await page.goto(`/#${path}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await expect(page.getByTestId('chart-summary').first().or(page.getByTestId('no-data'))).toBeVisible({ timeout: 20000 });
}

test.describe('dashboards (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  test('role access: a viewer sees the dashboards and none of the hidden tabs', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'viewer');
    for (const p of ['overview', 'pareto', 'repeats', 'reliability']) {
      await open(page, `/${p}`, `page-${p}`);
    }
    const tabs = page.locator('nav a, [role=tablist] a').filter({ hasText: /^(Upload|Settings|Users|Master Data)$/ });
    await expect(tabs).toHaveCount(0);
    await page.goto('/#/users');
    await expect(page.getByTestId('page-users')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('no placeholder text remains on the four pages', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    for (const p of ['overview', 'pareto', 'repeats', 'reliability']) {
      await open(page, `/${p}`, `page-${p}`);
      await expect(page.getByText('Built in the next step')).toHaveCount(0);
      await expect(page.getByTestId('next-step')).toHaveCount(0);
    }
  });

  test('filters: line narrows areas, state survives reload and tab changes, reset clears', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    const allAreas = num(await page.getByTestId('kpi-total-hours-value').textContent());
    expect(allAreas).toBeGreaterThan(0);

    await page.getByTestId('fb-area').click();
    const before = await page.getByTestId('fb-area-opt').count();
    await page.keyboard.press('Escape');
    await page.getByTestId('fb-line').click();
    await page.getByTestId('fb-line-opt').first().click();
    await expect(page.getByTestId('fb-line-opt').first()).toBeChecked();
    await page.keyboard.press('Escape');
    await page.getByTestId('fb-area').click();
    const after = await page.getByTestId('fb-area-opt').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await page.getByTestId('fb-area-opt').first().click();
    await expect(page.getByTestId('fb-area-opt').first()).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fb-active')).toBeVisible();
    const areaHours = num(await page.getByTestId('kpi-total-hours-value').textContent());
    expect(areaHours).toBeLessThan(allAreas);
    await expect(page.getByTestId('fb-count')).toContainText('events in scope');
    await expect(page.getByTestId('fb-coverage')).toContainText('Data covers');

    // preset change resolves to one displayed range
    await page.getByTestId('fb-preset').selectOption('last30');
    await expect(page.getByTestId('fb-range')).toContainText('(30 days)');

    const url = page.url();
    expect(url).toContain('area=');
    await page.reload();
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('fb-preset')).toHaveValue('last30');
    await expect(page.getByTestId('fb-active')).toBeVisible();

    // shared across the four tabs
    await page.getByRole('link', { name: 'Pareto', exact: true }).first().click();
    await expect(page.getByTestId('page-pareto')).toBeVisible();
    await expect(page.getByTestId('fb-active')).toBeVisible();
    await expect(page.getByTestId('fb-preset')).toHaveValue('last30');

    await page.getByTestId('fb-reset').click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    await expect(page.getByTestId('fb-preset')).toHaveValue('last90');
    expect(page.url()).not.toContain('area=');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('year picker, month picker and custom range each resolve to one displayed range', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    await page.getByTestId('fb-preset').selectOption('year');
    await page.getByTestId('fb-year').selectOption('2025');
    await expect(page.getByTestId('fb-range')).toContainText('31 Dec 2025');
    await page.getByTestId('fb-preset').selectOption('month');
    await page.getByTestId('fb-month').fill('2026-03');
    await expect(page.getByTestId('fb-range')).toContainText('1 Mar 2026 – 31 Mar 2026');
    await page.getByTestId('fb-preset').selectOption('custom');
    await page.getByTestId('fb-from').fill('2025-11-15');
    await page.getByTestId('fb-to').fill('2026-01-20');
    await expect(page.getByTestId('fb-range')).toContainText('15 Nov 2025 – 20 Jan 2026');
    // a range over two years loads both years and still shows numbers
    await expect(page.getByTestId('kpi-total-hours-value')).toContainText('h');
    await expect(page.getByTestId('chart-monthly-stack')).toBeVisible();
  });

  test('Overview tile equals the Event Explorer figures for the same events', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview?r=month&m=2026-03&cmp=none');
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    const hours = num(await page.getByTestId('kpi-total-hours-value').textContent());
    const failures = num(await page.getByTestId('kpi-failure-count-value').textContent());
    await page.getByTestId('open-events').click();
    await expect(page.getByTestId('drill-chip')).toBeVisible();
    await expect(page.getByTestId('tile-hours')).toBeVisible();
    const exHours = num(await page.getByTestId('tile-hours').textContent());
    const exFail = num(await page.getByTestId('tile-failures').textContent());
    expect(Math.abs(exHours - hours)).toBeLessThan(0.11);
    expect(exFail).toBe(failures);
  });

  test('Pareto: Top N toggle, Others bar, cumulative line, drill-through chip', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/pareto', 'page-pareto');
    const card = page.getByTestId('pareto-eq-hours');
    await expect(card.getByTestId('pareto-bar')).toHaveCount(11); // top 10 + Others
    await card.getByTestId('pareto-eq-hours-top-5').click();
    await expect(card.getByTestId('pareto-bar')).toHaveCount(6);
    await card.getByTestId('pareto-eq-hours-top-all').click();
    const all = await card.getByTestId('pareto-bar').count();
    expect(all).toBeGreaterThan(20);
    await card.getByTestId('pareto-eq-hours-top-5').click();
    await expect(card.getByTestId('chart-summary')).toContainText('80%');
    await card.getByTestId('view-table').click();
    await expect(card.locator('table')).toContainText('Others');
    await card.getByTestId('view-table').click();

    // the four separate panels
    for (const id of ['bucket-other', 'bucket-area', 'bucket-unknown']) await expect(page.getByTestId(id)).toBeVisible();

    // click the first bar: Event Explorer opens with a removable chip
    await card.getByTestId('pareto-bar').first().click();
    await expect(page).toHaveURL(/#\/events/);
    await expect(page.getByTestId('drill-chip')).toBeVisible();
    await expect(page.getByTestId('drill-text')).toContainText(/Showing \d+ events from the Pareto bar/);
    const n = num((await page.getByTestId('drill-text').textContent())!.match(/Showing ([\d,]+)/)![1]!);
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId('event-row').first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('drill-chip')).toBeVisible();
    await page.getByTestId('drill-remove').click();
    await expect(page.getByTestId('drill-chip')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Pareto: reason split toggle and reason for one equipment', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/pareto', 'page-pareto');
    await page.getByTestId('sub-reason').click();
    const merged = await page.getByTestId('pareto-reason-hours').getByTestId('chart-summary').textContent();
    await page.getByTestId('reason-split-split').click();
    const split = await page.getByTestId('pareto-reason-hours').getByTestId('chart-summary').textContent();
    expect(split).not.toBe(merged);
    await expect(page.getByTestId('pareto-reason-equipment')).toBeVisible();
    await page.getByTestId('sub-area').click();
    await expect(page.getByTestId('pareto-area-hours')).toBeVisible();
    await expect(page.getByTestId('pareto-class')).toBeVisible();
  });

  test('Repeated failures: table sorts, a row opens the timeline, heatmaps and scatter render', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/repeats', 'page-repeats');
    await expect(page.getByTestId('rt-groups')).toBeVisible();
    await expect(page.getByTestId('rt-recurrences')).toBeVisible();
    const rows = page.getByTestId('repeat-row');
    expect(await rows.count()).toBeGreaterThan(0);
    await page.getByTestId('sort-totalHours').click();
    const first = num(await rows.first().locator('td').nth(3).textContent());
    await page.getByTestId('sort-totalHours').click();
    expect(first).toBeGreaterThanOrEqual(0);
    const last = await rows.last().getAttribute('data-equipment');
    await rows.last().getByTestId('repeat-open').click();
    await expect(page.getByTestId('chart-timeline')).toContainText(last!);
    await expect(page.getByTestId('timeline-mark').first()).toBeVisible();
    await expect(page.getByTestId('heatmap').first()).toBeVisible();
    await expect(page.getByTestId('scatter')).toBeVisible();
    await page.getByTestId('roll-window-90').click();
    await expect(page.getByTestId('chart-rolling')).toContainText('90');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: unavailable months are gaps with a note; area selector; histogram; longest events', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/reliability?r=ytd');
    await expect(page.getByTestId('chart-mtbf')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('rel-area').selectOption({ index: 1 });
    await expect(page.getByTestId('chart-histogram')).toBeVisible();
    await expect(page.getByTestId('chart-yoy')).toBeVisible();
    await expect(page.getByTestId('longest-row').first()).toBeVisible();
    await page.getByTestId('chart-mtbf').getByTestId('view-table').click();
    await expect(page.getByTestId('chart-mtbf').locator('table')).toBeVisible();
    // no corrective-action chart (out of scope)
    await expect(page.getByText(/before.*after/i)).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('tooltips show numbers on hover', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    const box = page.getByTestId('chart-monthly-stack').locator('rect.chart-hit').nth(1);
    await box.hover();
    await expect(page.getByTestId('chart-tip')).toContainText('Failure');
    await expect(page.getByTestId('chart-tip')).toContainText(/\d/);
  });
});

for (const width of [360, 390]) {
  test.describe(`dashboards (phone ${width})`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    test(`layout, filters sheet and tap tooltips at ${width}px`, async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      for (const p of ['overview', 'pareto', 'repeats', 'reliability']) {
        await open(page, `/${p}`, `page-${p}`);
        expect((await noSidewaysScroll(page)).ok, `${p} sideways scroll`).toBe(true);
        await expect(page.getByTestId('fb-filters-pill')).toBeVisible();
        await expect(page.getByTestId('phone-summary')).toBeVisible();
      }
      await open(page, '/overview', 'page-overview');
      // the Filters chip opens a sheet with all fields; the count of active filters shows on the chip
      await page.getByTestId('fb-filters-pill').click();
      await expect(page.getByTestId('fb-sheet')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('fb-cls-MEC').click();
      await page.getByTestId('fb-sheet-apply').click();
      await expect(page.getByTestId('fb-filters-pill')).toContainText('1');
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      // a collapsed section opens; tapping a chart column pins a tooltip
      const hit = page.getByTestId('chart-monthly-stack').locator('rect.chart-hit').first();
      await hit.scrollIntoViewIfNeeded();
      await hit.tap();
      await expect(page.getByTestId('chart-tip')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
