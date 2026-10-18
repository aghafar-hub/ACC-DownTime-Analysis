import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// Reports page (R1): access, builder controls, building exactly the chosen sections, filters, numbers equal to the
// dashboards, the printed PDF and the phone. Runs against `vite preview` in mock mode (made-up data).

const ready = (page: Page) => page.locator('[data-testid=report][data-ready=true]');
const sectionCount = async (page: Page) => Number(await page.getByTestId('report').getAttribute('data-sections'));

async function openBuilder(page: Page, role: Role, query = '') {
  await signInAndWait(page, role);
  await page.goto(`/#/reports${query ? `?${query}` : ''}`);
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page.getByTestId('rb-scope')).toContainText('area-hours in scope');
}
async function openReport(page: Page, role: Role, query: string) {
  await signInAndWait(page, role);
  await page.goto(`/#/reports?${query}&v=report`);
  await ready(page).waitFor({ timeout: 60_000 });
}
const kpiNumber = async (page: Page, id: string) => (await page.getByTestId(`rpt-kpi-${id}-value`).textContent())!.trim();

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => {
    expect(errors, 'console errors').toEqual([]);
  });

  for (const role of ['admin', 'manager', 'engineer', 'viewer'] as Role[]) {
    test(`${role}: Reports is in the left rail under its own heading and the builder opens`, async ({ page }) => {
      await signInAndWait(page, role);
      const rail = page.getByRole('navigation', { name: 'Primary' });
      await expect(page.getByTestId('rail-section-reports')).toHaveText('Reports');
      await expect(rail.locator('[data-section="reports"] a')).toHaveCount(1);
      await rail.locator('[data-section="reports"] a').click();
      await expect(page).toHaveURL(/#\/reports/);
      await expect(page.getByTestId('page-reports')).toBeVisible();
      await expect(page.getByTestId('builder')).toBeVisible();
      // one page in its section: no tab row
      await expect(page.getByTestId('page-tabs')).toHaveCount(0);
      await expect(page.getByTestId('breadcrumb')).toContainText('Reports');
    });
  }

  test('Hidden removes the page; View still builds', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/users');
    await page.getByTestId('user-row').filter({ hasText: 'Demo Viewer' }).getByRole('button', { name: /Open Demo Viewer/ }).click();
    await expect(page.getByTestId('default-reports')).toContainText('Role default: View');
    await expect(page.getByTestId('access-reports-View')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('access-reports-Hidden').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Page access saved');
    await page.getByTestId('user-close').click();
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await expect(page.getByTestId('rail-section-reports')).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = '#/reports'; });
    await expect(page.getByTestId('no-access')).toBeVisible();
    // engineer (View) can build
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('login-email').fill('engineer@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.evaluate(() => { window.location.hash = '#/reports?s=summary&v=report'; });
    await ready(page).waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('rpt-kpis')).toBeVisible();
  });

  test('builder: template, period, filters, sections and options all work', async ({ page }) => {
    await openBuilder(page, 'manager');
    // template chips
    for (const id of ['monthly', 'area', 'failure', 'custom']) await expect(page.getByTestId(`rb-tpl-${id}`)).toBeVisible();
    await expect(page.getByTestId('rb-tpl-monthly')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-sec-count')).toContainText('19 of 19');
    await page.getByTestId('rb-tpl-area').click();
    await expect(page.getByTestId('rb-tpl-area')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-period-last3')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-sec-mtbf_mttr')).toBeChecked();
    await expect(page.getByTestId('rb-sec-events')).not.toBeChecked();
    await page.getByTestId('rb-tpl-failure').click();
    await expect(page.getByTestId('rb-sec-events')).toBeChecked();
    await expect(page.getByTestId('rb-sec-availability')).not.toBeChecked();
    // changing a section turns the template into Custom
    await page.getByTestId('rb-sec-availability').check();
    await expect(page.getByTestId('rb-tpl-custom')).toHaveAttribute('aria-pressed', 'true');
    // period presets and the custom range
    await page.getByTestId('rb-tpl-monthly').click();
    await expect(page.getByTestId('rb-period-text')).toContainText('1–30 Sep 2026');
    await expect(page.getByTestId('rb-period-text')).toContainText('1–31 Aug 2026');
    await page.getByTestId('rb-period-thismonth').click();
    await expect(page.getByTestId('rb-period-text')).toContainText('1 Oct 2026');
    await page.getByTestId('rb-period-ytd').click();
    await expect(page.getByTestId('rb-period-text')).toContainText('Same dates last year');
    await page.getByTestId('rb-period-custom').click();
    await page.getByTestId('rb-from').fill('2026-03-01');
    await page.getByTestId('rb-to').fill('2026-03-31');
    await expect(page.getByTestId('rb-period-text')).toContainText('1–31 Mar 2026');
    await expect(page.getByTestId('rb-period-text')).toContainText('1–28 Feb 2026');
    await page.getByTestId('rb-compare').click();
    await expect(page.getByTestId('rb-compare')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('rb-sum-compare')).toHaveText('No comparison');
    await page.getByTestId('rb-compare').click();
    await page.getByTestId('rb-period-lastmonth').click();
    // select all / none and the count
    await page.getByTestId('rb-sec-none').click();
    await expect(page.getByTestId('rb-sec-count')).toContainText('0 of 19');
    await expect(page.getByTestId('rb-build')).toBeDisabled();
    await expect(page.getByTestId('rb-none')).toBeVisible();
    await page.getByTestId('rb-sec-all').click();
    await expect(page.getByTestId('rb-sec-count')).toContainText('19 of 19');
    await expect(page.getByTestId('rb-build')).toBeEnabled();
    // every group and every section has a description; options only appear for ticked sections
    for (const g of ['summary', 'performance', 'causes', 'reliability', 'detail']) await expect(page.getByTestId(`rb-group-${g}`)).toBeVisible();
    await expect(page.getByTestId('rb-secrow-top_equipment').locator('small')).not.toBeEmpty();
    await page.getByTestId('rb-opt-top_equipment-top-5').click();
    await page.getByTestId('rb-opt-top_equipment-measure-count').click();
    await page.getByTestId('rb-opt-events-top-all').click();
    await expect(page.getByTestId('rb-opt-top_equipment-top-5')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('rb-sec-top_equipment').uncheck();
    await expect(page.getByTestId('rb-opt-top_equipment-top-5')).toHaveCount(0);
    await page.getByTestId('rb-sec-top_equipment').check();
  });

  test('filters: line, area, equipment (search by code or description), classification, criticality, failures only, as removable chips with a live count', async ({ page }) => {
    await openBuilder(page, 'manager');
    const events = async () => Number(/^([\d,]+) events/.exec((await page.getByTestId('rb-scope').textContent())!)![1]!.replace(/,/g, ''));
    const all = await events();
    await page.getByTestId('rb-line').click();
    await page.getByTestId('rb-line-opt').first().check();
    const line = await events();
    expect(line).toBeLessThan(all);
    await expect(page.getByTestId('rb-active').locator('.chip').first()).toContainText('Line');
    await page.getByTestId('rb-area').click();
    await page.getByTestId('rb-area-opt').first().check();
    const area = await events();
    expect(area).toBeLessThan(line);
    // equipment search by description text
    await page.getByTestId('rb-code').click();
    await page.getByTestId('rb-code-search').fill('conveyor');
    const hit = page.getByTestId('rb-code-opt').first();
    await expect(hit).toBeVisible();
    await hit.check();
    expect(await events()).toBeLessThan(area);
    await page.getByTestId('rb-code-search').fill('');
    await page.getByTestId('rb-cls-MEC').click();
    await page.getByTestId('rb-crit-INC').click();
    await page.getByTestId('rb-fail').click();
    await expect(page.getByTestId('rb-fail')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-sum-filters')).toContainText('6 active');
    // chips remove a filter; Clear all removes the rest
    await page.getByTestId('rb-chip-fail').click();
    await expect(page.getByTestId('rb-fail')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('rb-reset-filters').click();
    await expect(page.getByTestId('rb-active')).toHaveCount(0);
    expect(await events()).toBe(all);
  });

  test('Use current dashboard filters copies the shared scope (period, line, area, type) into the setup and names what a report cannot filter', async ({ page }) => {
    await signInAndWait(page, 'manager');
    await page.goto('/#/dashboard?r=month&m=2026-08&line=L.1&area=K.1&cls=MEC&fail=1&reason=belt');
    await expect(page.getByTestId('scope-period')).toContainText('Aug 2026');
    await page.getByTestId('rail-link-reports').click();
    await expect(page.getByTestId('builder')).toBeVisible();
    await expect(page.getByTestId('rb-active')).toHaveCount(0);
    await page.getByTestId('rb-use-dash').click();
    await expect(page.getByTestId('rb-period-custom')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-from')).toHaveValue('2026-08-01');
    await expect(page.getByTestId('rb-to')).toHaveValue('2026-08-31');
    for (const id of ['line-L.1', 'area-K.1', 'cls-MEC', 'fail']) await expect(page.getByTestId(`rb-chip-${id}`)).toBeVisible();
    await expect(page.getByTestId('rb-use-dash-note')).toContainText('Not in a report: reason');
    await expect(page.getByTestId('rb-period-text')).toContainText('1–31 Aug 2026');
    await expect(page.getByTestId('rb-compare')).toHaveAttribute('aria-checked', 'true');
    // the setup is in the address like any other
    await expect(page).toHaveURL(/p=custom.*from=2026-08-01.*to=2026-08-31/);
  });

  test('the setup is kept in the URL: reload restores it, a copied link opens it, Edit setup comes back to it', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await openBuilder(page, 'manager', 'tpl=custom&p=last3&cmp=0&area=CR&cls=MEC&fail=1&s=summary,daily,events&o=events:10');
    await expect(page.getByTestId('rb-tpl-custom')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-period-last3')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-compare')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('rb-chip-area-CR')).toBeVisible();
    await expect(page.getByTestId('rb-fail')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('rb-sec-count')).toContainText('3 of 19');
    await expect(page.getByTestId('rb-opt-events-top-10')).toHaveAttribute('aria-pressed', 'true');
    // change something, copy the link, open it fresh
    await page.getByTestId('rb-sec-quality').check();
    await page.getByTestId('rb-copy-link').click();
    await expect(page.getByTestId('rb-copied')).toContainText('Link copied');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('#/reports?');
    expect(link).toContain('area=CR');
    expect(link).toContain('s=summary%2Cdaily%2Cevents%2Cquality');
    await page.goto(link);
    await expect(page.getByTestId('rb-sec-count')).toContainText('4 of 19');
    await expect(page.getByTestId('rb-chip-area-CR')).toBeVisible();
    // build, then Edit setup returns to the same setup
    await page.getByTestId('rb-build').click();
    await ready(page).waitFor({ timeout: 60_000 });
    await page.getByTestId('report-edit').click();
    await expect(page.getByTestId('builder')).toBeVisible();
    await expect(page.getByTestId('rb-sec-count')).toContainText('4 of 19');
    await expect(page.getByTestId('rb-chip-area-CR')).toBeVisible();
    // browser Back from the builder after Build goes to the report
    await page.goBack();
    await expect(page.getByTestId('report-view')).toBeVisible();
  });

  test('Build produces exactly the chosen sections, with contents, headings and page numbers', async ({ page }) => {
    await openBuilder(page, 'manager');
    await page.getByTestId('rb-sec-none').click();
    for (const id of ['cover', 'summary', 'daily', 'availability', 'quality']) await page.getByTestId(`rb-sec-${id}`).check();
    await page.getByTestId('rb-build').click();
    await ready(page).waitFor({ timeout: 60_000 });
    expect(await sectionCount(page)).toBe(5);
    await expect(page.getByTestId('rpt-cover')).toBeVisible();
    await expect(page.getByTestId('rpt-title')).toHaveText('Custom');
    const toc = page.getByTestId('rpt-toc-link');
    await expect(toc).toHaveCount(4);
    await expect(toc).toHaveText([/Executive summary\s*3/, /Daily stopped hours\s*4/, /Availability by area\s*\d+/, /Data-quality appendix\s*\d+/]);
    const headings = await page.locator('.rpt-h2').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    expect(headings).toEqual(['Contents', 'Executive summary', 'Daily stopped hours', 'Availability by area', 'Data-quality appendix']);
    await expect(page.getByTestId('rpt-chart-monthly')).toHaveCount(0);
    await expect(page.getByTestId('rpt-chart-top_equipment')).toHaveCount(0);
    // page numbers match the contents and the total
    const total = Number(await page.getByTestId('report').getAttribute('data-pages'));
    await expect(page.getByTestId('rpt-page')).toHaveCount(total);
    await expect(page.getByTestId('rpt-page-no').last()).toHaveText(`Page ${total} of ${total}`);
    const qualityPage = Number((await toc.last().locator('.rpt-toc-page').textContent())!);
    const where = await page.locator('#rpt-sec-quality').evaluate((el) => Number((el.closest('[data-testid=rpt-page]') as HTMLElement).dataset.page));
    expect(where).toBe(qualityPage);
    // clicking a contents entry scrolls there without leaving the report
    await toc.last().click();
    await expect(page).toHaveURL(/#\/reports\?/);
    await expect(page.getByTestId('report-info')).toContainText('sections');
  });

  test('executive summary: KPI strip, change vs previous period, takeaways from real numbers, no dead buttons', async ({ page }) => {
    await openReport(page, 'manager', 'tpl=custom&p=lastmonth&cmp=1&s=summary,quality');
    await expect(page.getByTestId('rpt-kpi-stoppage')).toBeVisible();
    await expect(page.getByTestId('rpt-kpi-stoppage-change')).toContainText(/vs|▲|▼|%/);
    await expect(page.getByTestId('rpt-kpi-stoppage-change')).toContainText(/worse|better|no change/);
    await expect(page.getByTestId('rpt-findings').locator('li')).toHaveCount(5);
    await expect(page.getByTestId('rpt-takeaway').first()).toContainText('area-hours stopped');
    await expect(page.getByTestId('rpt-q-records')).toBeVisible();
    // actions: Edit setup, Copy link, Download Excel, Download CSV (a menu), Create action (Edit on Actions), Print
    const bar = page.getByTestId('report-toolbar');
    await expect(bar.getByRole('button')).toHaveText([/Edit setup/, /Copy link/, /Download Excel/, /Download CSV/, /Create action/, /Send by email/, /Print \/ Save as PDF/]);
  });

  test('filters narrow the report: line, area and equipment change the numbers and the cover says so', async ({ page }) => {
    await openReport(page, 'manager', 'tpl=custom&p=lastmonth&s=cover,summary');
    const all = await kpiNumber(page, 'stoppage');
    await expect(page.getByTestId('rpt-cover-filters')).toHaveText('All lines, areas and equipment');
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary&line=L.1&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    const line = await kpiNumber(page, 'stoppage');
    expect(parseFloat(line.replace(/,/g, ''))).toBeLessThan(parseFloat(all.replace(/,/g, '')));
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary&line=L.1&area=K.1&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    const area = await kpiNumber(page, 'stoppage');
    expect(parseFloat(area.replace(/,/g, ''))).toBeLessThan(parseFloat(line.replace(/,/g, '')));
    await expect(page.getByTestId('rpt-cover-filters')).toHaveText('Line L.1 - Area K.1');
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary&line=L.1&area=K.1&code=NO.SUCH&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('rpt-empty')).toBeVisible();
    await expect(page.getByTestId('rpt-cover-filters')).toHaveText('Line L.1 - Area K.1 - Equipment NO.SUCH');
  });

  test('numbers equal the Dashboard and the Reliability page for the same filters', async ({ page }) => {
    await openReport(page, 'manager', 'tpl=custom&p=lastmonth&cmp=1&line=L.1&area=K.1&s=summary');
    const stop = await kpiNumber(page, 'stoppage');
    const fails = await kpiNumber(page, 'failures');
    const rf = await kpiNumber(page, 'reliability');
    const uf = await kpiNumber(page, 'utilization');
    const mttr = await kpiNumber(page, 'mttr');
    await page.goto('/#/overview?r=prevmonth&line=L.1&area=K.1');
    await expect(page.getByTestId('kpi-total-hours-value')).toHaveText(stop);
    await expect(page.getByTestId('kpi-failure-count-value')).toHaveText(fails);
    // the Dashboard shows RF and UF instead of availability on its KPI row
    await expect(page.getByTestId('kpi-reliability-value')).toHaveText(rf);
    await expect(page.getByTestId('kpi-utilization-value')).toHaveText(uf);
    await expect(page.getByTestId('kpi-mttr-value')).toHaveText(mttr);
    await page.goto('/#/reliability?r=prevmonth&line=L.1&area=K.1');
    await expect(page.getByTestId('rt-mttr')).toHaveText(mttr);
    // the report's MTBF card (one area in scope) equals the Reliability tile
    await page.goto('/#/reports?tpl=custom&p=lastmonth&cmp=1&line=L.1&area=K.1&s=summary&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    const mtbf = await kpiNumber(page, 'mtbf');
    await page.goto('/#/reliability?r=prevmonth&line=L.1&area=K.1');
    await expect(page.getByTestId('rt-mtbf')).toHaveText(mtbf);
  });

  test('targets from Settings show as status on the KPI strip and the availability section', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/calculations');
    await page.getByLabel(/Availability target/i).first().fill('99');
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=summary,availability&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('rpt-kpi-availability-status')).toContainText('Target 99%');
    await expect(page.getByTestId('rpt-kpi-availability-status')).toHaveAttribute('data-state', 'below');
    await expect(page.getByTestId('rpt-chart-availability')).toContainText('Target 99%');
  });

  test('every chart section renders a static chart and a table; sections with nothing say so', async ({ page }) => {
    await openReport(page, 'manager', 'tpl=monthly&p=lastmonth');
    for (const id of ['daily', 'monthly', 'classes', 'area-downtime', 'availability', 'mtbf', 'mttr', 'failure-rate', 'top_equipment', 'top_reasons', 'pareto-area', 'pareto-line', 'pareto-class', 'quadrant', 'when']) {
      await expect(page.getByTestId(`rpt-chart-${id}`).first(), id).toBeAttached();
    }
    // static: no tooltip layer and no hit areas
    await expect(page.locator('.rpt-chart .chart-hit')).toHaveCount(0);
    await expect(page.locator('.rpt-chart [data-testid=chart-tip]')).toHaveCount(0);
    expect(await page.getByTestId('rpt-table').count()).toBeGreaterThan(10);
    await expect(page.getByTestId('rpt-page-no').first()).toContainText('Page 2 of');
    // a period without data
    await page.goto('/#/reports?tpl=monthly&p=custom&from=2030-01-01&to=2030-01-31&v=report');
    await ready(page).waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('rpt-empty').count()).toBeGreaterThan(8);
    await expect(page.locator('.rpt-chart')).toHaveCount(0);
  });

  test('Print / Save as PDF: page.pdf gives a multi-page A4 PDF with the same page count as the preview', async ({ page }) => {
    await openReport(page, 'manager', 'tpl=monthly&p=lastmonth');
    const pages = Number(await page.getByTestId('report').getAttribute('data-pages'));
    expect(pages).toBeGreaterThan(10);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const text = pdf.toString('latin1');
    const count = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(count).toBe(pages);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)!;
    expect(Math.round(Number(box[1]))).toBe(595);
    expect(Math.round(Number(box[2]))).toBe(842);
    expect(pdf.length).toBeGreaterThan(50_000);
    // the app shell is not printed
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.sidebar-rail')).toBeHidden();
    await expect(page.getByTestId('report-toolbar')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  });

  test('the Print button is enabled once the pages are laid out and calls the browser print dialog', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
    await openReport(page, 'manager', 'tpl=custom&p=lastmonth&s=summary');
    await expect(page.getByTestId('report-print')).toBeEnabled();
    await page.getByTestId('report-print').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });
});

test.describe('phone', () => {
  for (const width of [360, 390]) {
    test.describe(`${width} px`, () => {
      test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
      let errors: string[];
      test.beforeEach(async ({ page }) => {
        await stubFonts(page);
        errors = watchConsole(page);
      });
      test.afterEach(() => {
        expect(errors, 'console errors').toEqual([]);
      });

      test('More lists Reports under its heading, not on the bottom bar; the builder is usable without sideways scrolling', async ({ page }) => {
        await signInAndWait(page, 'manager');
        await expect(page.getByTestId('bottom-reports')).toHaveCount(0);
        await page.getByTestId('bottom-more').click();
        await expect(page.getByTestId('more-section-reports')).toHaveText('Reports');
        await page.getByTestId('more-tile-reports').click();
        await expect(page.getByTestId('builder')).toBeVisible();
        await expect(page.getByTestId('rb-scope')).toContainText('area-hours in scope');
        expect((await noSidewaysScroll(page)).ok).toBe(true);
        expect(await smallTargets(page)).toEqual([]);
        expect(await smallText(page)).toEqual([]);
        // open a filter list stacked, and the custom range: still no sideways scroll
        await page.getByTestId('rb-line').click();
        await page.getByTestId('rb-period-custom').click();
        expect((await noSidewaysScroll(page)).ok).toBe(true);
        expect(await smallTargets(page)).toEqual([]);
        const build = page.getByTestId('rb-build');
        await build.scrollIntoViewIfNeeded();
        expect((await build.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      });

      test('the preview scrolls vertically with pages scaled to the screen width', async ({ page }) => {
        await openReport(page, 'manager', 'tpl=custom&p=lastmonth&s=cover,summary,daily');
        expect((await noSidewaysScroll(page)).ok).toBe(true);
        // a phone opens at a readable zoom (the pages scroll sideways inside the preview); Fit scales them to the screen
        await page.getByTestId('rpt-zoom-fit').click();
        await expect(page.getByTestId('rpt-zoom-fit')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.locator('[data-testid=rpt-page]').first().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(width);
        const w = await page.locator('[data-testid=rpt-page]').first().evaluate((el) => el.getBoundingClientRect().width);
        expect(w).toBeLessThanOrEqual(width);
        expect(w).toBeGreaterThan(width * 0.8);
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(h).toBeGreaterThan(800 * 2);
        // the pages are a scaled document (their contents-list links are part of the paper); the app's own controls keep 44 px
        expect((await smallTargets(page)).filter((x) => !x.startsWith('A. '))).toEqual([]);
      });
    });
  }
});
