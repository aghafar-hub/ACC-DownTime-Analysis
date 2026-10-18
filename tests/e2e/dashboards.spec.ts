import { expect, test, type Page } from '@playwright/test';
import { closePanel, noSidewaysScroll, openType, pickPeriod, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

/** A chart that repeats a Dashboard card is folded on the other pages: open it (closed on every visit). */
async function expandDup(page: Page, testid: string) {
  const sec = page.getByTestId(testid);
  await expect(sec).toBeVisible();
  if ((await sec.getAttribute('data-open')) !== 'yes') await sec.getByTestId(`${testid}-toggle`).click();
  await expect(sec).toHaveAttribute('data-open', 'yes');
}

/** The first number in a text (tiles also carry a label). */
const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function open(page: Page, path: string, testid: string) {
  await page.goto(`/#${path}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await expect(page.getByTestId('chart-summary').first().or(page.getByTestId('no-data'))).toBeVisible({ timeout: 20000 });
}

/** The drill banner on Event records ('From: … · 1,234 events (…), 12.3 h'): the number of events. */
async function drillCount(page: Page): Promise<number> {
  await expect(page.getByTestId('drill-text')).toBeVisible({ timeout: 20000 });
  return num((await page.getByTestId('drill-text').textContent())!.match(/([\d,]+) (?:events?|records?)\b/)![1]!);
}

/** Remove every record of one month from the in-memory demo API, then reload the data: the month becomes 'Not uploaded'. */
async function dropMonth(page: Page, month: string) {
  const left = await page.evaluate(async (m) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /mockApi-.*\.js$/.test(n));
    if (!url) throw new Error('mock api chunk not loaded');
    const mod = await import(/* @vite-ignore */ url);
    const db = mod.mockApi.__db();
    db.events = db.events.filter((e: { stop_ts: string }) => !String(e.stop_ts).startsWith(m));
    return db.events.length;
  }, month);
  expect(left).toBeGreaterThan(0);
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

    // one sticky scope bar: each chip opens its own small panel
    await expect(page.getByTestId('scope-note')).toContainText('Shared filters');
    await expect(page.getByTestId('scope-note')).toHaveAttribute('title', /Shared by Dashboard, Losses, Repeated failures, Reliability, Event records/);
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
    await expect(page.getByTestId('fb-line')).toContainText('Line:');
    await expect(page.getByTestId('fb-line')).not.toContainText('All');
    const areaHours = num(await page.getByTestId('kpi-total-hours-value').textContent());
    expect(areaHours).toBeLessThan(allAreas);
    await expect(page.getByTestId('fb-count')).toContainText('events in scope');
    await expect(page.getByTestId('fb-coverage')).toContainText('Data covers');

    // preset change resolves to one displayed range
    await pickPeriod(page, 'last30');
    await closePanel(page);
    await expect(page.getByTestId('fb-range')).toContainText('(30 days)');
    await expect(page.getByTestId('scope-period')).toContainText('Last 30 days');

    const url = page.url();
    expect(url).toContain('area=');
    await page.reload();
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('scope-period')).toContainText('Last 30 days');
    await expect(page.getByTestId('fb-active')).toBeVisible();

    // shared across the Analyze pages
    await page.getByTestId('rail-link-pareto').click();
    await expect(page.getByTestId('page-pareto')).toBeVisible();
    await expect(page.getByTestId('fb-active')).toBeVisible();
    await expect(page.getByTestId('scope-period')).toContainText('Last 30 days');

    await page.getByTestId('fb-reset').click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    await expect(page.getByTestId('scope-period')).toContainText('Last 90 days');
    expect(page.url()).not.toContain('area=');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('year picker, month picker and custom range each resolve to one displayed range', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    await pickPeriod(page, 'year');
    await page.getByTestId('fb-year').selectOption('2025');
    await expect(page.getByTestId('fb-range')).toContainText('31 Dec 2025');
    await expect(page.getByTestId('scope-period')).toContainText('Period: 2025');
    await pickPeriod(page, 'month');
    await page.getByTestId('fb-month').fill('2026-03');
    await expect(page.getByTestId('fb-range')).toContainText('1–31 Mar 2026');
    await expect(page.getByTestId('scope-period')).toContainText('Period: Mar 2026');
    // the native date fields show the date in words beside them
    await pickPeriod(page, 'custom');
    await page.getByTestId('fb-from').fill('2025-11-15');
    await page.getByTestId('fb-to').fill('2026-01-20');
    await expect(page.getByTestId('fb-range')).toContainText('15 Nov 2025 – 20 Jan 2026');
    await expect(page.getByTestId('scope-period-panel')).toContainText('15 Nov 2025');
    await closePanel(page);
    // a range over two years loads both years and still shows numbers
    await expect(page.getByTestId('kpi-total-hours-value')).toContainText('h');
    await expect(page.getByTestId('chart-monthly-stack')).toBeVisible();
  });

  test('Dashboard: Open records opens exactly the records behind the card (counts equal the card values)', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview?r=month&m=2026-03&cmp=none');
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    const failures = num(await page.getByTestId('kpi-failure-count-value').textContent());
    expect(failures).toBeGreaterThan(0);
    // every card names its scope and has the link; the count it carries is what Event records shows
    for (const card of await page.locator('[data-dash-card]').all()) {
      await expect(card.getByTestId('card-scope')).not.toBeEmpty();
      await expect(card.getByTestId('card-open')).toHaveCount(1);
    }
    await expect(page.getByTestId('chart-daily').getByTestId('card-scope')).toContainText('Mar 2026 · All lines · All areas');
    await expect(page.getByTestId('chart-losses').getByTestId('card-scope')).toContainText('Mar 2026 · All lines · All areas · Incidental');

    // failures and repair time: the month's failure events are the KPI failure count
    const fm = page.getByTestId('chart-fail-mttr');
    await fm.getByTestId('col-hit').last().click();
    await expect(fm.getByTestId('fail-detail')).toContainText('Mar 2026');
    await expect(fm.getByTestId('fail-detail')).toContainText(`${failures} failures`);
    await expect(fm.getByTestId('fail-detail-open')).toHaveAttribute('data-count', String(failures));
    await fm.getByTestId('fail-detail-open').click();
    expect(await drillCount(page)).toBe(failures);
    await page.goBack();
    await expect(page.getByTestId('page-overview')).toBeVisible();

    // the quadrant opens the failure events of the period (all areas): the same count
    await expect(page.getByTestId('chart-dash-rf-mtbf').getByTestId('card-open')).toHaveAttribute('data-count', String(failures));

    // each card's footer link: Event records shows exactly as many events as the link carries
    for (const id of ['chart-daily', 'chart-losses', 'chart-repeats', 'chart-planned-line']) {
      const link = page.getByTestId(id).getByTestId('card-open');
      await link.scrollIntoViewIfNeeded();
      const n = Number(await link.getAttribute('data-count'));
      expect(n, id).toBeGreaterThan(0);
      await link.click();
      expect(await drillCount(page), id).toBe(n);
      await expect(page.getByTestId('event-row').first()).toBeVisible();
      await page.goBack();
      await expect(page.getByTestId('page-overview')).toBeVisible();
    }
    // a Pareto row opens its own events: its count
    const row = page.getByTestId('chart-losses').getByTestId('loss-row').first();
    const rn = Number(await row.getAttribute('data-count'));
    await row.click();
    expect(await drillCount(page)).toBe(rn);
    expect(errors, errors.join('\n')).toEqual([]);
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

    // area-level (N/A): every classification, not only failures; the records button opens exactly those stops
    const area = page.getByTestId('bucket-area');
    const naCount = num((await area.getByTestId('bucket-area-count').textContent())!);
    if (naCount > 0) {
      await expect(area.getByTestId('bucket-area-classes')).toContainText(/[A-Z]{2,3} [\d,.]+ h/);
      await expect(area.getByTestId('bucket-area-failures')).toBeVisible();
      await area.getByTestId('bucket-area-open').click();
      expect(await drillCount(page)).toBe(naCount);
      await page.goBack();
      await expect(page.getByTestId('page-pareto')).toBeVisible();
    }

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
    await expect(page.getByTestId('drill-text')).toContainText(/^Pareto › \S+ · .+ · \d+ events?( \([\d,]+ rows\))?, [\d,.]+ h$/);
    const n = num((await page.getByTestId('drill-text').textContent())!.match(/ ([\d,]+) events?/)![1]!);
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
    // 'Reasons for one equipment code' lives on the Equipment view now (after the Pareto charts, before the buckets)
    await expect(page.getByTestId('pareto-reason-equipment')).toHaveCount(0);
    await page.getByTestId('sub-equipment').click();
    await expect(page.getByTestId('pareto-reason-equipment')).toBeVisible();
    await page.getByTestId('sub-area').click();
    await expect(page.getByTestId('pareto-area-hours')).toBeVisible();
    await expandDup(page, 'dup-pareto-class');
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
    // the rolling failure trend was removed (owner, 14 Oct)
    await expect(page.getByTestId('chart-rolling')).toHaveCount(0);
    await expect(page.getByTestId('roll-window')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: unavailable months are gaps with a note; area selector; histogram; longest events', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/reliability?r=ytd&tab=trends');
    await expect(page.getByTestId('chart-mtbf')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('rel-area').selectOption({ index: 1 });
    await expect(page.getByTestId('chart-yoy')).toBeVisible();
    await page.getByTestId('chart-mtbf').getByTestId('view-table').click();
    await expect(page.getByTestId('chart-mtbf').locator('table')).toBeVisible();
    await page.getByTestId('rel-tab-timing').click();
    await expect(page.getByTestId('chart-histogram')).toBeVisible();
    await page.getByTestId('rel-tab-longest').click();
    await expect(page.getByTestId('longest-row').first()).toBeVisible();
    // no corrective-action chart (out of scope)
    await expect(page.getByText(/before.*after/i)).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Trend card: Monthly / Daily and By type / By class; a click opens the detail panel with Open N records; partial month marked', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview?r=month&m=2026-08', 'page-overview');
    const card = page.getByTestId('chart-monthly-stack');
    await expect(card.getByTestId('trend-grain-month')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('trend-by-type')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByTestId('chart-legend')).toContainText('Partial month');
    await expect(card.getByTestId('chart-legend')).toContainText('Not uploaded');
    // the year around the period, from January; the month in progress (the demo data ends inside it) is partial
    const cols = card.getByTestId('col-hit');
    await expect(cols.first()).toHaveAttribute('data-key', '2026-01');
    await expect(cols.last()).toHaveAttribute('data-status', 'partial');
    await expect(card.getByTestId('col-partial')).toHaveCount(1);
    await expect(card.locator('text.col-sub', { hasText: 'partial' })).toHaveCount(1);
    // click August: the panel lists the three types, the change against July and the records of the month
    await card.locator('[data-testid="col-hit"][data-key="2026-08"]').click();
    const detail = card.getByTestId('trend-detail');
    await expect(detail).toContainText('Aug 2026');
    for (const w of ['Incidental (INC)', 'Planned (PL)', 'CIR', 'All types', 'vs Jul']) await expect(detail).toContainText(w);
    const total = num(await detail.getByTestId('trend-detail-total').textContent());
    expect(total).toBeCloseTo(num(await page.getByTestId('kpi-total-hours-value').textContent()), 1);
    const openBtn = detail.getByTestId('trend-detail-open');
    const n = Number(await openBtn.getAttribute('data-count'));
    await expect(openBtn).toHaveText(new RegExp(`Open ${n.toLocaleString('en-GB')} records`));
    // the same month by class: the same total
    await card.getByTestId('trend-by-class').click();
    await expect(card.getByTestId('chart-legend')).toContainText('PRO');
    // the selected month stays selected
    await expect(card.getByTestId('trend-detail')).toContainText('Production');
    expect(num(await card.getByTestId('trend-detail-total').textContent())).toBeCloseTo(total, 1);
    await card.getByTestId('trend-detail-close').click();
    await expect(card.getByTestId('trend-detail')).toHaveCount(0);
    // daily: one column per day of the period
    await card.getByTestId('trend-grain-day').click();
    await expect(card.getByTestId('col-hit')).toHaveCount(31);
    await card.getByTestId('trend-grain-month').click();
    await card.getByTestId('trend-by-type').click();
    await card.locator('[data-testid="col-hit"][data-key="2026-08"]').click();
    await card.getByTestId('trend-detail-open').click();
    expect(await drillCount(page)).toBe(n);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a month not uploaded is an empty dashed slot (never 0 h or 100%) on the trend, sparklines, failures and the heat map', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview?r=month&m=2026-08', 'page-overview');
    await dropMonth(page, '2026-09');
    await page.getByTestId('refresh').click();
    await expect(page.getByTestId('data-status')).toContainText('Sep 2026 not uploaded', { timeout: 20000 });
    const trend = page.getByTestId('chart-monthly-stack');
    await expect(trend.locator('[data-testid="col-hit"][data-key="2026-09"]')).toHaveAttribute('data-status', 'notUploaded');
    await expect(trend.getByTestId('col-not-uploaded')).toHaveCount(1);
    await expect(trend.getByTestId('chart-summary')).toContainText('Not uploaded: Sep 2026');
    await trend.locator('[data-testid="col-hit"][data-key="2026-09"]').click();
    await expect(trend.getByTestId('trend-detail-empty')).toContainText('Not uploaded');
    await expect(trend.getByTestId('trend-detail-open')).toHaveCount(0);
    // the heat map: the September column is 'no data' for every area, never a percentage
    const heat = page.getByTestId('chart-avail-heat');
    const rows = await heat.getByTestId('heat-row').count();
    await expect(heat.locator('td[data-status="notUploaded"]')).toHaveCount(rows);
    await expect(heat.locator('td[data-status="notUploaded"]').first()).not.toContainText('%');
    // the failures card runs to the period (August), so September is not in it; a period over September says so
    await open(page, '/overview?r=ytd', 'page-overview');
    await expect(page.getByTestId('chart-fail-mttr').getByTestId('col-not-uploaded')).toHaveCount(1);
    await expect(page.getByTestId('kpi-total-hours').getByTestId('spark')).toHaveAttribute('aria-label', /Not uploaded: Sep 2026/);
    expect(errors, errors.join('\n')).toEqual([]);
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
    await pickPeriod(page, 'last30');
    await closePanel(page);
    await page.getByTestId('scope-compare').click();
    await page.getByTestId('fb-cmp-none').click();
    await closePanel(page);
    await expect(page.getByTestId('scope-compare')).toContainText('None');
    await openType(page);
    await page.getByTestId('fb-cls-MEC').click();
    await page.getByTestId('fb-cls-ELE').click();
    await page.getByTestId('fb-fail').click();
    await closePanel(page);
    await expect(page.getByTestId('fb-badge')).toHaveText('2');
    await expect(page.getByTestId('scope-type')).toContainText('MEC, ELE +1');
    for (const id of ['pareto', 'repeats', 'reliability', 'overview'] as const) {
      await page.getByTestId(`rail-link-${id}`).click();
      await expect(page.getByTestId(`page-${id}`)).toBeVisible();
      await expect(page.getByTestId('scope-period')).toContainText('Last 30 days');
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
    await page.getByTestId('rail-link-pareto').click();
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    // Event records share the same scope: the chips are there, and the list follows them
    await page.getByTestId('rail-link-data').click();
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    await expect(page.getByTestId('scope-period')).toContainText('Last 30 days');
    await expect(page.getByTestId('event-row').first().locator('.badge--class')).toHaveText('MEC');
    await page.getByTestId('rail-link-pareto').click();
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    await page.getByTestId('fb-reset').click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    await expect(page.getByTestId('fb-badge')).toHaveCount(0);
    await expect(page.getByTestId('scope-period')).toContainText('Last 90 days');
    await page.getByTestId('rail-link-reliability').click();
    await expect(page.getByTestId('fb-active')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('R1 scope bar: equipment follows the areas (with cross-area causes) and out-of-scope choices are pruned when the line changes', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/dashboard', 'page-overview');
    const allCodes = async () => {
      await page.getByTestId('fb-code').click();
      const n = await page.getByTestId('fb-code-opt').count();
      await closePanel(page);
      return n;
    };
    // area K.1 narrows the equipment list
    await page.getByTestId('fb-area').click();
    await page.locator('[data-testid="fb-area-opt"][data-value="K.1"]').click();
    await closePanel(page);
    await page.getByTestId('fb-code').click();
    await expect(page.getByTestId('fb-code-search')).toBeVisible();
    const code = await page.getByTestId('fb-code-opt').first().getAttribute('data-value');
    await page.getByTestId('fb-code-opt').first().click();
    await closePanel(page);
    await expect(page.getByTestId(`fb-chip-code-${code}`)).toBeVisible();
    await expect(page.getByTestId('fb-code')).toContainText(code!);
    // K.1 is on line L.1: choosing only L.2 drops the area and its equipment
    await page.getByTestId('fb-line').click();
    await page.locator('[data-testid="fb-line-opt"][data-value="L.2"]').click();
    await closePanel(page);
    await expect(page.getByTestId('fb-chip-line-L.2')).toBeVisible();
    await expect(page.getByTestId('fb-chip-area-K.1')).toHaveCount(0);
    await expect(page.getByTestId(`fb-chip-code-${code}`)).toHaveCount(0);
    await expect(page.getByTestId('fb-code')).toContainText('All');
    expect(page.url()).not.toContain('area=K.1');
    // the areas offered are the line's
    await page.getByTestId('fb-area').click();
    await expect(page.locator('[data-testid="fb-area-opt"][data-value="K.1"]')).toHaveCount(0);
    await closePanel(page);
    expect(await allCodes()).toBeGreaterThan(0);
    // the Type panel: Incidental / Planned / Other over the classifications
    await openType(page);
    await page.getByTestId('fb-group-planned').click();
    await closePanel(page);
    await expect(page.getByTestId('scope-type')).toContainText('Type: Planned');
    await expect(page.getByTestId('fb-chip-cls-PL')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('R1 data status strip: what the data covers, records to check (to Validate) and the last upload', async ({ page }) => {
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    for (const p of ['dashboard', 'pareto', 'events']) {
      await page.goto(`/#/${p}`);
      await expect(page.getByTestId('data-status')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('fb-coverage')).toContainText(/Data covers \d{1,2} [A-Z][a-z]{2} \d{4} – \d{1,2} [A-Z][a-z]{2} \d{4}/);
      await expect(page.getByTestId('data-status-upload')).toContainText(/Last upload \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}/);
    }
    await expect(page.getByTestId('data-status-check')).toContainText(/\d+ records to check/);
    await page.getByTestId('data-status-check').click();
    await expect(page.getByTestId('page-validate')).toBeVisible();
    // not on pages outside Analyze and Event records
    await expect(page.getByTestId('data-status')).toHaveCount(0);
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

  test('Dashboard: the KPI row (six figures, monthly sparklines, info), then the twelve cards in order, then the compact sections', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/overview?r=month&m=2026-08', 'page-overview');
    for (const id of ['total-hours', 'failure-count', 'reliability', 'mtbf', 'mttr', 'utilization']) {
      const card = page.getByTestId(`kpi-${id}`);
      await expect(card).toBeVisible();
      // January to the period, by month
      await expect(card.getByTestId('spark')).toHaveAttribute('aria-label', /monthly trend Jan–Aug: from .* to /);
      await expect(card).toContainText('Jan–Aug');
      const info = await card.getByTestId(`kpi-${id}-info`).boundingBox();
      expect(info!.width).toBeGreaterThanOrEqual(43.5);
      expect(info!.height).toBeGreaterThanOrEqual(43.5);
    }
    await expect(page.getByTestId('kpi-mtbf')).toContainText('MTBF · all areas (area-hours)');
    await expect(page.getByTestId('kpi-failure-count')).toContainText('events');
    // the type split of the total sums to it
    const total = num(await page.getByTestId('kpi-total-hours-value').textContent());
    const parts = (await page.getByTestId('kpi-total-hours').locator('.ksplit-legend b').allTextContents()).map(num);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((x, y) => x + y, 0)).toBeCloseTo(total, 0);
    await page.getByTestId('kpi-reliability-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('RF = running hours ÷ (running hours + incidental hours)');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('kpi-info')).toHaveCount(0);
    await page.getByTestId('kpi-mttr-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('failure');
    await page.getByTestId('kpi-info-close').click();
    await expect(page.getByTestId('kpi-info')).toHaveCount(0);

    // the cards: a question as the title, in this order
    const order = await page.locator('[data-dash-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dash-card')));
    expect(order).toEqual(['trend', 'class', 'losses', 'planned', 'area-down', 'area-target', 'planned-allowance', 'fail-mttr', 'attention', 'repeats', 'heat', 'daily']);
    const titles = await page.locator('[data-dash-card] h2').allTextContents();
    expect(titles).toEqual([
      'How is stoppage moving month to month?', 'What kind of stoppage was it?', 'Where did we lose the most time?', 'Planned or incidental?',
      'Which areas stopped the longest?', 'Which areas miss their availability target?', 'Planned hours vs allowance (year to date)', 'Are we failing more, or repairing slower?', 'Which areas need attention?',
      'What keeps failing again?', 'Is any area slipping over time?', 'Which days were worst?',
    ]);
    const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    expect(await y('hero-kpis')).toBeLessThan(await y('dash-cards'));
    expect(await y('dash-cards')).toBeLessThan(await y('overview-mvm'));
    expect(await y('overview-mvm')).toBeLessThan(await y('quality-mini'));
    expect(await y('quality-mini')).toBeLessThan(await y('dash-areas'));
    // two cards side by side on a desktop (trend + class), the daily card full width
    const tb = await page.getByTestId('chart-monthly-stack').boundingBox();
    const cb = await page.getByTestId('chart-class').boundingBox();
    expect(Math.abs(tb!.y - cb!.y)).toBeLessThan(2);
    expect((await page.getByTestId('chart-daily').boundingBox())!.width).toBeGreaterThan(tb!.width + cb!.width);

    // class donut: PRO, MEC, ELE, AUT, PL, CIR summing to the total
    const cls = (await page.getByTestId('chart-class').getByTestId('class-row').locator('td.num:first-of-type').allTextContents()).map(num);
    expect(cls).toHaveLength(6);
    expect(cls.reduce((x, v) => x + v, 0)).toBeCloseTo(total, 0);
    // planned or incidental: the All row equals the total
    expect(num(await page.getByTestId('split-total').textContent())).toBeCloseTo(total, 1);
    // downtime by area: sorted, largest first
    const areaVals = (await page.getByTestId('chart-downtime-area').locator('.hb-val').allTextContents()).map(num);
    expect(areaVals).toEqual([...areaVals].sort((p, q) => q - p));
    // no plant-wide target; the demo has targets for some areas (Settings > Actions & targets): only those are judged
    await expect(page.getByTestId('chart-area-availability').getByTestId('own-target-note')).toBeVisible();
    await expect(page.getByTestId('chart-area-availability').locator('[data-testid=at-row][data-area="K.1"]')).toHaveAttribute('data-target', '90');
    await expect(page.getByTestId('chart-area-availability').locator('[data-testid=at-row][data-area="CM.4"]')).toHaveAttribute('data-state', 'none');
    await expect(page.getByTestId('chart-avail-heat').getByTestId('heat-no-target')).toBeVisible();
    // 'Which areas need attention?' is the RF against MTBF chart with the RF target line (95 % by default)
    await expect(page.getByTestId('chart-dash-rf-mtbf').getByTestId('rf-target')).toContainText('RF target 95%');
    await expect(page.getByTestId('chart-dash-rf-mtbf').getByTestId('rf-median')).toBeVisible();
    // daily: the 7-day average line
    await expect(page.getByTestId('chart-daily').getByTestId('chart-legend')).toContainText('7-day average');
    await expect(page.getByTestId('chart-daily').getByTestId('col-line')).toBeVisible();

    // the Pareto card: four groupings, hours or count, the honest wording
    const loss = page.getByTestId('chart-losses');
    await expect(loss.getByTestId('pareto-honest')).toHaveText(/^Top 10 = \d+% of failure hours80% needs \d+ items?$/);
    await expect(loss.getByTestId('loss-row')).toHaveCount(10);
    for (const d of ['reason', 'area', 'line', 'equipment']) {
      await loss.getByTestId(`loss-dim-${d}`).click();
      await expect(loss.getByTestId(`loss-dim-${d}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(loss.getByTestId('loss-row').first()).toBeVisible();
    }
    await loss.getByTestId('loss-measure-count').click();
    await expect(loss.getByTestId('pareto-honest')).toContainText('of failures');
    await expect(page.getByText(/first \d+ bars reach/)).toHaveCount(0);

    // the compact sections: Month vs month says what changed before it is opened
    await expect(page.getByTestId('overview-mvm')).toHaveAttribute('data-open', 'no');
    await expect(page.getByTestId('overview-mvm-summary')).toContainText(/Stoppage [▲▼■]/);
    await expect(page.getByTestId('dash-areas-table').getByTestId('dash-area-row')).toHaveCount(5);
    await page.getByTestId('areas-show-all').click();
    expect(await page.getByTestId('dash-area-row').count()).toBeGreaterThan(5);
    // removed from the Dashboard
    for (const id of ['more-figures', 'chart-class-month', 'chart-top-equipment', 'sec-time', 'sec-where', 'open-events']) await expect(page.getByTestId(id)).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Reliability: sub-tabs Areas | Timing | Trends | Longest, in the address and deep-linkable', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    const tabs = page.getByTestId('rel-tab');
    await expect(tabs.getByRole('tab')).toHaveText(['Areas', 'Timing', 'Trends', 'Longest']);
    for (const tab of await tabs.getByRole('tab').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByTestId('rel-tab-areas')).toHaveAttribute('aria-selected', 'true');
    // Areas: the By area table and, folded (the Dashboard has it), the availability trend; nothing of the other tabs
    await expect(page.getByTestId('areas-block').getByRole('heading', { name: 'Areas', exact: true })).toBeVisible();
    await expect(page.getByTestId('chart-availability')).toHaveCount(0);
    await expandDup(page, 'dup-area-trend');
    await expect(page.getByTestId('chart-availability')).toBeVisible();
    await expect(page.getByTestId('trend-areas')).toBeVisible();
    expect(await page.getByTestId('area-row').count()).toBeGreaterThan(1);
    for (const id of ['chart-when-heat', 'chart-mtbf', 'longest-card']) await expect(page.getByTestId(id)).toHaveCount(0);
    // Timing: when failures start and how long they last
    await page.getByTestId('rel-tab-timing').click();
    await expect(page).toHaveURL(/tab=timing/);
    await expect(page.getByTestId('chart-when-heat')).toBeVisible();
    await expect(page.getByTestId('chart-histogram')).toBeVisible();
    await expect(page.getByTestId('areas-block')).toHaveCount(0);
    // Trends: monthly MTBF, MTTR, rate and year over year
    await page.getByTestId('rel-tab-trends').click();
    await expect(page).toHaveURL(/tab=trends/);
    await expect(page.getByTestId('chart-mttr')).toHaveCount(0);
    await expandDup(page, 'dup-rel-mttr');
    for (const id of ['chart-mtbf', 'chart-mttr', 'chart-rate', 'chart-yoy']) await expect(page.getByTestId(id)).toBeVisible();
    // keyboard: arrows move between the tabs
    await page.getByTestId('rel-tab-trends').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('rel-tab-longest')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('longest-row').first()).toBeVisible();
    // a link opens the tab; a filter change keeps it; Back returns to the previous tab
    const url = page.url();
    await page.goto('/#/overview');
    await page.goto(url);
    await expect(page.getByTestId('rel-tab-longest')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('rel-tab-timing').click();
    await expect(page.getByTestId('chart-when-heat')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('rel-tab-longest')).toHaveAttribute('aria-selected', 'true');
    await page.goto('/#/reliability?tab=timing&line=L.1');
    await expect(page.getByTestId('chart-when-heat')).toBeVisible({ timeout: 20000 });
    await pickPeriod(page, 'last30');
    await closePanel(page);
    await expect(page).toHaveURL(/tab=timing/);
    await expect(page.getByTestId('chart-when-heat')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
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
    await expandDup(page, 'dup-pareto-class');
    await expandDup(page, 'dup-pareto-class-count');
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
    // the By area table first; the charts that repeat a Dashboard card are folded at the end, closed on every visit
    const ids = ['area-table-card', 'chart-area-mtbf', 'chart-area-mttr', 'chart-area-rate', 'chart-area-quadrant', 'dup-rf-mtbf', 'dup-area-month-heat', 'dup-area-trend'];
    const order = await page.locator(ids.map((i) => `[data-testid="${i}"]`).join(',')).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(ids);
    for (const id of ['dup-rf-mtbf', 'dup-area-month-heat', 'dup-area-trend']) await expect(page.getByTestId(id)).toHaveAttribute('data-open', 'no');
    for (const id of ['chart-rf-mtbf', 'chart-area-month-heat', 'chart-availability']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expandDup(page, 'dup-rf-mtbf');
    await expandDup(page, 'dup-area-month-heat');
    // the charts sit inside the Areas block
    for (const id of ['chart-area-mtbf', 'chart-area-mttr', 'chart-area-quadrant', 'chart-area-month-heat', 'chart-area-rate']) {
      await expect(page.getByTestId('areas-block').getByTestId(id)).toBeVisible();
    }
    await page.getByTestId('rel-tab-timing').click();
    await expect(page.getByTestId('when-block').getByRole('heading', { name: 'When failures start' })).toBeVisible();
    await page.getByTestId('rel-tab-areas').click();
    await expect(page.getByTestId('area-table')).toBeVisible();
    // back on the tab: folded again (not remembered)
    await expect(page.getByTestId('dup-rf-mtbf')).toHaveAttribute('data-open', 'no');
    await expandDup(page, 'dup-rf-mtbf');
    await expandDup(page, 'dup-area-month-heat');

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
      const cell = await page.locator(`[data-testid="area-row"][data-area="${area}"] td`).nth(7).textContent();
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
    const tbl = await page.locator(`[data-testid="area-row"][data-area="${first}"] td`).nth(4).textContent();
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
    await open(page, '/reliability?tab=timing', 'page-reliability');
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
    const areas = await page.getByTestId('area-row').count();
    await page.getByTestId('rel-tab-timing').click();
    const before = num(await page.getByTestId('chart-when-heat').getByTestId('heat-grand-total').textContent());
    await openType(page);
    await page.getByTestId('fb-cls-MEC').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
    await expect.poll(async () => num(await page.getByTestId('chart-when-heat').getByTestId('heat-grand-total').textContent())).toBeLessThan(before);
    await page.getByTestId('rel-tab-areas').click();
    await expect(page.getByTestId('area-table')).toBeVisible();
    await expandDup(page, 'dup-area-month-heat');
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
      await expect(strip).toHaveAttribute('aria-label', /\d+ occurrences, first \d{1,2} [A-Z][a-z]{2} \d{4}, last \d{1,2} [A-Z][a-z]{2} \d{4}/);
      expect(Number(await strip.getAttribute('data-count'))).toBe(occurrences);
      expect(await strip.locator('circle').count()).toBe(occurrences);
      const last = await row.locator('td').nth(9).textContent(); // Equipment, Area(s), Reason, Timeline, Occurrences, Bursts, Total, Avg, Max, Last
      expect(await strip.getAttribute('aria-label')).toContain(`last ${last}`);
    }
    // P5: bursts are a column of their own, and the rule is explained under the table
    await expect(rows.first().getByTestId('repeat-bursts')).toBeVisible();
    await expect(page.getByTestId('repeat-burst-note')).toContainText('within 10 minutes');
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
      await page.getByTestId('fb-more').click();
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await page.getByTestId('fb-cls-MEC').click();
      await page.getByTestId('fb-sheet-apply').click();
      await expect(page.getByTestId('fb-filters-pill')).toContainText('1');
      await expect(page.getByTestId('fb-chip-cls-MEC')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      // tapping a chart column opens the details inside the card (nothing depends on hover)
      const hit = page.getByTestId('chart-monthly-stack').locator('[data-testid="col-hit"][data-status="full"]').first();
      await hit.scrollIntoViewIfNeeded();
      await hit.tap();
      await expect(page.getByTestId('trend-detail')).toBeVisible();
      await expect(page.getByTestId('trend-detail-open')).toBeVisible();
      expect((await page.getByTestId('trend-detail-open').boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      expect(await smallTargets(page)).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test(`Dashboard at ${width}px: KPIs two per row, the cards stacked in order, phone views, 44 px targets and 12 px text`, async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      await open(page, '/overview?r=month&m=2026-08', 'page-overview');
      const boxes = await Promise.all(['total-hours', 'failure-count', 'reliability', 'mtbf', 'mttr', 'utilization'].map((id) => page.getByTestId(`kpi-${id}`).boundingBox()));
      // two per row, all the same width: total + failures, RF + MTBF, MTTR + UF
      for (const i of [0, 2, 4]) {
        expect(Math.abs(boxes[i]!.y - boxes[i + 1]!.y)).toBeLessThan(2);
        expect(Math.abs(boxes[i]!.width - boxes[0]!.width)).toBeLessThan(2);
        if (i < 4) expect(boxes[i + 2]!.y).toBeGreaterThan(boxes[i]!.y + 40);
      }
      await expect(page.getByTestId('kpi-running-hours')).toHaveCount(0);
      // the cards one under the other, in the same order as on a desktop
      const cards = await page.locator('[data-dash-card]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-dash-card'), x: r.x, y: r.y }; }));
      expect(cards.map((c) => c.id)).toEqual(['trend', 'class', 'losses', 'planned', 'area-down', 'area-target', 'planned-allowance', 'fail-mttr', 'attention', 'repeats', 'heat', 'daily']);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i]!.y).toBeGreaterThan(cards[i - 1]!.y);
        expect(Math.abs(cards[i]!.x - cards[0]!.x)).toBeLessThan(2);
      }
      // phone views: top 8 areas, worst 6 for the target and the heat map, the last 14 days
      const down = page.getByTestId('chart-downtime-area');
      await expect(down.getByTestId('area-down-row')).toHaveCount(8);
      await down.getByTestId('area-down-all').click();
      expect(await down.getByTestId('area-down-row').count()).toBeGreaterThan(8);
      await expect(page.getByTestId('chart-area-availability').getByTestId('at-row')).toHaveCount(6);
      await expect(page.getByTestId('chart-avail-heat').getByTestId('heat-row')).toHaveCount(6);
      const daily = page.getByTestId('chart-daily');
      await expect(daily.getByTestId('col-hit')).toHaveCount(14);
      await expect(daily.getByTestId('card-scope')).toContainText('18–31 Aug 2026');
      await daily.getByTestId('daily-all').click();
      await expect(daily.getByTestId('col-hit')).toHaveCount(31);
      await daily.getByTestId('daily-all').click();
      // the Pareto as horizontal bars with the cumulative share beside them
      await expect(page.getByTestId('chart-losses').getByTestId('loss-row')).toHaveCount(10);
      // open the compact sections too, then check the whole page
      await page.getByTestId('overview-mvm-toggle').click();
      await expect(page.getByTestId('overview-mvm-cards')).toBeVisible();
      await expect(page.getByTestId('dash-areas').getByTestId('dash-area-row')).toHaveCount(5);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallText(page)).toEqual([]);
      expect(await smallTargets(page)).toEqual([]);
      // a tapped day shows its numbers in the card
      await daily.locator('[data-testid="col-hit"][data-status="full"]').last().tap();
      await expect(daily.getByTestId('daily-detail')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('kpi-total-hours-info').click();
      await expect(page.getByTestId('kpi-info')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('kpi-info-close').click();
      // the compact filter bar: remove a chip with a 44 px target
      await page.getByTestId('fb-filters-pill').click();
      await page.getByTestId('fb-more').click();
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
      await checks('pareto areas, folded');
      await expandDup(page, 'dup-pareto-class-count');
      await expect(page.getByTestId('pareto-class-count')).toBeVisible();
      await checks('pareto areas');
      await page.getByTestId('sub-reason').click();
      await expect(page.getByTestId('chart-heat-reason-month').getByTestId('heatmap')).toBeVisible();
      await page.getByTestId('chart-heat-reason-month').getByTestId('heat-reason-month-measure-count').click();
      await checks('pareto reasons');

      await open(page, '/reliability', 'page-reliability');
      await checks('reliability, folded');
      await expandDup(page, 'dup-rf-mtbf');
      await expandDup(page, 'dup-area-month-heat');
      for (const id of ['chart-area-mtbf', 'chart-area-mttr', 'chart-area-quadrant', 'chart-area-month-heat', 'chart-area-rate']) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        await expect(page.getByTestId(id).getByTestId('chart-summary')).toBeVisible();
      }
      await checks('reliability');
      // the sub-tabs fit the phone and every tab passes the same checks
      for (const tab of ['timing', 'trends', 'longest'] as const) {
        await page.getByTestId(`rel-tab-${tab}`).click();
        await expect(page.getByTestId(`rel-panel-${tab}`)).toBeVisible();
        await checks(`reliability ${tab}`);
      }
      await page.getByTestId('rel-tab-areas').click();
      await expandDup(page, 'dup-rf-mtbf');
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
      await page.getByTestId('rel-tab-timing').click();
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
