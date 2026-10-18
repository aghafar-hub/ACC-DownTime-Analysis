// Owner-approved changes of 14 Oct: charts that repeat a Dashboard card folded on the other pages, Running hours on the
// KPI row, an (i) with formula on every chart and table card, the Pareto card 'Reasons for one equipment code' on the
// Equipment view, no rolling failure trend, and the reworked By area table with its split by classification.
import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function open(page: Page, path: string, testid: string) {
  await page.goto(`/#${path}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await expect(page.getByTestId('chart-summary').first().or(page.getByTestId('no-data'))).toBeVisible({ timeout: 20000 });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('collapsed sections: closed on load, open with click or keyboard, closed again on the next visit', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    // Pareto › Lines, areas and classes: the core Paretos open, the classification charts folded
    await open(page, '/pareto', 'page-pareto');
    await page.getByTestId('sub-area').click();
    for (const id of ['pareto-line-hours', 'pareto-area-hours']) await expect(page.getByTestId(id)).toBeVisible();
    for (const id of ['dup-pareto-class', 'dup-pareto-class-count']) {
      const sec = page.getByTestId(id);
      await expect(sec).toHaveAttribute('data-open', 'no');
      const head = sec.getByTestId(`${id}-toggle`);
      await expect(head).toHaveAttribute('aria-expanded', 'false');
      await expect(head).toContainText('Also on the Dashboard');
      expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }
    await expect(page.getByTestId('dup-pareto-class-toggle')).toContainText('Classifications by hours');
    await expect(page.getByTestId('pareto-class')).toHaveCount(0);
    await page.getByTestId('dup-pareto-class-toggle').click();
    await expect(page.getByTestId('dup-pareto-class-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('pareto-class').getByTestId('pareto-bar').first()).toBeVisible();
    await page.getByTestId('dup-pareto-class-count-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pareto-class-count')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pareto-class-count')).toHaveCount(0);
    // another view and back: folded again (not remembered)
    await page.getByTestId('sub-equipment').click();
    await page.getByTestId('sub-area').click();
    await expect(page.getByTestId('dup-pareto-class')).toHaveAttribute('data-open', 'no');

    // Reliability › Areas: the table open, the quadrant, the area x month heat map and the trend folded
    await open(page, '/reliability', 'page-reliability');
    await expect(page.getByTestId('area-table')).toBeVisible();
    for (const id of ['dup-area-quadrant', 'dup-area-month-heat', 'dup-area-trend']) await expect(page.getByTestId(id)).toHaveAttribute('data-open', 'no');
    await page.getByTestId('dup-area-trend-toggle').click();
    await expect(page.getByTestId('chart-availability')).toBeVisible();
    // Month vs month: folded, says it is also on the Dashboard
    await expect(page.getByTestId('reliability-mvm')).toHaveAttribute('data-open', 'no');
    await expect(page.getByTestId('reliability-mvm-also')).toHaveText('Also on the Dashboard');
    // Trends: Mean restoration time folded, the other monthly charts open
    await page.getByTestId('rel-tab-trends').click();
    await expect(page.getByTestId('chart-mtbf')).toBeVisible();
    await expect(page.getByTestId('dup-rel-mttr')).toHaveAttribute('data-open', 'no');
    await expect(page.getByTestId('chart-mttr')).toHaveCount(0);
    await page.getByTestId('dup-rel-mttr-toggle').click();
    await expect(page.getByTestId('chart-mttr').getByTestId('chart-summary')).toContainText('months have a value');
    // Repeated failures: nothing folded
    await open(page, '/repeats', 'page-repeats');
    await expect(page.locator('.dup-sec')).toHaveCount(0);
    // the Dashboard itself is unchanged: nothing folded
    await open(page, '/dashboard', 'page-overview');
    await expect(page.locator('.dup-sec')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Planned or incidental? shows whole lines: an Area or Equipment filter does not change it', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    const lineTotals = async () => {
      const card = page.getByTestId('chart-planned-line');
      await expect(card).toBeVisible({ timeout: 20000 });
      return card.getByTestId('split-row').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-line')}=${el.querySelector('.split-total')?.textContent}`));
    };
    await open(page, '/dashboard', 'page-overview');
    const all = await lineTotals();
    for (const area of ['K.1', 'RM.1']) {
      await open(page, `/dashboard?area=${area}`, 'page-overview');
      await expect(page.getByTestId('fb-chip-area-' + area)).toBeVisible();
      expect(await lineTotals(), area).toEqual(all);
      await expect(page.getByTestId('chart-planned-line')).toContainText('whole lines');
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Running hours inside the UF and MTBF tiles: scheduled minus stopped, and an (i) that says it is derived', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/dashboard', 'page-overview');
    const row = page.getByTestId('hero-kpis');
    await expect(row.locator('.ktile')).toHaveCount(6);
    // RF replaced availability; MTBF before MTTR; UF at the end carries the running hours (no tile of its own)
    expect(await row.locator('.ktile').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(
      ['kpi-total-hours', 'kpi-failure-count', 'kpi-reliability', 'kpi-mtbf', 'kpi-mttr', 'kpi-utilization']);
    await expect(page.getByTestId('kpi-reliability-value')).toHaveText(/^\d+\.\d%$/);
    await expect(page.getByTestId('kpi-reliability')).toContainText('Target 95%');
    await expect(page.getByTestId('kpi-reliability-target')).toHaveAttribute('data-state', /^(on|below)$/);
    await expect(page.getByTestId('kpi-utilization-value')).toHaveText(/^\d+\.\d%$/);
    await expect(page.getByTestId('kpi-utilization')).toContainText(/running of [\d,.]+ h/);
    const value = num(await page.getByTestId('kpi-uf-running').textContent());
    expect(value).toBeGreaterThan(0);
    // MTBF shows its own sum: running hours ÷ failures
    const failures = num(await page.getByTestId('kpi-failure-count-value').textContent());
    await expect(page.getByTestId('kpi-mtbf-calc')).toHaveText(/^[\d,.]+ h running ÷ [\d,]+ failures$/);
    const calc = (await page.getByTestId('kpi-mtbf-calc').textContent())!.match(/^([\d,.]+) h running ÷ ([\d,]+) failures$/)!;
    expect(num(calc[1]!)).toBeCloseTo(value, 1);
    expect(num(calc[2]!)).toBe(failures);
    expect(num(await page.getByTestId('kpi-mtbf-value').textContent())).toBeCloseTo(value / failures, 1);
    await page.getByTestId('kpi-utilization-info').click();
    const dlg = page.getByTestId('kpi-info');
    await expect(dlg).toContainText('NOT measured run hours');
    await expect(dlg).toContainText('Running hours = T − stopped hours');
    const here = (await dlg.textContent())!.match(/Here: ([\d.,]+) h × (\d+) days × (\d+) areas = ([\d.,]+) h scheduled − ([\d.,]+) h stopped = ([\d.,]+) h running/);
    expect(here, 'live example').not.toBeNull();
    const [, , , , T, S, R] = here!;
    expect(num(R!)).toBeCloseTo(value, 1);
    expect(num(T!) - num(S!)).toBeCloseTo(value, 0);
    // the stopped hours are the Total stoppage tile
    expect(num(S!)).toBeCloseTo(num(await page.getByTestId('kpi-total-hours-value').textContent()), 1);
    await page.getByTestId('kpi-info-close').click();
    // every card's (i): the formula and the same formula with the numbers on the card
    for (const id of ['total-hours', 'failure-count', 'reliability', 'mtbf', 'mttr', 'utilization']) {
      await page.getByTestId(`kpi-${id}-info`).click();
      const d = page.getByTestId('kpi-info');
      await expect(d.getByRole('heading', { name: 'Formula' })).toBeVisible();
      await expect(d.getByRole('heading', { name: 'With the numbers on this card' })).toBeVisible();
      await page.getByTestId('kpi-info-close').click();
    }
    await page.getByTestId('kpi-reliability-info').click();
    const rfLine = (await page.getByTestId('kpi-info').getByTestId('info-formula').allTextContents()).find((x) => /^RF = [\d,]/.test(x))!;
    expect(rfLine).toMatch(new RegExp(`= ${(await page.getByTestId('kpi-reliability-value').textContent())!.replace('%', '').replace('.', '\\.')}%$`));
    await page.getByTestId('kpi-info-close').click();
    // one row of six on a wide desktop
    const tops = await row.locator('.ktile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    // the Repeats card subtitle no longer says 'dots = days'
    await expect(page.getByTestId('chart-repeats')).not.toContainText('dots = days');
    await expect(page.getByTestId('chart-repeats').locator('.dcard-sub')).toContainText('same code + reason');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('(i) on every chart and table card: a dialog with what it shows, the formula and the numbers shown', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/dashboard', 'page-overview');
    // every Dashboard card has one, in its header
    const cards = page.getByTestId('dash-cards').locator('.dcard');
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(11);
    await expect(page.getByTestId('dash-cards').locator('.dcard-head [data-testid="chart-info"]')).toHaveCount(n);
    // MTTR card: the formula and the live example
    await page.getByTestId('chart-fail-mttr').getByTestId('chart-info').click();
    const dlg = page.getByTestId('chart-info-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('What it shows');
    await expect(dlg.getByTestId('info-formula').first()).toContainText('MTTR = sum of the failure events’ full durations ÷ number of failure events');
    await expect(dlg).toContainText('How it is calculated');
    await expect(dlg).toContainText('Freq 1 and Failure YES');
    await expect(dlg.getByTestId('info-sec-example')).toContainText(/Here: [A-Z][a-z]{2} \d{4}: [\d,.]+ h of failure ÷ \d+ failures = [\d.]+ h\./);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    // keyboard: the button opens it with Enter, Close returns focus
    const heatInfo = page.getByTestId('chart-avail-heat').getByTestId('chart-info');
    await heatInfo.focus();
    await page.keyboard.press('Enter');
    await expect(dlg.getByTestId('info-formula').first()).toHaveText('Availability B = (T − PL − INC − CIR) ÷ (T − PL)');
    await dlg.getByTestId('kpi-info-close').click();
    await expect(heatInfo).toBeFocused();

    // Pareto: the share of the largest bar in words
    await open(page, '/pareto', 'page-pareto');
    await page.getByTestId('pareto-eq-hours').getByTestId('chart-info').click();
    await expect(dlg).toContainText('Own-stop rule');
    await expect(dlg.getByTestId('info-sec-example')).toContainText(/Here: \S+ [\d,.]+ h ÷ [\d,.]+ h = [\d.]+%\./);
    await page.keyboard.press('Escape');
    for (const id of ['bucket-other', 'bucket-area', 'bucket-unknown', 'bucket-unassigned', 'pareto-reason-equipment']) await expect(page.getByTestId(id).getByTestId('chart-info')).toHaveCount(1);
    // Reliability, Repeated failures, Actions: every chart card and table card has its (i)
    for (const [path, testid] of [['/reliability', 'page-reliability'], ['/reliability?tab=timing', 'page-reliability'], ['/reliability?tab=trends', 'page-reliability'], ['/repeats', 'page-repeats']] as const) {
      await open(page, path, testid);
      const charts = page.locator('.chart-card');
      await expect(charts.first()).toBeVisible();
      expect(await charts.count(), path).toBe(await page.locator('.chart-card [data-testid="chart-info"]').count());
    }
    await expect(page.getByTestId('repeat-table-card').getByTestId('chart-info')).toBeVisible();
    await page.getByTestId('repeat-table-card').getByTestId('chart-info').click();
    await expect(dlg).toContainText('Avg h = total hours ÷ occurrences');
    await page.keyboard.press('Escape');
    await page.goto('/#/reliability?tab=longest');
    await expect(page.getByTestId('longest-card').getByTestId('chart-info')).toBeVisible({ timeout: 20000 });
    await page.goto('/#/actions');
    await expect(page.getByTestId('actions-summary')).toBeVisible({ timeout: 20000 });
    // backend 1.7.0: + Open tasks
    expect(await page.getByTestId('actions-summary').getByTestId('chart-info').count()).toBe(7);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Pareto: Reasons for one equipment code is on the Equipment view, after the Paretos and before the buckets', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/pareto', 'page-pareto');
    const ids = ['pareto-eq-hours', 'pareto-eq-count', 'pareto-reason-equipment', 'buckets'];
    const order = await page.locator(ids.map((i) => `[data-testid="${i}"]`).join(',')).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(ids);
    const card = page.getByTestId('pareto-reason-equipment');
    await expect(card.getByTestId('pareto-bar').first()).toBeVisible();
    const codes = await card.getByTestId('eq-code').locator('option').allTextContents();
    expect(codes.length).toBeGreaterThan(1);
    await card.getByTestId('eq-code').selectOption(codes[1]!);
    await expect(card.locator('.chart-sub')).toContainText(`Why does ${codes[1]} fail?`);
    await page.getByTestId('sub-reason').click();
    await expect(page.getByTestId('pareto-reason-hours')).toBeVisible();
    await expect(page.getByTestId('pareto-reason-equipment')).toHaveCount(0);
  });

  test('Repeated failures: the rolling failure trend is gone', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/repeats', 'page-repeats');
    await expect(page.getByTestId('chart-scatter')).toBeVisible();
    await expect(page.getByTestId('chart-rolling')).toHaveCount(0);
    await expect(page.getByText('Rolling failure trend')).toHaveCount(0);
  });

  test('Reliability › By area: column order, statuses in the cells, and a split by classification that adds up', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/reliability', 'page-reliability');
    const table = page.getByTestId('area-table');
    await expect(table.locator('thead th')).toHaveText(['Area', 'Operating h', 'Stopped h', 'Failure h', 'Failures', 'Availability (B)', 'RF', 'UF', 'MTBF h', 'MTTR h']);
    const rows = page.getByTestId('area-row');
    // the row with most failures
    const counts = await rows.getByTestId('area-failures').allTextContents();
    const i = counts.map(num).reduce((b, v, k, a) => (v > a[b]! ? k : b), 0);
    const row = rows.nth(i);
    // operating + stopped = scheduled time, the same for every area (24 h x days)
    const sched = await rows.evaluateAll((trs) => trs.map((tr) => {
      const n = (s: string | null | undefined) => Number((s ?? '').replace(/,/g, '').match(/[\d.]+/)?.[0] ?? 'NaN');
      return n(tr.querySelector('[data-testid="area-operating"]')?.textContent) + n(tr.querySelector('[data-testid="area-stopped"]')?.textContent);
    }));
    for (const v of sched) expect(v).toBeCloseTo(sched[0]!, 0);

    const check = async (testid: string, keys: string[]) => {
      const cell = row.getByTestId(testid);
      const shown = num(await cell.textContent());
      await cell.click();
      const pop = page.getByTestId('breakdown-pop');
      await expect(pop).toBeVisible();
      await expect(cell).toHaveAttribute('aria-expanded', 'true');
      await expect(pop.getByTestId('breakdown-row')).toHaveCount(keys.length);
      expect(await pop.getByTestId('breakdown-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')))).toEqual(keys);
      const values = (await pop.getByTestId('breakdown-value').allTextContents()).map(num);
      expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(shown, 5);
      expect(num(await pop.getByTestId('breakdown-total').textContent())).toBeCloseTo(shown, 5);
      if (shown > 0) expect((await pop.getByTestId('breakdown-pct').allTextContents()).map(num).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
      // inside the window
      const box = (await pop.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1440);
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
      await expect(cell).toBeFocused();
      return values;
    };
    await check('area-stopped', ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR']);
    const fh = await check('area-failure-hours', ['PRO', 'MEC', 'ELE', 'AUT']);
    expect(fh.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const fc = await check('area-failures', ['PRO', 'MEC', 'ELE', 'AUT']);
    expect(fc.every((v) => Number.isInteger(v))).toBe(true);
    // keyboard: Enter opens; hover with the mouse opens too
    await row.getByTestId('area-failures').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('breakdown-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await row.getByTestId('area-stopped').hover();
    await expect(page.getByTestId('breakdown-pop')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.getByTestId('breakdown-pop')).toHaveCount(0);
    // the Failure h of the areas add up to the Areas Pareto (P1 attribution)
    const total = (await rows.getByTestId('area-failure-hours').allTextContents()).map(num).reduce((a, b) => a + b, 0);
    await open(page, '/pareto', 'page-pareto');
    await page.getByTestId('sub-area').click();
    const summary = (await page.getByTestId('pareto-area-hours').getByTestId('chart-summary').textContent()) ?? '';
    expect(num(summary.match(/([\d,]+(?:\.\d+)?) \S+ in total/)?.[1] ?? null)).toBeCloseTo(total, 0);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });

    test(`KPI row, folded sections, (i) sheet and the By area split at ${width}px: no sideways scroll, 44 px targets, 12 px text`, async ({ page }) => {
      const errors = watchConsole(page);
      await stubFonts(page);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      const checks = async (label: string) => {
        expect((await noSidewaysScroll(page)).ok, `${label} sideways scroll`).toBe(true);
        expect(await smallTargets(page), `${label} targets`).toEqual([]);
        expect(await smallText(page), `${label} text`).toEqual([]);
      };
      await open(page, '/dashboard', 'page-overview');
      const tiles = page.getByTestId('hero-kpis').locator('.ktile');
      await expect(tiles).toHaveCount(6);
      // three rows of two
      const tops = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(3);
      await checks('dashboard');
      // the (i) of a chart is a sheet from the bottom
      const info = page.getByTestId('chart-class').getByTestId('chart-info');
      await info.scrollIntoViewIfNeeded();
      await info.tap();
      const dlg = page.getByTestId('chart-info-dialog');
      await expect(dlg).toBeVisible();
      const box = (await dlg.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(799);
      expect(Math.round(box.width)).toBe(width);
      await checks('chart info sheet');
      await dlg.getByTestId('kpi-info-close').tap();
      await expect(dlg).toHaveCount(0);
      // the sheet's Back entry is dropped right after it closes (useBackClose): wait before navigating
      await expect.poll(() => page.evaluate(() => (history.state as { accSheet?: string } | null)?.accSheet ?? null)).toBeNull();

      await open(page, '/reliability', 'page-reliability');
      await expect(page.getByTestId('dup-area-quadrant')).toHaveAttribute('data-open', 'no');
      await checks('reliability folded');
      const cell = page.getByTestId('area-row').first().getByTestId('area-stopped');
      await cell.scrollIntoViewIfNeeded();
      await cell.tap();
      const pop = page.getByTestId('breakdown-pop');
      await expect(pop).toBeVisible();
      const pb = (await pop.boundingBox())!;
      expect(pb.x).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width).toBeLessThanOrEqual(width);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await page.getByTestId('areas-block').getByRole('heading', { name: 'Areas', exact: true }).tap();
      await expect(pop).toHaveCount(0);
      await page.getByTestId('dup-area-quadrant-toggle').tap();
      await expect(page.getByTestId('chart-area-quadrant')).toBeVisible();
      await checks('reliability quadrant open');
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}

test.describe('tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test('KPI row: two rows of three', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await open(page, '/dashboard', 'page-overview');
    const tops = await page.getByTestId('hero-kpis').locator('.ktile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(6);
    expect(new Set(tops).size).toBe(2);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });
});
