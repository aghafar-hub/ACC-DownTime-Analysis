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

    // "Stopped by other areas": each code says where it is listed and which area stopped; hours and events as before
    const other = page.getByTestId('bucket-other');
    const details = other.getByTestId('bucket-detail');
    expect(await details.count()).toBeGreaterThan(0);
    for (const d of await details.allTextContents()) expect(d).toMatch(/^ · listed under [A-Z0-9.]+(, [A-Z0-9.]+)* · stopped [A-Z0-9.]+(, [A-Z0-9.]+)*$/);
    const listed = await other.locator('li').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    expect(listed[0]).toMatch(/^\S+ · listed under .* · stopped .* h$/);
    const bucketHours = num((await other.getByTestId('bucket-other-total').textContent())!);
    expect(bucketHours).toBeGreaterThan(0);

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

test.describe('Phase 4: more charts (desktop)', () => {
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  /** View as table shows a table and View as chart brings the graphic back. */
  async function tableWorks(page: Page, id: string) {
    const card = page.getByTestId(id);
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('chart-summary')).not.toBeEmpty();
    await card.getByTestId('view-table').click();
    await expect(card.locator('table.chart-table')).toBeVisible();
    await card.getByTestId('view-table').click();
    await expect(card.locator('table.chart-table')).toHaveCount(0);
  }

  test('Pareto: lines and classifications (hours and count) next to areas; reasons by month heat map with switch and show-all', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/pareto', 'page-pareto');
    await page.getByTestId('sub-area').click();
    for (const id of ['pareto-line-hours', 'pareto-line-count', 'pareto-area-hours', 'pareto-area-count', 'pareto-class', 'pareto-class-count']) {
      await expect(page.getByTestId(id)).toBeVisible();
      await tableWorks(page, id);
    }
    // the line Pareto covers the same failures as the area Pareto
    const total = async (id: string) => num(((await page.getByTestId(id).getByTestId('chart-summary').textContent()) ?? '').match(/([\d,]+(?:\.\d+)?) \S+ in total/)?.[1] ?? null);
    await page.getByTestId('pareto-line-hours').getByTestId('pareto-line-hours-top-all').click();
    await page.getByTestId('pareto-area-hours').getByTestId('pareto-area-hours-top-all').click();
    expect(await total('pareto-line-hours')).toBe(await total('pareto-area-hours'));
    await expect(page.getByTestId('pareto-line-count').getByTestId('pareto-bar').first()).toBeVisible();
    // the class scope switch drives both classification charts
    await page.getByTestId('class-scope-fail').click();
    await expect(page.getByTestId('pareto-class-count')).toContainText('Failure events only');

    await page.getByTestId('sub-reason').click();
    const card = page.getByTestId('chart-heat-reason-month');
    await expect(card.getByTestId('heatmap')).toBeVisible();
    await expect(card.getByTestId('chart-summary')).toContainText('reasons shown');
    const hoursSummary = await card.getByTestId('chart-summary').textContent();
    await card.getByTestId('heat-reason-month-measure-count').click();
    await expect(card.getByTestId('chart-summary')).not.toHaveText(hoursSummary!);
    await expect(card.getByTestId('chart-summary')).toContainText('events in total');
    const shown = await card.locator('tbody tr').count();
    expect(shown).toBeLessThanOrEqual(12);
    if (await card.getByTestId('heat-toggle').count()) {
      await card.getByTestId('heat-toggle').click();
      expect(await card.locator('tbody tr').count()).toBeGreaterThan(shown);
    }
    await tableWorks(page, 'chart-heat-reason-month');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: Areas block order, ranked bars, quadrant, availability heat map, failure rate', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    const ids = ['chart-availability', 'area-table-card', 'chart-area-mtbf', 'chart-area-mttr', 'chart-area-quadrant', 'chart-area-month-heat', 'chart-area-rate', 'chart-when-heat', 'chart-mtbf'];
    const order = await page.locator(ids.map((i) => `[data-testid="${i}"]`).join(',')).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(ids);
    // the new charts sit inside the Areas block; the new section is its own block after it
    for (const id of ['chart-area-mtbf', 'chart-area-mttr', 'chart-area-quadrant', 'chart-area-month-heat', 'chart-area-rate']) {
      await expect(page.getByTestId('areas-block').getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('when-block').getByRole('heading', { name: 'When failures start' })).toBeVisible();

    // ranked bars: MTBF lowest first, MTTR highest first, no figure shown as zero
    const tableValues = async (id: string) => {
      const card = page.getByTestId(id);
      await card.getByTestId('view-table').click();
      const cells = await card.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent ?? '')));
      await card.getByTestId('view-table').click();
      return cells;
    };
    const areaRows = await page.getByTestId('area-row').count();
    for (const [id, dir] of [['chart-area-mtbf', 1], ['chart-area-mttr', -1]] as const) {
      const rows = await tableValues(id);
      expect(rows.length).toBe(areaRows);
      const nums = rows.filter((r) => !/failures|unavailable/.test(r[1]!)).map((r) => num(r[1]!));
      expect(nums, id).toEqual([...nums].sort((a, b) => (a - b) * dir));
      // areas with no failures come after every ranked area and say so
      const firstNone = rows.findIndex((r) => r[1] === 'no failures');
      if (firstNone >= 0) expect(rows.slice(firstNone).every((r) => r[1] === 'no failures' || r[1] === 'unavailable')).toBe(true);
      expect(rows.some((r) => num(r[1]!) === 0), `${id} zero`).toBe(false);
    }
    // the bars equal the By area table
    const mtbfRows = await tableValues('chart-area-mtbf');
    for (const [area, v] of mtbfRows) {
      const cell = await page.locator(`[data-testid="area-row"][data-area="${area}"] td`).nth(4).textContent();
      expect(cell === 'None recorded' ? 'no failures' : cell).toBe(v);
    }
    for (const id of ['chart-area-mtbf', 'chart-area-mttr']) await expect(page.getByTestId(id).locator('rect.chart-hit').first()).toBeVisible();

    // quadrant: a labelled point per area with failures, two dashed median lines, the worst quadrant named in words
    const quad = page.getByTestId('chart-area-quadrant');
    await expect(quad.getByTestId('quadrant')).toBeVisible();
    const points = await quad.getByTestId('quadrant-point').count();
    expect(points).toBeGreaterThan(1);
    expect(await quad.getByTestId('quadrant-label').count()).toBe(points);
    await expect(quad.getByTestId('quadrant-median-x')).toBeVisible();
    await expect(quad.getByTestId('quadrant-median-y')).toBeVisible();
    await expect(quad.getByTestId('quadrant-worst-label')).toHaveText('Worst: low MTBF, high MTTR');
    await expect(quad.getByTestId('chart-summary')).toContainText('Median MTBF');
    await quad.getByTestId('quadrant-point').first().hover({ force: true });
    await expect(page.getByTestId('chart-tip')).toContainText('MTBF');
    await tableWorks(page, 'chart-area-quadrant');

    // availability heat map: a % in every cell, fixed scale legend, one row per area
    const heat = page.getByTestId('chart-area-month-heat');
    await expect(heat.getByTestId('scale-legend')).toContainText('90%');
    await expect(heat.getByTestId('scale-legend')).toContainText('100%');
    expect(await heat.locator('tbody tr').count()).toBe(areaRows);
    const cells = heat.getByTestId('scale-cell');
    expect(await cells.count()).toBeGreaterThan(areaRows);
    await expect(cells.first()).toHaveText(/\d+(\.\d)?%/);
    await expect(heat.getByRole('heading', { level: 2 })).toContainText('basis B');
    // its "Range" column equals the By area table
    const first = await heat.locator('tbody tr').first().getAttribute('data-area');
    const rangeCell = await heat.locator('tbody tr').first().locator('td').last().textContent();
    const tbl = await page.locator(`[data-testid="area-row"][data-area="${first}"] td`).nth(3).textContent();
    expect(rangeCell!.replace('▾ ', '')).toBe(tbl);
    await tableWorks(page, 'chart-area-month-heat');

    // failure rate with the all-area reference line
    await expect(page.getByTestId('chart-area-rate').getByTestId('hbars-ref')).toBeVisible();
    await expect(page.getByTestId('chart-area-rate').getByTestId('chart-legend')).toContainText('All areas together');
    await tableWorks(page, 'chart-area-rate');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: When failures start (hour x weekday) with the Count / Hours switch', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    const card = page.getByTestId('chart-when-heat');
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('heatmap')).toBeVisible();
    expect(await card.locator('tbody tr').count()).toBe(24);
    expect(await card.locator('thead th').count()).toBe(1 + 7 + 1);
    await expect(card.locator('thead')).toContainText('Mon');
    await expect(card.locator('thead')).toContainText('Sun');
    // counts sum to the failure events of the page
    const grand = num(await card.getByTestId('heat-grand-total').textContent());
    expect(grand).toBeGreaterThan(0);
    const colTotals = await card.getByTestId('heat-col-total').allTextContents();
    expect(colTotals.map(num).reduce((a, b) => a + b, 0)).toBe(grand);
    expect(num(await card.getByTestId('chart-summary').textContent())).toBe(grand);
    await expect(card.getByText('no time zone conversion')).toBeVisible();
    await card.getByTestId('when-measure-hours').click();
    await expect(card.getByTestId('chart-summary')).toContainText(' h started');
    expect(num(await card.getByTestId('heat-grand-total').textContent())).toBeGreaterThan(0);
    await card.getByTestId('when-measure-count').click();
    expect(num(await card.getByTestId('heat-grand-total').textContent())).toBe(grand);
    await tableWorks(page, 'chart-when-heat');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: the new charts follow the shared filters', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    const before = num(await page.getByTestId('chart-when-heat').getByTestId('heat-grand-total').textContent());
    const areas = await page.getByTestId('area-row').count();
    await page.getByTestId('fb-filters-pill').click();
    await page.getByTestId('fb-cls-MEC').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    await expect.poll(async () => num(await page.getByTestId('chart-when-heat').getByTestId('heat-grand-total').textContent())).toBeLessThan(before);
    expect(await page.getByTestId('chart-area-month-heat').locator('tbody tr').count()).toBe(areas);
  });

  test('Repeated failures: every investigation row has a mini timeline of its occurrences', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/repeats', 'page-repeats');
    const rows = page.getByTestId('repeat-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId('repeat-table').getByTestId('occ-strip')).toHaveCount(n);
    for (let i = 0; i < Math.min(n, 5); i++) {
      const row = rows.nth(i);
      const strip = row.getByTestId('occ-strip');
      const occurrences = num(await row.locator('td').nth(4).textContent());
      await expect(strip).toHaveAttribute('aria-label', /\d+ occurrences, first \d{4}-\d{2}-\d{2}, last \d{4}-\d{2}-\d{2}/);
      expect(Number(await strip.getAttribute('data-count'))).toBe(occurrences);
      expect(await strip.locator('circle').count()).toBe(occurrences);
      const last = await row.locator('td').nth(8).textContent();
      expect(await strip.getAttribute('aria-label')).toContain(`last ${last}`);
    }
    // sorting keeps the strips with their rows
    await page.getByTestId('sort-equipmentId').click();
    await expect(page.getByTestId('repeat-table').getByTestId('occ-strip')).toHaveCount(n);
    expect(errors, errors.join('\n')).toEqual([]);
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
    test(`Phase 4 charts at ${width}px: no sideways scroll, 44 px targets, 12 px text, tap alternatives, no console errors`, async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      const checks = async (label: string) => {
        expect((await noSidewaysScroll(page)).ok, `${label} sideways scroll`).toBe(true);
        expect(await smallTargets(page), `${label} targets`).toEqual([]);
        expect(await smallText(page), `${label} text`).toEqual([]);
      };
      await open(page, '/pareto', 'page-pareto');
      await page.getByTestId('sub-area').click();
      await expect(page.getByTestId('pareto-line-hours')).toBeVisible();
      await expect(page.getByTestId('pareto-class-count')).toBeVisible();
      await checks('pareto areas');
      await page.getByTestId('sub-reason').click();
      await expect(page.getByTestId('chart-heat-reason-month').getByTestId('heatmap')).toBeVisible();
      await page.getByTestId('chart-heat-reason-month').getByTestId('heat-reason-month-measure-count').click();
      await checks('pareto reasons');

      await open(page, '/reliability', 'page-reliability');
      for (const id of ['chart-area-mtbf', 'chart-area-mttr', 'chart-area-quadrant', 'chart-area-month-heat', 'chart-area-rate', 'chart-when-heat']) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        await expect(page.getByTestId(id).getByTestId('chart-summary')).toBeVisible();
      }
      await checks('reliability');
      // touch alternative to click-to-drill: tap a quadrant point, the pinned tooltip has the button
      const pt = page.getByTestId('chart-area-quadrant').getByTestId('quadrant-point').first();
      await pt.scrollIntoViewIfNeeded();
      await pt.tap({ force: true });
      await expect(page.getByTestId('chart-tip')).toContainText('Open events');
      await expect(page.getByTestId('chart-tip').getByRole('button')).toBeVisible();
      await checks('reliability tooltip');
      await page.getByTestId('chart-area-quadrant').getByTestId('chart-summary').tap();
      const bar = page.getByTestId('chart-area-mtbf').locator('rect.chart-hit').first();
      await bar.scrollIntoViewIfNeeded();
      await bar.tap();
      await expect(page.getByTestId('chart-tip')).toContainText('MTBF');
      await page.getByTestId('chart-when-heat').getByTestId('when-measure-hours').scrollIntoViewIfNeeded();
      await page.getByTestId('chart-when-heat').getByTestId('when-measure-hours').tap();
      await checks('reliability hours');

      await open(page, '/repeats', 'page-repeats');
      await expect(page.getByTestId('repeat-card').first()).toBeVisible();
      await expect(page.getByTestId('repeat-cards').getByTestId('occ-strip').first()).toBeVisible();
      await checks('repeats');
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
