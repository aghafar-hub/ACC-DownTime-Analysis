import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// Targets (availability, MTBF, MTTR), Month vs month and the data-quality scorecard.

const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function open(page: Page, path: string, testid: string) {
  await page.goto(`/#${path}`);
  await expect(page.getByTestId(testid)).toBeVisible();
  await expect(page.getByTestId('chart-summary').first().or(page.getByTestId('no-data'))).toBeVisible({ timeout: 20000 });
}

/** Settings > Calculations > Targets, as the admin in the mock. */
async function setTargets(page: Page, t: { avail?: string; mtbf?: string; mttr?: string }) {
  await page.goto('/#/settings/calculations');
  await expect(page.getByTestId('settings-calculations')).toBeVisible();
  if (t.avail !== undefined) await page.getByTestId('set-availability_target_pct').fill(t.avail);
  if (t.mtbf !== undefined) await page.getByTestId('set-target_mtbf_h').fill(t.mtbf);
  if (t.mttr !== undefined) await page.getByTestId('set-target_mttr_h').fill(t.mttr);
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
}

async function as(page: Page, role: Role) {
  await stubFonts(page);
  await page.goto('/');
  await signInAndWait(page, role);
}

test.describe('targets', () => {
  test('nothing about targets is shown while they are blank', async ({ page }) => {
    const errors = watchConsole(page);
    await as(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    for (const id of ['kpi-availability-target', 'kpi-mttr-target', 'below-target-count', 'hbars-extra-ref']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('kpi-availability')).not.toContainText('Target');
    await open(page, '/reliability', 'page-reliability');
    await expect(page.getByTestId('area-table')).toBeVisible();
    for (const id of ['status-availability', 'status-mtbf', 'status-mttr']) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('area-table').locator('th')).not.toContainText(['MTBF status']);
    await expect(page.getByTestId('chart-area-mtbf').getByTestId('hbars-ref')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('set by the admin: statuses in words and symbols on the KPIs, the area chart, the table and the info dialogs', async ({ page }) => {
    const errors = watchConsole(page);
    await as(page, 'admin');
    // blank is accepted, a bad value is explained
    await page.goto('/#/settings/calculations');
    await page.getByTestId('set-target_mtbf_h').fill('0');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-target_mtbf_h')).toBeVisible();
    await setTargets(page, { avail: '99.9', mtbf: '200', mttr: '0.5' });

    await open(page, '/overview', 'page-overview');
    const av = page.getByTestId('kpi-availability-target');
    await expect(av).toBeVisible();
    await expect(av).toHaveText(/Target 99\.9%: (on|below) target \([+−]?\d+\.\d pts\)/);
    await expect(av.locator('.target-sym')).toHaveText(/[✔▼]/);
    const mttr = page.getByTestId('kpi-mttr-target');
    await expect(mttr).toHaveText(/Target 0\.5 h: (on|above) target \([+−]?\d+\.\d\d h\)/);
    await expect(mttr.locator('.target-sym')).toHaveText(/[✔▲]/);

    // availability per area: the count line, the target line and the striped bars
    await expect(page.getByTestId('below-target-count')).toHaveText(/^\d+ of \d+ areas below target/);
    const chart = page.getByTestId('chart-area-availability');
    await expect(chart.getByTestId('chart-summary')).toContainText(/\d+ of \d+ areas below target \(99\.9%\)/);
    await expect(chart.getByTestId('hbars-extra-ref')).toContainText('Target 99.9%');
    await expect(chart.locator('rect[fill^="url(#hb-"]').first()).toBeVisible(); // below target: striped
    await expect(chart.getByTestId('chart-legend')).toContainText('Below target');
    await chart.getByTestId('view-table').click();
    await expect(chart.locator('table th', { hasText: 'Status' })).toBeVisible();
    await expect(chart.locator('table')).toContainText('Below target');

    // info dialogs mention the target
    await page.getByTestId('kpi-availability-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('Target: 99.9%');
    await page.getByTestId('kpi-info-close').click();
    await page.getByTestId('kpi-mttr-info').click();
    await expect(page.getByTestId('kpi-info')).toContainText('Target: 0.5 h');
    await page.getByTestId('kpi-info-close').click();

    // MTBF status only for a single area
    await expect(page.getByTestId('kpi-mtbf-target')).toHaveCount(0);
    await page.goto('/#/overview?area=K.1');
    await expect(page.getByTestId('page-overview')).toBeVisible();
    await expect(page.getByTestId('kpi-mtbf')).toBeVisible();
    await expect(page.getByTestId('kpi-mtbf-target')).toHaveText(/Target 200 h: (on|below) target \([+−]?\d+\.\d h\)/);

    // Reliability (all areas again): dashed target lines, status columns (words + symbol) per area, counts in the summaries
    await open(page, '/reliability?r=last90', 'page-reliability');
    const rows = page.getByTestId('area-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(1);
    await expect(page.getByTestId('area-table').locator('th', { hasText: 'MTBF status' })).toBeVisible();
    await expect(page.getByTestId('status-availability')).toHaveCount(n);
    await expect(page.getByTestId('status-mtbf')).toHaveCount(n);
    await expect(page.getByTestId('status-mttr')).toHaveCount(n);
    for (const c of await page.getByTestId('status-availability').all()) await expect(c).toHaveText(/^(–|[✔▼] (On|Below) target)/);
    for (const c of await page.getByTestId('status-mttr').all()) await expect(c).toHaveText(/^(–|[✔▲] (On|Above) target)/);
    await expect(page.getByTestId('chart-area-mtbf').getByTestId('hbars-ref')).toContainText('Target 200 h');
    await expect(page.getByTestId('chart-area-mttr').getByTestId('hbars-ref')).toContainText('Target 0.5 h');
    await expect(page.getByTestId('chart-area-mtbf').getByTestId('chart-summary')).toContainText(/\d+ of \d+ areas below the target of 200 h/);
    await expect(page.getByTestId('chart-area-mttr').getByTestId('chart-summary')).toContainText(/\d+ of \d+ areas above the target of 0\.5 h/);
    await page.getByTestId('chart-area-mtbf').getByTestId('view-table').click();
    await expect(page.getByTestId('chart-area-mtbf').locator('th', { hasText: 'Status' })).toBeVisible();

    // blank again: everything disappears
    await setTargets(page, { avail: '', mtbf: '', mttr: '' });
    await open(page, '/overview', 'page-overview');
    await expect(page.getByTestId('kpi-availability-target')).toHaveCount(0);
    await expect(page.getByTestId('below-target-count')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a target everybody meets reads on target with a tick; the alert uses the same availability target', async ({ page }) => {
    await as(page, 'admin');
    await setTargets(page, { avail: '1', mttr: '99999' });
    await open(page, '/overview', 'page-overview');
    await expect(page.getByTestId('kpi-availability-target')).toHaveText(/Target 1%: on target \(\+\d+\.\d pts\)/);
    await expect(page.getByTestId('kpi-availability-target')).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('kpi-mttr-target')).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('below-target-count')).toHaveText(/^0 of \d+ areas below target/);
    // Settings > Notifications has no second availability target any more
    await page.goto('/#/settings/notifications');
    await expect(page.getByTestId('set-notif_long_stop_hours')).toBeVisible();
    await expect(page.getByTestId('set-notif_availability_target_pct')).toHaveCount(0);
  });
});

test.describe('month vs month', () => {
  test('collapsed by default; table, chart, URL and numbers equal the single-month dashboard', async ({ page }) => {
    const errors = watchConsole(page);
    await as(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    const sec = page.getByTestId('overview-mvm');
    await expect(sec).toHaveAttribute('data-open', 'no');
    await page.getByTestId('overview-mvm-toggle').click();
    await expect(sec).toHaveAttribute('data-open', 'yes');
    const a = page.getByTestId('overview-mvm-a');
    const b = page.getByTestId('overview-mvm-b');
    // defaults: the last two COMPLETE months (months are listed newest first; the demo data ends inside the latest one)
    const opts = await a.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(opts.length).toBeGreaterThan(3);
    await expect(a).toHaveValue(opts[1]!);
    await expect(b).toHaveValue(opts[2]!);
    await expect(sec.getByTestId('mvm-perday')).toHaveCount(0);
    const rows = sec.getByTestId('mvm-row');
    await expect(rows).toHaveCount(10);
    const labels = await rows.locator('th').allTextContents();
    expect(labels).toEqual(['Stoppage hours', 'Failure hours', 'Planned hours', 'Other hours', 'Failure count', 'Operating hours', 'Availability (basis B)', 'MTTR', 'MTBF, all areas (area-hours)', 'Repeated failures']);
    // the change reads as arrow + sign + words
    await expect(rows.first().getByTestId('mvm-change')).toHaveText(/^[▲▼■] .*(better|worse|no change)/);
    await expect(sec.getByTestId('chart-mvm-hours')).toBeVisible();
    await expect(sec.getByTestId('chart-mvm-count')).toBeVisible();
    await expect(sec.getByTestId('chart-mvm-hours').getByTestId('chart-summary')).toContainText(/\d+ areas\./);
    await sec.getByTestId('chart-mvm-hours').getByTestId('view-table').click();
    await expect(sec.getByTestId('chart-mvm-hours').locator('table')).toBeVisible();

    // a month in progress against a whole one: per-day rates and no better / worse verdict
    await a.selectOption(opts[0]!);
    await expect(sec.getByTestId('mvm-perday')).toBeVisible();
    await expect(rows.first().getByTestId('mvm-a')).toContainText('h/day');
    await expect(rows.first().getByTestId('mvm-change')).not.toContainText(/better|worse/);
    for (const txt of await sec.getByTestId('mvm-change').allTextContents()) expect(txt).not.toMatch(/better|worse/);

    // choose months: the address carries them and survives a reload
    await a.selectOption(opts[2]!);
    await b.selectOption(opts[3] ?? opts[1]!);
    await expect(page).toHaveURL(new RegExp(`mvm=${opts[2]}%2C${opts[3] ?? opts[1]}|mvm=${opts[2]},${opts[3] ?? opts[1]}`));
    const stoppageA = num(await rows.first().getByTestId('mvm-a').textContent());
    const stoppageB = num(await rows.first().getByTestId('mvm-b').textContent());
    await page.reload();
    await expect(page.getByTestId('overview-mvm')).toHaveAttribute('data-open', 'yes'); // the pair in the address opens it
    await expect(page.getByTestId('overview-mvm-a')).toHaveValue(opts[2]!);

    // the same numbers as the Overview with its range set to each single month
    for (const [month, want] of [[opts[2]!, stoppageA], [opts[3] ?? opts[1]!, stoppageB]] as const) {
      await open(page, `/overview?r=month&m=${month}`, 'page-overview');
      expect(num(await page.getByTestId('kpi-total-hours-value').textContent()), month).toBeCloseTo(want, 1);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('respects the line filter and ignores the date range and comparison; mirrored on Reliability', async ({ page }) => {
    const errors = watchConsole(page);
    await as(page, 'engineer');
    await open(page, '/overview', 'page-overview');
    await page.getByTestId('overview-mvm-toggle').click();
    const first = async () => num(await page.getByTestId('overview-mvm').getByTestId('mvm-row').first().getByTestId('mvm-a').textContent());
    const month = await page.getByTestId('overview-mvm-a').inputValue();
    const all = await first();
    expect(all).toBeGreaterThan(0);

    await open(page, `/overview?line=L.1&mvm=${month},${month}`, 'page-overview');
    const withLine = await first();
    expect(withLine).toBeLessThan(all);
    await open(page, `/overview?line=L.1&r=month&m=${month}`, 'page-overview');
    expect(num(await page.getByTestId('kpi-total-hours-value').textContent())).toBeCloseTo(withLine, 1);

    // another date range and no comparison: the section does not change
    await open(page, `/overview?line=L.1&r=last7&cmp=none&mvm=${month},${month}`, 'page-overview');
    expect(await first()).toBeCloseTo(withLine, 6);

    // Reliability has the same section and the same numbers
    await open(page, `/reliability?line=L.1&mvm=${month},${month}`, 'page-reliability');
    await expect(page.getByTestId('reliability-mvm')).toHaveAttribute('data-open', 'yes');
    expect(num(await page.getByTestId('reliability-mvm').getByTestId('mvm-row').first().getByTestId('mvm-a').textContent())).toBeCloseTo(withLine, 6);
    // changing a filter keeps the pair in the address
    await expect(page).toHaveURL(/mvm=/);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('data quality scorecard', () => {
  test('Validate: a row per month with text and bar, links filter the list by month; Overview card links to Validate', async ({ page }) => {
    const errors = watchConsole(page);
    await as(page, 'engineer');
    await page.goto('/#/validate');
    await expect(page.getByTestId('quality-table')).toBeVisible();
    const rows = page.getByTestId('quality-row');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const r of await rows.all()) {
      await expect(r.getByTestId('q-clean')).toHaveText(/^\d+\.\d%$/);
      await expect(r.locator('.q-bar')).toHaveAttribute('aria-label', /clean$/);
    }
    await expect(page.getByTestId('quality-total')).toContainText('All months');
    // a month with something to check: the link filters the list
    const target = rows.filter({ has: page.locator('[data-testid=q-open]', { hasNotText: /^0$/ }) }).first();
    const month = (await target.getAttribute('data-month'))!;
    const open = num(await target.getByTestId('q-open').textContent());
    expect(open).toBeGreaterThan(0);
    await target.getByTestId('q-link').click();
    await expect(page).toHaveURL(new RegExp(`validate\\?month=${month}`));
    await expect(page.getByTestId('d-month')).toHaveValue(month);
    const listed = await page.getByTestId('v-row').count();
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThanOrEqual(open);

    await page.goto('/#/overview');
    const mini = page.getByTestId('quality-mini');
    await expect(mini).toBeVisible();
    await expect(page.getByTestId('quality-mini-text')).toHaveText(/^Data quality: \d+\.\d% clean, [\d,]+ to check$/);
    await page.getByTestId('quality-mini-open').click();
    await expect(page.getByTestId('page-validate')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the Overview card is also there for a viewer, who can open Validate', async ({ page }) => {
    await as(page, 'viewer');
    await open(page, '/overview', 'page-overview');
    await expect(page.getByTestId('quality-mini')).toBeVisible();
  });
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    test(`targets, month vs month and the scorecard fit at ${width}px`, async ({ page }) => {
      const errors = watchConsole(page);
      await as(page, 'admin');
      await setTargets(page, { avail: '99.9', mtbf: '200', mttr: '0.5' });
      const checks = async (label: string) => {
        expect((await noSidewaysScroll(page)).ok, `${label} sideways scroll`).toBe(true);
        expect(await smallTargets(page), `${label} targets`).toEqual([]);
        expect(await smallText(page), `${label} text`).toEqual([]);
      };
      await open(page, '/overview', 'page-overview');
      await expect(page.getByTestId('kpi-availability-target')).toBeVisible();
      await expect(page.getByTestId('overview-mvm')).toHaveAttribute('data-open', 'no'); // collapsed on a phone
      await checks('overview');
      await page.getByTestId('overview-mvm-toggle').click();
      await expect(page.getByTestId('chart-mvm-hours')).toBeVisible();
      await expect(page.getByTestId('overview-mvm-cards').getByTestId('mvm-row')).toHaveCount(10);
      await expect(page.getByTestId('overview-mvm-cards').getByTestId('mvm-change').first()).toHaveText(/^[▲▼■] /);
      await checks('overview + month vs month');
      await page.getByTestId('sec-where-toggle').click();
      await expect(page.getByTestId('below-target-count')).toBeVisible();
      await checks('overview + availability chart');
      await open(page, '/reliability', 'page-reliability');
      await expect(page.getByTestId('status-availability').first()).toBeVisible();
      await checks('reliability');
      await page.goto('/#/validate');
      await expect(page.getByTestId('quality-details')).toBeVisible();
      await page.getByTestId('quality-details').locator('summary').click();
      await expect(page.getByTestId('quality-list')).toBeVisible();
      await expect(page.getByTestId('quality-row').first().getByTestId('q-clean')).toHaveText(/^\d+\.\d%$/);
      await checks('validate scorecard');
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
