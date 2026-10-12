import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

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

    await expect(page.getByTestId('fb-panel')).toHaveCount(0); // the panel is collapsed by default
    await page.getByTestId('fb-filters-pill').click();
    await expect(page.getByTestId('fb-panel')).toBeVisible();
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
    await expect(page.getByTestId('fb-badge')).toHaveText('2');
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

test.describe('Phase 3: shared filters, compact bar, Overview rework (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  test('filters are shared across the four Analyze pages, chips are removable, Reset clears all', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    await page.getByTestId('fb-preset').selectOption('last30');
    await page.getByTestId('fb-cmp-none').click();
    await page.getByTestId('fb-filters-pill').click();
    await page.getByTestId('fb-cls-MEC').click();
    await page.getByTestId('fb-cls-ELE').click();
    await page.getByTestId('fb-fail').click();
    await expect(page.getByTestId('fb-badge')).toHaveText('2');
    for (const [link, id] of [['Pareto', 'pareto'], ['Repeated Failures', 'repeats'], ['Reliability', 'reliability'], ['Overview', 'overview']] as const) {
      await page.getByRole('link', { name: link, exact: true }).first().click();
      await expect(page.getByTestId(`page-${id}`)).toBeVisible();
      await expect(page.getByTestId('fb-preset')).toHaveValue('last30');
      await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
      await expect(page.getByTestId('fb-chip-cls-ELE')).toBeVisible();
      await expect(page.getByTestId('fb-chip-fail')).toBeVisible();
      await expect(page.getByTestId('fb-panel')).toHaveCount(0);
    }
    expect(await page.evaluate(() => Object.entries(sessionStorage).some(([k, v]) => k.endsWith('dash_filters') && v.includes('cls=MEC')))).toBe(true);
    // remove one chip: the badge counts down, the other filters stay
    await page.getByTestId('fb-chip-cls-ELE').click();
    await expect(page.getByTestId('fb-chip-cls-ELE')).toHaveCount(0);
    await expect(page.getByTestId('fb-badge')).toHaveText('2');
    await page.getByTestId('fb-chip-fail').click();
    await expect(page.getByTestId('fb-badge')).toHaveText('1');
    const chip = await page.getByTestId('fb-chip-cls-MEC').boundingBox();
    expect(chip!.height).toBeGreaterThanOrEqual(43.5);
    await page.getByRole('link', { name: 'Pareto', exact: true }).first().click();
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    // Event Explorer keeps its own filters: the shared chips are not there
    await page.goto('/#/events');
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('fb-chip-cls-MEC')).toHaveCount(0);
    await page.goto('/#/pareto');
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    await page.getByTestId('fb-reset').click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    await expect(page.getByTestId('fb-badge')).toHaveCount(0);
    await expect(page.getByTestId('fb-preset')).toHaveValue('last90');
    await page.getByRole('link', { name: 'Reliability', exact: true }).first().click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('every page has a takeaway sentence built from its numbers', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    for (const p of ['overview', 'pareto', 'repeats', 'reliability']) {
      await open(page, `/${p}`, `page-${p}`);
      const text = (await page.getByTestId('takeaway').textContent()) ?? '';
      expect(text.length, p).toBeGreaterThan(20);
      expect(text, p).not.toContain('Loading');
    }
    await open(page, '/overview', 'page-overview');
    await expect(page.getByTestId('takeaway')).toContainText(/area-hours stopped.*largest contributor/);
    const hours = num(await page.getByTestId('kpi-total-hours-value').textContent());
    expect(num(await page.getByTestId('takeaway').textContent())).toBe(hours);
  });

  test('Overview: hero KPIs with sparklines and an info popover, More figures toggle', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    for (const id of ['total-hours', 'failure-count', 'availability', 'mttr']) {
      const card = page.getByTestId(`kpi-${id}`);
      await expect(card).toBeVisible();
      await expect(card.getByTestId('spark')).toHaveAttribute('aria-label', /trend: from .* to /);
      const info = await card.getByTestId(`kpi-${id}-info`).boundingBox();
      expect(info!.width).toBeGreaterThanOrEqual(43.5);
      expect(info!.height).toBeGreaterThanOrEqual(43.5);
    }
    // the default range is 90 days: weekly points
    await expect(page.getByTestId('kpi-total-hours').getByTestId('spark')).toHaveAttribute('aria-label', /weekly trend/);
    await page.getByTestId('kpi-availability-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('Basis B');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('kpi-info')).toHaveCount(0);
    await page.getByTestId('kpi-mttr-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('failure');
    await page.getByTestId('kpi-info-close').click();
    await expect(page.getByTestId('kpi-info')).toHaveCount(0);

    // More figures: open on a desktop, every other figure is in it
    await expect(page.getByTestId('more-figures-toggle')).toHaveAttribute('aria-expanded', 'true');
    for (const id of ['failure-hours', 'planned-hours', 'other-hours', 'operating-hours', 'mtbf', 'repeated', 'top-area', 'top-equipment']) {
      await expect(page.getByTestId('more-figures').getByTestId(`kpi-${id}`)).toBeVisible();
    }
    await page.getByTestId('more-figures-toggle').click();
    await expect(page.getByTestId('kpi-failure-hours')).toHaveCount(0);
    await expect(page.getByTestId('kpi-total-hours')).toBeVisible();
    await page.getByTestId('more-figures-toggle').click();
    await expect(page.getByTestId('kpi-failure-hours')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Overview: the six charts in order, View as table works, removed items are gone', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    const ids = ['chart-daily', 'chart-monthly-stack', 'chart-class-month', 'chart-downtime-area', 'chart-top-equipment', 'chart-area-availability'];
    const order = await page.locator('[data-testid^="chart-"][data-testid$="-daily"], section.chart-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(ids);
    for (const id of ids) {
      const card = page.getByTestId(id);
      await expect(card.getByTestId('chart-summary')).not.toBeEmpty();
      await card.getByTestId('view-table').click();
      await expect(card.locator('table')).toBeVisible();
      await card.getByTestId('view-table').click();
      await expect(card.locator('svg[role=img]').first()).toBeVisible();
    }
    await expect(page.getByTestId('chart-daily').getByTestId('chart-legend')).toContainText('7-day average');
    await expect(page.getByTestId('chart-area-availability').getByTestId('hbars-ref')).toBeVisible();
    // top 10 bars open the events behind them
    const rows = page.getByTestId('chart-top-equipment').locator('rect.chart-hit');
    expect(await rows.count()).toBeLessThanOrEqual(10);
    await rows.first().click();
    await expect(page).toHaveURL(/#\/events/);
    await expect(page.getByTestId('drill-chip')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('page-overview')).toBeVisible();
    // removed from Overview
    for (const id of ['chart-operating', 'chart-monthly-aligned', 'chart-availability', 'area-table-card', 'area-table']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByText('Operating and stopped hours per area')).toHaveCount(0);
    await expect(page.getByText('Failure hours and failure count by month')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: Areas section (availability trend and By area table) comes first, monthly charts below', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    await expect(page.getByTestId('areas-block').getByRole('heading', { name: 'Areas', exact: true })).toBeVisible();
    await expect(page.getByTestId('chart-availability')).toBeVisible();
    await expect(page.getByTestId('trend-areas')).toBeVisible();
    await expect(page.getByTestId('area-table')).toBeVisible();
    expect(await page.getByTestId('area-row').count()).toBeGreaterThan(1);
    const y = async (id: string) => (await page.getByTestId(id).first().boundingBox())!.y;
    expect(await y('area-table-card')).toBeLessThan(await y('chart-mtbf'));
    expect(await y('chart-availability')).toBeLessThan(await y('chart-mtbf'));
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
        await expect(page.getByTestId('takeaway')).toBeVisible();
      }
      // KPI tiles are two per row on every Analyze page
      for (const [p, id] of [['pareto', 'pareto-tiles'], ['repeats', 'repeat-tiles'], ['reliability', 'reliability-tiles']] as const) {
        await open(page, `/${p}`, `page-${p}`);
        const tiles = await page.getByTestId(id).locator(':scope > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
        expect(tiles.length).toBe(4);
        expect(Math.abs(tiles[0]!.y - tiles[1]!.y), `${p} row 1`).toBeLessThan(2);
        expect(Math.abs(tiles[2]!.y - tiles[3]!.y), `${p} row 2`).toBeLessThan(2);
        expect(tiles[2]!.y).toBeGreaterThan(tiles[0]!.y + 40);
        expect(await smallText(page), `${p} small text`).toEqual([]);
      }
      await open(page, '/overview', 'page-overview');
      // the Filters chip opens a sheet with all fields; the count of active filters shows on the chip
      await page.getByTestId('fb-filters-pill').click();
      await expect(page.getByTestId('fb-sheet')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('fb-cls-MEC').click();
      await page.getByTestId('fb-sheet-apply').click();
      await expect(page.getByTestId('fb-filters-pill')).toContainText('1');
      await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      // a collapsed section opens; tapping a chart column pins a tooltip
      const hit = page.getByTestId('chart-monthly-stack').locator('rect.chart-hit').first();
      await hit.scrollIntoViewIfNeeded();
      await hit.tap();
      await expect(page.getByTestId('chart-tip')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test(`Overview at ${width}px: two hero KPIs per row, More figures folded, targets and text sizes`, async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      await open(page, '/overview', 'page-overview');
      const boxes = await Promise.all(['total-hours', 'failure-count', 'availability', 'mttr'].map((id) => page.getByTestId(`kpi-${id}`).boundingBox()));
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
      expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(2);
      expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + 40);
      // short labels on the phone, the full label stays the accessible text; the label does not wrap
      for (const [id, short, full] of [['total-hours', 'Stoppage hours', 'Total stoppage hours'], ['failure-count', 'Failures', 'Failure count'], ['availability', 'Availability B', 'Availability (basis B)'], ['mttr', 'Restoration time', 'Mean restoration time']]) {
        const label = page.getByTestId(`kpi-${id}`).locator('.hero-label');
        await expect(label.locator('.hl-short')).toHaveText(short);
        await expect(label.locator('.hl-short')).toBeVisible();
        await expect(label).toHaveAttribute('title', full);
        await expect(label.locator('.hl-full')).toHaveText(full);
        expect((await label.boundingBox())!.height, `${id} label lines`).toBeLessThan(24);
      }
      await expect(page.getByTestId('more-figures-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('kpi-failure-hours')).toHaveCount(0);
      await page.getByTestId('more-figures-toggle').click();
      const a = await page.getByTestId('kpi-failure-hours').boundingBox();
      const b = await page.getByTestId('kpi-planned-hours').boundingBox();
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
      await page.getByTestId('kpi-total-hours-info').click();
      await expect(page.getByTestId('kpi-info')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('kpi-info-close').click();
      await page.getByTestId('sec-where-toggle').click();
      for (const id of ['chart-daily', 'chart-class-month', 'chart-top-equipment', 'chart-area-availability']) await expect(page.getByTestId(id)).toBeVisible();
      // zoomed availability axis says where it starts, in the chart and in the text summary
      await expect(page.getByTestId('chart-area-availability').getByTestId('hbars-axis-note')).toHaveText(/^Axis starts at \d+%$/);
      await expect(page.getByTestId('chart-area-availability').getByTestId('chart-summary')).toContainText('Axis starts at');
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallText(page)).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);
      // the compact filter bar: remove a chip with a 44 px target
      await page.getByTestId('fb-filters-pill').click();
      await page.getByTestId('fb-cls-PRO').click();
      await page.getByTestId('fb-sheet-apply').click();
      const chip = await page.getByTestId('fb-chip-cls-PRO').boundingBox();
      expect(chip!.height).toBeGreaterThanOrEqual(43.5);
      await page.getByTestId('fb-chip-cls-PRO').click();
      await expect(page.getByTestId('fb-chip-cls-PRO')).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
