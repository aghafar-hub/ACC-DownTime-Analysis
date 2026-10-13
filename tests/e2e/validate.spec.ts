import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// The Validate page in mock mode (made-up data with records of every flag).

/** The first number in a text (tiles also carry a label). */
const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function openValidate(page: Page, role: Role) {
  await signInAndWait(page, role);
  await page.goto('/#/validate');
  await expect(page.getByTestId('page-validate')).toBeVisible();
  await expect(page.getByTestId('page-subtitle')).toContainText('need');
  await expect(page.getByTestId('v-count-blocked')).toBeVisible();
}
const rows = (page: Page) => page.locator('[data-testid="v-row"], [data-testid="v-card"]');
const blockedCount = async (page: Page) => num(await page.getByTestId('v-count-blocked').textContent());
const chip = (page: Page, flag: string) => page.getByTestId(`v-chip-${flag}`);
const chipCount = async (page: Page, flag: string) => ((await chip(page, flag).count()) ? num(await chip(page, flag).locator('b').textContent()) : 0);
/** 'YYYY-MM' of a timestamp as the app shows it ('26 Aug 2026 14:05'). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (shown: string): string => {
  const m = /(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/.exec(shown);
  if (!m) throw new Error(`not a date: ${shown}`);
  return `${m[3]}-${String(MONTHS.indexOf(m[2]!) + 1).padStart(2, '0')}`;
};
/** A desktop row's menu action (Keep as entered, Void): open the row's ⋯ menu, then choose the item (drawn on <body>). */
const rowAction = async (page: Page, row: ReturnType<Page['locator']>, testid: 'v-keep-btn' | 'v-void-btn') => {
  await row.getByTestId('v-more').click();
  await page.getByTestId(testid).click();
};
/** Seconds in "2 h 05 min (7500 s)" of the open record. */
const detailSeconds = async (page: Page) => num((await page.getByTestId('detail-duration').textContent())!.match(/\((\d+) s\)/)![1]);

test.describe('validate (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  for (const [role, fixes] of [['viewer', false], ['manager', false], ['engineer', true], ['admin', true]] as [Role, boolean][]) {
    test(`${role}: sees the Validate tab and ${fixes ? 'can fix records' : 'reads only'}`, async ({ page }) => {
      await signInAndWait(page, role);
      // Validate lives in the Data section: the pinned rail lists it (with its count) right after Event Explorer
      const railLink = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Validate/ });
      await expect(railLink).toBeVisible();
      await railLink.click();
      await expect(railLink).toHaveClass(/sidebar-link--active/);
      await expect(page.getByTestId('page-validate')).toBeVisible();
      await expect(rows(page).first()).toBeVisible();
      const names = await page.locator('[data-section="data"] .sidebar-link-label').allTextContents();
      expect(names.indexOf('Validate')).toBe(names.indexOf('Event Explorer') + 1);
      const badge = page.getByTestId('validate-badge-rail');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('◆');
      await expect(badge).toHaveAttribute('aria-label', /need checking, .* left out of the numbers/);
      if (fixes) {
        await expect(page.getByTestId('v-fix-btn').first()).toBeVisible();
        await expect(page.getByTestId('v-tick').first()).toBeVisible();
        await expect(page.getByTestId('v-recheck')).toBeVisible();
      } else {
        await expect(page.getByTestId('v-fix-btn')).toHaveCount(0);
        await expect(page.getByTestId('v-void-btn')).toHaveCount(0);
        await expect(page.getByTestId('v-more')).toHaveCount(0);
        await expect(page.getByTestId('v-tick')).toHaveCount(0);
        await expect(page.getByTestId('v-recheck')).toHaveCount(0);
        // everything is readable: the popup opens with the problems explained and no Edit button
        await rows(page).first().getByRole('button').first().click();
        await expect(page.getByTestId('event-detail')).toBeVisible();
        await expect(page.getByTestId('detail-flag-fix').first()).toContainText('What to do');
        await expect(page.getByTestId('edit-event')).toHaveCount(0);
        await expect(page.getByTestId('void-event')).toHaveCount(0);
      }
    });
  }

  test('summary, subtitle, problem chips for every kind of problem, and the hint line', async ({ page }) => {
    await openValidate(page, 'engineer');
    const blocked = await blockedCount(page);
    const review = num(await page.getByTestId('v-count-review').textContent());
    expect(blocked).toBeGreaterThan(0);
    expect(review).toBeGreaterThan(0);
    await expect(page.getByTestId('page-subtitle')).toHaveText(new RegExp(`^[\\d,]+ records need checking, ${blocked} of them left out of the numbers \\([\\d,.]+ h\\)$`));
    for (const f of ['missing_classification', 'invalid_classification', 'unknown_area', 'end_before_start', 'missing_code', 'unknown_code', 'unlisted_reason', 'blank_reason', 'line_mismatch', 'failure_flag_mismatch']) {
      await expect(chip(page, f), f).toBeVisible();
    }
    // overlaps are information (P1): no problem chip, a tile and a view of their own
    await expect(chip(page, 'overlap_in_area')).toHaveCount(0);
    expect(num(await page.getByTestId('v-count-overlap').textContent())).toBeGreaterThan(0);
    await expect(page.getByTestId('v-view-overlaps')).toBeVisible();
    // blocking chips carry ◆ and warning chips ▲
    await expect(chip(page, 'missing_classification')).toContainText('◆');
    await expect(chip(page, 'unknown_code')).toContainText('▲');
    await expect(page.getByTestId('v-hint')).toContainText('Master Data');
    // the first row is a blocking one, with its fix hint
    await expect(rows(page).first()).toHaveAttribute('data-blocking', 'yes');
    await expect(rows(page).first().getByTestId('v-fix')).not.toBeEmpty();
  });

  test('filters: chip, area, month, search, Blocking only, Reset; 50 at a time', async ({ page }) => {
    await openValidate(page, 'engineer');
    const total = num((await page.getByTestId('v-list-count').textContent())!.match(/of ([\d,]+)/)![1]);
    await chip(page, 'unknown_code').click();
    const n = await chipCount(page, 'unknown_code');
    await expect(rows(page)).toHaveCount(n);
    await expect(page.getByTestId('v-flag').first()).toBeVisible();
    await page.getByTestId('v-reset').click();
    await expect(page.getByTestId('v-list-count')).toContainText(`of ${total}`);
    await page.getByTestId('v-blocking-only').click();
    await expect(rows(page).first()).toHaveAttribute('data-blocking', 'yes');
    await expect(rows(page)).toHaveCount(await blockedCount(page));
    await page.getByTestId('v-reset').click();
    const area = await rows(page).first().locator('td').nth(2).locator('xpath=self::td').textContent();
    const areaId = area!.trim().split(/\s/)[0].replace(/[^A-Z0-9.]/gi, '').slice(0, 4);
    await page.getByTestId('d-area').selectOption({ index: 1 });
    const afterArea = await rows(page).count();
    expect(afterArea).toBeGreaterThan(0);
    expect(afterArea).toBeLessThanOrEqual(total);
    await page.getByTestId('d-month').selectOption({ index: 1 });
    expect(await rows(page).count()).toBeLessThanOrEqual(afterArea);
    expect(areaId.length).toBeGreaterThan(0);
    await page.getByTestId('v-reset').click();
    await page.getByTestId('v-search').fill('zzzz-no-such-text');
    await expect(page.getByTestId('v-no-results')).toBeVisible();
    await page.getByTestId('v-reset').click();
    if (total > 50) {
      await expect(rows(page)).toHaveCount(50);
      await page.getByTestId('show-more').click();
      await expect(rows(page)).toHaveCount(Math.min(100, total));
    }
  });

  test('fixing a missing classification: leaves the list, lowers banner, tile and badge, raises the Overview total', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'missing_classification').click();
    const first = rows(page).first();
    const id = (await first.getAttribute('data-event-id'))!;
    const stop = (await first.locator('.row-link').textContent())!;
    const month = monthOf(stop);
    const blocked0 = await blockedCount(page);
    const badge0 = num(await page.getByTestId('validate-badge-rail').textContent());

    // the Overview total for that month and the banner, before the fix
    await page.goto(`/#/overview?r=month&m=${month}&cmp=none`);
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    const banner = page.getByTestId('validation-banner');
    await expect(banner).toContainText('left out of these numbers because they need checking');
    expect(num(await banner.textContent())).toBe(blocked0);
    const hours0 = num(await page.getByTestId('kpi-total-hours-value').textContent());

    await page.goto('/#/validate');
    await chip(page, 'missing_classification').click();
    await page.locator(`[data-event-id="${id}"]`).getByTestId('v-fix-btn').click();
    await expect(page.getByTestId('f-note')).toHaveValue('Checked on the Validate page');
    await expect(page.getByTestId('f-class')).toHaveValue('');
    await page.getByTestId('f-class').selectOption('MEC');
    // the sheet's reason may not be listed under the chosen classification: pick a listed one so nothing is left to fix
    if ((await page.getByTestId('f-reason-pick').inputValue()) === '') await page.getByTestId('f-reason-pick').selectOption({ index: 1 });
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('v-fixed')).toContainText('Fixed');
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(0);
    expect(await blockedCount(page)).toBe(blocked0 - 1);
    expect(num(await page.getByTestId('validate-badge-rail').textContent())).toBe(badge0 - 1);

    // the record is in the Event Explorer history with the note
    await page.goto('/#/events');
    await page.getByTestId('event-search').fill(id);
    const exRow = page.locator(`[data-event-id="${id}"]`);
    await expect(exRow).toBeVisible();
    await expect(exRow.getByTestId('badge-edited')).toBeVisible();
    await exRow.getByRole('button').click();
    await expect(page.getByTestId('history-item').first()).toContainText('Checked on the Validate page');
    const secs = await detailSeconds(page);
    await page.getByTestId('modal-close').click();

    await page.goto(`/#/overview?r=month&m=${month}&cmp=none`);
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('validation-banner')).toBeVisible();
    expect(num(await page.getByTestId('validation-banner').textContent())).toBe(blocked0 - 1);
    // a record can straddle the month edge: only the part inside the month is added
    await expect.poll(async () => num(await page.getByTestId('kpi-total-hours-value').textContent()) - hours0).toBeGreaterThan(0);
    const delta = num(await page.getByTestId('kpi-total-hours-value').textContent()) - hours0;
    expect(delta).toBeLessThanOrEqual(secs / 3600 + 0.11);
  });

  test('unlisted reason: the reason picker offers only the listed reasons of the classification', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unlisted_reason').click();
    const n0 = await chipCount(page, 'unlisted_reason');
    const row = rows(page).first();
    const id = (await row.getAttribute('data-event-id'))!;
    await row.getByTestId('v-fix-btn').click();
    const pick = page.getByTestId('f-reason-pick');
    const cls = await page.getByTestId('f-class').inputValue();
    const options = await pick.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(2);
    expect(options[0]).toContain(`Pick a listed reason for ${cls}`);
    // none of the listed reasons of another classification leaks in
    const other = (await page.getByTestId('f-class').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).filter((c) => c && c !== cls);
    expect(other.length).toBeGreaterThan(0);
    await pick.selectOption({ index: 1 });
    const chosen = await page.getByTestId('f-reason').inputValue();
    expect(options).toContain(chosen);
    await page.getByTestId('save-edit').click();
    // the record leaves the list unless it still has another problem; either way it no longer has this one
    await expect(page.locator(`[data-event-id="${id}"] [data-flag="unlisted_reason"]`)).toHaveCount(0);
    await expect(chip(page, 'unlisted_reason')).toHaveCount(n0 > 1 ? 1 : 0);
    if (n0 > 1) expect(await chipCount(page, 'unlisted_reason')).toBe(n0 - 1);
  });

  test('equipment finder: the area\'s codes and N/A', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'missing_code').click();
    await rows(page).first().getByTestId('v-fix-btn').click();
    await expect(page.getByTestId('code-na')).toBeVisible();
    const area = await page.getByTestId('f-area').inputValue();
    expect(area).not.toBe('');
    const options = page.getByTestId('code-option');
    expect(await options.count()).toBeGreaterThan(0);
    await page.getByTestId('f-code-find').fill('zzzz-nothing');
    await expect(options).toHaveCount(0);
    await page.getByTestId('f-code-find').fill('');
    await options.first().click();
    await expect(page.getByTestId('f-code')).not.toHaveValue('');
    await page.getByTestId('code-na').click();
    await expect(page.getByTestId('f-code')).toHaveValue('N/A');
  });

  // EV-d8f4c170f3345baa: RM.1 stopped because of 241.GB140, which is listed under FM.2 only (flag code_not_in_area is its only flag)
  const CROSS_ID = 'EV-d8f4c170f3345baa';

  test('a cause in another area is information: not in Validate, neutral chip and note in Explorer, not a data issue', async ({ page }) => {
    await openValidate(page, 'engineer');
    // not listed, not a chip, not in the counts
    await expect(chip(page, 'code_not_in_area')).toHaveCount(0);
    await page.getByTestId('v-search').fill(CROSS_ID);
    await expect(page.getByTestId('v-filters')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await page.getByTestId('v-reset').click();
    const total0 = num(await page.getByTestId('page-subtitle').textContent());
    const badge0 = num(await page.getByTestId('validate-badge-rail').textContent());
    expect(badge0).toBe(total0);

    // Event records follow the shared period: open the whole data range to find it
    await page.goto('/#/events?r=custom&from=2025-01-01&to=2026-12-31');
    await page.getByTestId('event-search').fill(CROSS_ID);
    const row = page.locator(`[data-event-id="${CROSS_ID}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('badge-flag')).toHaveCount(0);
    const info = row.getByTestId('badge-info');
    await expect(info).toHaveText(/Cause in FM\.2/);
    await expect(info).not.toHaveClass(/badge--warning|badge--danger/);
    // 'Only rows with data issues' leaves it out, and the issue tile does not count it
    await page.getByTestId('filter-show').selectOption('issues');
    await expect(row).toHaveCount(0);
    await page.getByTestId('filter-show').selectOption('all');
    await expect(page.getByTestId('tile-issues')).toContainText('0');

    // the popup: a short note, nothing to fix, no warning styling
    await row.getByRole('button').first().click();
    await expect(page.getByTestId('cause-note')).toContainText("This code is listed under FM.2, not under RM.1. The stop counts for RM.1 as stopped by another area (not RM.1's own equipment). Nothing to fix.");
    await expect(page.getByTestId('cause-chip')).toHaveText(/Cause in FM\.2/);
    await expect(page.getByTestId('detail-flag')).toHaveCount(0);
    await expect(page.getByText('No data issues found.')).toBeVisible();
    await page.getByTestId('modal-close').click();

    // the banner and the nav badge are unchanged by it
    await page.goto('/#/validate');
    await expect(page.getByTestId('v-count-blocked')).toBeVisible();
    expect(num(await page.getByTestId('validate-badge-rail').textContent())).toBe(badge0);
  });

  test('equipment finder: every active code, the area\'s first, other areas with their owner; saving one raises no warning', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    // Event records follow the shared period: open the whole data range to find it
    await page.goto('/#/events?r=custom&from=2025-01-01&to=2026-12-31');
    await page.getByTestId('event-search').fill(CROSS_ID);
    await page.locator(`[data-event-id="${CROSS_ID}"]`).getByRole('button').first().click();
    await page.getByTestId('edit-event').click();
    await expect(page.getByTestId('code-finder')).toContainText('Find equipment (listed under RM.1 first)');
    await expect(page.getByTestId('code-na')).toContainText('N/A · the whole area stopped');
    const own = page.getByTestId('code-group-own');
    const other = page.getByTestId('code-group-other');
    await expect(own).toContainText('Listed under RM.1');
    await expect(other).toContainText('Other areas');
    expect(await own.locator('[data-testid="code-option"]').count()).toBeGreaterThan(0);
    // listed-under-RM.1 group is above the other-areas group
    const yOwn = (await own.boundingBox())!.y;
    const yOther = (await other.boundingBox())!.y;
    expect(yOwn).toBeLessThan(yOther);
    // an other-area item names its owner area
    const first = other.getByTestId('code-option-other').first();
    await expect(first.getByTestId('code-owner')).toHaveText(/^\s*[A-Z0-9.]+(, [A-Z0-9.]+)*$/);
    // search reaches every area
    await page.getByTestId('f-code-find').fill('zzzz-nothing');
    await expect(page.getByTestId('code-option')).toHaveCount(0);
    await expect(page.getByTestId('code-option-other')).toHaveCount(0);
    await page.getByTestId('f-code-find').fill('');
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    const code = ((await first.locator('.mono').textContent()) ?? '').trim();
    await first.click();
    await expect(page.getByTestId('f-code')).toHaveValue(code);
    // the code input stays free-form
    await page.getByTestId('f-code').fill(code);
    await page.getByTestId('f-note').fill('Cause is in another area');
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('edit-result')).toBeVisible();
    await expect(page.getByTestId('edit-result')).toContainText('Data checks: no issues');
    await expect(page.getByTestId('server-error')).toHaveCount(0);
    expect(dialogs).toEqual([]);
    // the saved record is still information only
    await expect(page.getByTestId('cause-note')).toBeVisible();
  });

  test('bulk: classification set on several records, one refusal is reported and the run goes on', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'missing_classification').click();
    const n = await chipCount(page, 'missing_classification');
    expect(n).toBeGreaterThanOrEqual(2);
    await page.getByTestId('v-select-all').click();
    await expect(page.getByTestId('v-selected')).toContainText(`${n} record`);
    // add one record that already has the classification we will set, so the server refuses it
    await page.getByTestId('v-reset').click();
    await chip(page, 'unknown_code').click();
    const target = (await rows(page).first().locator('.badge--class').textContent())!.trim();
    const sameId = (await rows(page).first().getAttribute('data-event-id'))!;
    await rows(page).first().getByTestId('v-tick').check();
    await expect(page.getByTestId('v-selected')).toContainText(`${n + 1} records`);
    await page.getByTestId('v-bulk-open').click();
    await expect(page.getByTestId('bulk-modal')).toBeVisible();
    await expect(page.getByTestId('b-note')).toHaveValue('Checked on the Validate page');
    // nothing chosen yet: a plain message
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByTestId('bulk-error')).toContainText('Choose at least one thing');
    await page.getByTestId('b-class').selectOption(target);
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByTestId('bulk-result')).toContainText(`Saved ${n} of ${n + 1} records`);
    await expect(page.getByTestId('bulk-refused-item')).toHaveCount(1);
    await expect(page.getByTestId('bulk-refused-item')).toHaveAttribute('data-event-id', sameId);
    await expect(page.getByTestId('bulk-refused-item')).toContainText('already has these values');
    await page.getByTestId('bulk-close').click();
    await expect(chip(page, 'missing_classification')).toHaveCount(0);
    // the refused record stays ticked
    await expect(page.getByTestId('v-selected')).toContainText('1 record');
  });

  test('void a duplicate: needs a note, then the record and its overlap leave the Overlaps (information) list', async ({ page }) => {
    await openValidate(page, 'engineer');
    await page.getByTestId('v-view-overlaps').click();
    await expect(page.getByTestId('v-overlap-hint')).toContainText('counted once');
    const n0 = await rows(page).count();
    const o0 = num(await page.getByTestId('v-count-overlap').textContent());
    expect(n0).toBe(o0);
    // information only: no keep-as-entered and no ticks here
    await expect(page.getByTestId('v-tick')).toHaveCount(0);
    const row = rows(page).first();
    const id = (await row.getAttribute('data-event-id'))!;
    await rowAction(page, row, 'v-void-btn');
    await expect(page.getByTestId('confirm-void')).toBeVisible();
    await page.getByTestId('confirm-void').click();
    await expect(page.getByTestId('error-note')).toBeVisible();
    await page.getByTestId('f-note').fill('Duplicate of the other record');
    await page.getByTestId('confirm-void').click();
    await expect(page.getByTestId('v-fixed')).toContainText('Voided');
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(0);
    expect(num(await page.getByTestId('v-count-overlap').textContent())).toBeLessThan(o0);
  });

  test('an overlapping record shows the other record, with a button to open it', async ({ page }) => {
    await openValidate(page, 'viewer');
    await page.getByTestId('v-view-overlaps').click();
    const row = rows(page).first();
    const id = (await row.getAttribute('data-event-id'))!;
    await row.locator('.row-link').click();
    const partner = page.getByTestId('overlap-partner').first();
    await expect(partner).toBeVisible();
    await expect(partner).toContainText('→');
    const otherId = (await partner.getAttribute('data-event-id'))!;
    expect(otherId).not.toBe(id);
    await expect(page.getByTestId('event-detail')).toContainText(id);
    await page.getByTestId('open-partner').first().click();
    await expect(page.getByTestId('event-detail')).toContainText(otherId);
    await expect(page.getByTestId('overlap-partner').first()).toHaveAttribute('data-event-id', id);
  });

  test('Re-check after adding an equipment code in Master Data clears unknown_code', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unknown_code').click();
    const n0 = await chipCount(page, 'unknown_code');
    const code = (await rows(page).first().locator('td.mono').first().textContent())!.trim();
    const sameCode = await rows(page).filter({ has: page.locator('td.mono', { hasText: new RegExp(`^${code.replace('.', '\\.')}$`) }) }).count();
    expect(sameCode).toBeGreaterThan(0);
    await page.goto('/#/master');
    await page.getByTestId('add-equipment').click();
    await page.getByTestId('eq-code').fill(code);
    await page.getByTestId('eq-desc').fill('Added for the Validate test (synthetic)');
    await page.getByTestId('area-K.1').check();
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('saved-toast')).toBeVisible();
    await page.goto('/#/validate');
    await expect(page.getByTestId('page-validate')).toBeVisible();
    // nothing changes by itself
    await expect(chip(page, 'unknown_code')).toBeVisible();
    await page.getByTestId('v-recheck').click();
    await expect(page.getByTestId('v-recheck-result')).toContainText(/Checked [\d,]+, changed [\d,]+/);
    const changed = num((await page.getByTestId('v-recheck-result').textContent())!.match(/changed ([\d,]+)/)![1]);
    expect(changed).toBeGreaterThanOrEqual(sameCode);
    const n1 = await chipCount(page, 'unknown_code');
    expect(n1).toBe(n0 - sameCode);
  });

  test('banner: one line on every dashboard and the Event Explorer, links to Validate, comes back after a reload', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await expect(page.getByTestId('validation-banner')).toBeVisible();
    for (const p of ['overview', 'pareto', 'repeats', 'reliability', 'events']) {
      await page.goto(`/#/${p}`);
      await expect(page.getByTestId(`page-${p}`)).toBeVisible();
      await expect(page.getByTestId('validation-banner')).toBeVisible();
      await expect(page.getByTestId('validation-banner')).toContainText(/records? \([\d,.]+ h\) (is|are) left out of these numbers because (it|they) needs? checking/);
      const box = await page.getByTestId('validation-banner').boundingBox();
      expect(box!.height).toBeLessThan(70);
    }
    await page.getByTestId('validation-banner-open').click();
    await expect(page.getByTestId('page-validate')).toBeVisible();
    await expect(page.getByTestId('validation-banner')).toHaveCount(0); // the Validate page does not repeat it
    await page.goto('/#/overview');
    await page.getByTestId('validation-banner-close').click();
    await expect(page.getByTestId('validation-banner')).toHaveCount(0);
    await page.goto('/#/events');
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('validation-banner')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('validation-banner')).toBeVisible({ timeout: 20000 });
  });

  test('Event Explorer still lists blocked records, with their flag badges', async ({ page }) => {
    await openValidate(page, 'viewer');
    const id = (await rows(page).first().getAttribute('data-event-id'))!;
    await expect(rows(page).first()).toHaveAttribute('data-blocking', 'yes');
    await page.goto('/#/events');
    await page.getByTestId('event-search').fill(id);
    const row = page.locator(`[data-event-id="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('badge-flag').first()).toBeVisible();
    // the Explorer's hour tile leaves blocked records out, like every chart
    await expect(page.getByTestId('tile-hours')).toContainText('not voided or left out');
  });

  test('deep link and reload keep the page', async ({ page }) => {
    await openValidate(page, 'engineer');
    await page.reload();
    await expect(page.getByTestId('page-validate')).toBeVisible();
    await expect(page.getByTestId('v-count-blocked')).toBeVisible({ timeout: 20000 });
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByTestId('rail-link-validate')).toHaveClass(/sidebar-link--active/);
    // with the icon rail the Data page tabs come back, Validate lit
    await page.getByTestId('rail-toggle').click();
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /^Validate/ })).toHaveClass(/module-tab--active/);
    await expect(page.getByTestId('validate-badge-tab')).toBeVisible();
  });


  // ---------------------------------------------------------------- keep as entered
  const keptCount = async (page: Page) => num(await page.getByTestId('v-count-kept').textContent());
  const keptHours = async (page: Page) => num(await page.getByTestId('v-kept-hours').textContent());
  const reviewCount = async (page: Page) => num(await page.getByTestId('v-count-review').textContent());
  /** The first row of the current list that has exactly one problem badge and the given blocking state. */
  async function singleProblemRow(page: Page, blocking: 'yes' | 'no') {
    const all = rows(page).filter({ has: page.locator(`xpath=self::*[@data-blocking="${blocking}"]`) });
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const r = all.nth(i);
      if ((await r.getByTestId('v-flag').count()) === 1 && (await r.getByTestId('v-flag-more').count()) === 0) return r;
    }
    throw new Error('no single-problem row');
  }

  test('keep a warning record as entered: leaves Open, counts drop, shows under Kept as entered with its note, Undo brings it back', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unknown_code').click();
    const row = await singleProblemRow(page, 'no');
    const id = (await row.getAttribute('data-event-id'))!;
    await page.getByTestId('v-reset').click();
    const review0 = await reviewCount(page);
    const blocked0 = await blockedCount(page);
    const badge0 = num(await page.getByTestId('validate-badge-rail').textContent());
    const kept0 = await keptCount(page);
    const hours0 = await keptHours(page);
    const subtitleTotal0 = num(await page.getByTestId('page-subtitle').textContent());

    await page.getByTestId('v-search').fill(id);
    await rowAction(page, page.locator(`[data-event-id="${id}"]`), 'v-keep-btn');
    const modal = page.getByTestId('keep-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('keep-flag-box')).toHaveCount(1);
    await expect(page.getByTestId('keep-flag-box')).toBeChecked();
    await expect(page.getByTestId('keep-note')).toHaveValue('Checked: entered correctly');
    await expect(page.getByTestId('keep-sentence')).toHaveText('Nothing in the record changes. It will stop being listed. It counts normally.');
    // unticking everything, or an empty note, is refused in plain words
    await page.getByTestId('keep-flag-box').uncheck();
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-error')).toContainText('Tick at least one problem');
    await page.getByTestId('keep-flag-box').check();
    await page.getByTestId('keep-note').fill('ab');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-error')).toContainText('at least 3 characters');
    await page.getByTestId('keep-note').fill('Code is correct, the master list is behind');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toContainText('Kept 1 of 1 records as entered');
    await page.getByTestId('keep-close').click();
    await expect(page.getByTestId('v-fixed')).toContainText('Kept as entered');

    // it left the Open list, the numbers dropped, nothing else moved
    await page.getByTestId('v-reset').click();
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(0);
    expect(await reviewCount(page)).toBe(review0 - 1);
    expect(await blockedCount(page)).toBe(blocked0);
    expect(num(await page.getByTestId('validate-badge-rail').textContent())).toBe(badge0 - 1);
    expect(num(await page.getByTestId('page-subtitle').textContent())).toBe(subtitleTotal0 - 1);
    expect(await keptCount(page)).toBe(kept0 + 1);
    expect(await keptHours(page)).toBe(hours0); // a warning record counts normally: no hours set aside

    // it is under Kept as entered, with who, when and why
    await page.getByTestId('v-view-kept').click();
    const k = page.locator(`[data-testid="v-kept-row"][data-event-id="${id}"]`);
    await expect(k).toBeVisible();
    await expect(k.getByTestId('v-kept-by')).toContainText('Kept as entered by');
    await expect(k.getByTestId('v-kept-by')).toContainText('Demo');
    await expect(k.getByTestId('v-kept-note')).toHaveText('Code is correct, the master list is behind', { timeout: 15000 });
    await expect(k.getByTestId('v-kept-leftout')).toHaveCount(0);
    await expect(k.getByTestId('v-kept-flag')).toHaveAttribute('data-flag', 'unknown_code');
    // the popup says it too, and its history has the entry
    await k.locator('.row-link').click();
    await expect(page.getByTestId('detail-kept-by')).toContainText('Kept as entered by');
    await expect(page.getByTestId('detail-kept-note')).toHaveText('Code is correct, the master list is behind');
    await expect(page.getByTestId('detail-no-issues')).toHaveText('No open data issues.');
    await expect(page.getByTestId('history-item').first()).toContainText('Kept as entered');
    await page.getByTestId('modal-close').click();

    // Undo brings it back to Open
    await k.getByTestId('v-undo-btn').click();
    await expect(page.getByTestId('keep-sentence')).toContainText('listed under Open again');
    await expect(page.getByTestId('keep-note')).toHaveValue('Needs checking again');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toContainText('Undone on 1 of 1 records');
    await page.getByTestId('keep-close').click();
    await expect(k).toHaveCount(0);
    await page.getByTestId('v-view-open').click();
    await page.getByTestId('v-search').fill(id);
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(1);
    await page.getByTestId('v-reset').click();
    expect(await reviewCount(page)).toBe(review0);
    expect(await keptCount(page)).toBe(kept0);
    expect(num(await page.getByTestId('validate-badge-rail').textContent())).toBe(badge0);
  });

  test('keep a blocking record as entered: leaves Open, Overview numbers do not move, its hours are counted as kept and left out', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'missing_classification').click();
    const row = await singleProblemRow(page, 'yes');
    const id = (await row.getAttribute('data-event-id'))!;
    const month = monthOf((await row.locator('.row-link').textContent())!);
    await page.getByTestId('v-reset').click();
    const blocked0 = await blockedCount(page);
    const kept0 = await keptCount(page);
    const hours0 = await keptHours(page);
    const badge0 = num(await page.getByTestId('validate-badge-rail').textContent());

    await page.goto(`/#/overview?r=month&m=${month}&cmp=none`);
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('validation-banner')).toBeVisible();
    expect(num(await page.getByTestId('validation-banner').textContent())).toBe(blocked0);
    const overview0 = num(await page.getByTestId('kpi-total-hours-value').textContent());

    await page.goto('/#/validate');
    await page.getByTestId('v-search').fill(id);
    await rowAction(page, page.locator(`[data-event-id="${id}"]`), 'v-keep-btn');
    await expect(page.getByTestId('keep-sentence')).toHaveText('Nothing in the record changes. It will stop being listed. It is still left out of the numbers.');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toContainText('Kept 1 of 1');
    await page.getByTestId('keep-close').click();
    await page.getByTestId('v-reset').click();
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(0);
    expect(await blockedCount(page)).toBe(blocked0 - 1);
    expect(num(await page.getByTestId('validate-badge-rail').textContent())).toBe(badge0 - 1);
    expect(await keptCount(page)).toBe(kept0 + 1);
    expect(await keptHours(page)).toBeGreaterThan(hours0); // set aside, not counted

    // the Overview number is unchanged: the record is still left out; the banner no longer counts it
    await page.goto(`/#/overview?r=month&m=${month}&cmp=none`);
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    expect(num(await page.getByTestId('kpi-total-hours-value').textContent())).toBe(overview0);
    expect(num(await page.getByTestId('validation-banner').textContent())).toBe(blocked0 - 1);

    // it shows under Kept as entered as still left out of the numbers; Event Explorer shows a neutral badge, no problem badge
    await page.goto('/#/validate');
    await page.getByTestId('v-view-kept').click();
    await page.getByTestId('v-search').fill(id);
    const k = page.locator(`[data-testid="v-kept-row"][data-event-id="${id}"]`);
    await expect(k.getByTestId('v-kept-leftout')).toContainText('left out of the numbers');
    await page.goto('/#/events');
    await page.getByTestId('event-search').fill(id);
    const ex = page.locator(`[data-event-id="${id}"]`);
    await expect(ex.getByTestId('badge-kept')).toBeVisible();
    await expect(ex.getByTestId('badge-flag')).toHaveCount(0);
    await page.getByTestId('filter-show').selectOption('issues');
    await expect(ex).toHaveCount(0);
  });

  test('bulk keep: one note for all, progress, and a record with nothing ticked is listed as refused', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unknown_code').click();
    const picks: string[] = [];
    const warn = rows(page).filter({ has: page.locator('xpath=self::*[@data-blocking="no"]') });
    for (let i = 0; i < (await warn.count()) && picks.length < 2; i++) {
      const r = warn.nth(i);
      await r.getByTestId('v-tick').check();
      picks.push((await r.getAttribute('data-event-id'))!);
    }
    expect(picks).toHaveLength(2);
    await page.getByTestId('v-reset').click();
    await chip(page, 'blank_reason').click();
    const only = rows(page).filter({ has: page.locator('xpath=self::*[@data-blocking="no"]') });
    let refusedId = '';
    for (let i = 0; i < (await only.count()); i++) {
      const r = only.nth(i);
      if ((await r.getByTestId('v-flag').count()) === 1 && (await r.getByTestId('v-flag-more').count()) === 0 && !picks.includes((await r.getAttribute('data-event-id'))!)) {
        await r.getByTestId('v-tick').check();
        refusedId = (await r.getAttribute('data-event-id'))!;
        break;
      }
    }
    expect(refusedId).not.toBe('');
    await page.getByTestId('v-reset').click();
    const kept0 = await keptCount(page);
    await expect(page.getByTestId('v-selected')).toContainText('3 records');
    await page.getByTestId('v-keep-open').click();
    await expect(page.getByTestId('keep-modal')).toBeVisible();
    await expect(page.getByTestId('keep-flag-unknown_code')).toContainText('records');
    await page.getByTestId('keep-flag-blank_reason').locator('input').uncheck(); // the third record has only this problem
    await expect(page.getByTestId('keep-note')).toHaveValue('Checked: entered correctly');
    await page.getByTestId('keep-note').fill('Bulk check of the unknown codes');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toContainText('Kept 2 of 3 records as entered');
    await expect(page.getByTestId('keep-refused-item')).toHaveCount(1);
    await expect(page.getByTestId('keep-refused-item')).toHaveAttribute('data-event-id', refusedId);
    await expect(page.getByTestId('keep-refused-item')).toContainText('none of the problems you ticked');
    await page.getByTestId('keep-close').click();
    // the refused record stays ticked; the kept ones left the selection
    await expect(page.getByTestId('v-selected')).toContainText('1 record');
    expect(await keptCount(page)).toBe(kept0 + 2);
    await page.getByTestId('v-view-kept').click();
    for (const id of picks) await expect(page.locator(`[data-testid="v-kept-row"][data-event-id="${id}"]`)).toBeVisible();
  });

  test('view-only people see what was kept, read-only: no Keep button, no Undo', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unknown_code').click();
    const row = await singleProblemRow(page, 'no');
    const id = (await row.getAttribute('data-event-id'))!;
    await rowAction(page, row, 'v-keep-btn');
    await page.getByTestId('keep-note').fill('Checked for the viewer test');
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toBeVisible();
    await page.getByTestId('keep-close').click();
    // sign out and in as the viewer without reloading (the made-up data stays in memory)
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.goto('/#/validate');
    await expect(page.getByTestId('v-count-kept')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('v-keep-btn')).toHaveCount(0);
    await expect(page.getByTestId('v-more')).toHaveCount(0);
    await expect(page.getByTestId('v-tick')).toHaveCount(0);
    await expect(page.getByTestId('v-keep-open')).toHaveCount(0);
    await page.getByTestId('v-view-kept').click();
    const k = page.locator(`[data-testid="v-kept-row"][data-event-id="${id}"]`);
    await expect(k).toBeVisible();
    await expect(k.getByTestId('v-kept-note')).toHaveText('Checked for the viewer test', { timeout: 15000 });
    await expect(page.getByTestId('v-undo-btn')).toHaveCount(0);
    await k.locator('.row-link').click();
    await expect(page.getByTestId('detail-kept-by')).toBeVisible();
    await expect(page.getByTestId('detail-undo')).toHaveCount(0);
    await expect(page.getByTestId('keep-event')).toHaveCount(0);
  });

  test('the popup of an open record has Keep as entered, and the record leaves the list', async ({ page }) => {
    await openValidate(page, 'engineer');
    await chip(page, 'unknown_code').click();
    const row = await singleProblemRow(page, 'no');
    const id = (await row.getAttribute('data-event-id'))!;
    await row.locator('.row-link').click();
    await page.getByTestId('keep-event').click();
    await expect(page.getByTestId('keep-modal')).toBeVisible();
    await page.getByTestId('keep-apply').click();
    await expect(page.getByTestId('keep-result')).toContainText('Kept 1 of 1');
    await page.getByTestId('keep-close').click();
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
    await expect(page.getByTestId('v-fixed')).toContainText('Kept as entered');
    await expect(page.locator(`[data-event-id="${id}"]`)).toHaveCount(0);
  });

  test('size and text on the desktop page', async ({ page }) => {
    await openValidate(page, 'engineer');
    await rows(page).first().locator('.row-link').click();
    await expect(page.getByTestId('event-detail')).toBeVisible();
    expect(await smallText(page)).toEqual([]);
    await page.getByTestId('modal-close').click();
    expect(await smallText(page)).toEqual([]);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });
});

for (const width of [360, 390]) {
  test.describe(`validate (phone ${width})`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    let errors: string[];
    test.beforeEach(async ({ page }) => {
      await stubFonts(page);
      errors = watchConsole(page);
    });
    test.afterEach(() => expect(errors, 'console errors').toEqual([]));

    test('cards, chip row, filters sheet, no sideways scroll, 44 px targets, readable text', async ({ page }) => {
      await signInAndWait(page, 'engineer');
      await page.goto('/#/validate');
      await expect(page.getByTestId('page-validate')).toBeVisible();
      await expect(page.getByTestId('v-cards')).toBeVisible();
      await expect(page.getByTestId('v-phone-summary')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      // More carries the open action items (the bell's number): danger colour, number as text
      const moreBadge = page.getByTestId('bottom-more').getByTestId('more-badge');
      await expect(moreBadge).toBeVisible();
      expect(await moreBadge.textContent()).toMatch(/^\d+\+?$/);
      await expect(moreBadge).toHaveAttribute('aria-label', /items? needs? action/);
      // the More sheet lists Validate with its count
      await page.getByTestId('bottom-more').click();
      await expect(page.getByTestId('more-tile-validate')).toContainText('Validate');
      await expect(page.getByTestId('validate-badge-more')).toBeVisible();
      await expect(page.getByTestId('more-section-data')).toHaveText('Data');
      await page.keyboard.press('Escape');
      await page.goBack().catch(() => undefined);
      await page.goto('/#/validate');
      await expect(page.getByTestId('v-cards')).toBeVisible();
      // filters sheet
      await page.getByTestId('v-filters-pill').click();
      await expect(page.getByTestId('v-filters-sheet')).toBeVisible();
      await page.getByTestId('s-area').selectOption({ index: 1 });
      expect(await smallTargets(page)).toEqual([]);
      await page.getByTestId('v-sheet-apply').click();
      await expect(page.getByTestId('v-filters-sheet')).toHaveCount(0);
      await expect(page.getByTestId('v-filters-pill')).toContainText('1');
      await page.getByTestId('v-reset').click();
      // a card opens the popup; Back closes it
      await page.getByTestId('v-card').first().getByRole('button').first().click();
      await expect(page.getByTestId('event-detail')).toBeVisible();
      expect(await smallText(page)).toEqual([]);
      await page.goBack();
      await expect(page.getByTestId('event-detail')).toHaveCount(0);
      // a fix form on a phone
      await page.getByTestId('v-card').first().getByTestId('v-fix-btn').click();
      await expect(page.getByTestId('f-note')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
    });

    test('keep as entered on a phone: button on the card, sheet and Kept as entered view fit', async ({ page }) => {
      await signInAndWait(page, 'engineer');
      await page.goto('/#/validate');
      await expect(page.getByTestId('v-cards')).toBeVisible();
      await expect(page.getByTestId('v-view')).toBeVisible();
      const card = page.getByTestId('v-card').filter({ has: page.locator('xpath=self::*[@data-blocking="no"]') }).first();
      const id = (await card.getAttribute('data-event-id'))!;
      await expect(card.getByTestId('v-keep-btn')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await card.getByTestId('v-keep-btn').click();
      await expect(page.getByTestId('keep-modal')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await page.getByTestId('keep-apply').click();
      await expect(page.getByTestId('keep-result')).toBeVisible();
      await page.getByTestId('keep-close').click();
      await page.getByTestId('v-view-kept').click();
      const k = page.locator(`[data-testid="v-kept-card"][data-event-id="${id}"]`);
      await expect(k).toBeVisible();
      await expect(k.getByTestId('v-kept-by')).toContainText('Kept as entered by');
      await expect(k.getByTestId('v-undo-btn')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await expect(page.getByTestId('v-phone-summary')).toContainText('kept as entered');
      // the bulk bar offers Keep as entered beside the bulk edit
      await page.getByTestId('v-view-open').click();
      await page.getByTestId('v-tick').first().check();
      await expect(page.getByTestId('v-keep-open')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
    });

    test('ticking cards shows the bar; the bulk form fits', async ({ page }) => {
      await signInAndWait(page, 'engineer');
      await page.goto('/#/validate');
      await expect(page.getByTestId('v-cards')).toBeVisible();
      await page.getByTestId('v-tick').first().check();
      await page.getByTestId('v-tick').nth(1).check();
      await expect(page.getByTestId('v-bulkbar')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await page.getByTestId('v-bulk-open').click();
      await expect(page.getByTestId('bulk-modal')).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
    });
  });
}

test.describe('validate (R3, desktop: one-line rows, actions menu, month table folded)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('each record is one line with Fix and a menu holding Fix, Keep as entered and Void', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await openValidate(page, 'engineer');
    const row = page.getByTestId('v-row').first();
    await expect(row).toBeVisible();
    // one line: no row taller than a button row, the table fits without scrolling sideways
    const heights = await page.getByTestId('v-row').evaluateAll((els) => els.slice(0, 20).map((e) => e.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThan(60);
    const fits = await page.getByTestId('v-table').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    // Fix is the only visible button; the rest is in the menu
    await expect(row.getByTestId('v-fix-btn')).toBeVisible();
    await expect(row.getByTestId('v-void-btn')).toHaveCount(0);
    const more = row.getByTestId('v-more');
    await expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('v-more-panel');
    await expect(panel.getByRole('menuitem')).toHaveText([/^Fix/, /^Keep as entered/, /^Void/]);
    await expect(page.getByTestId('v-menu-fix')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('v-keep-btn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(more).toBeFocused();
    // Void from the menu opens the record in void mode
    await more.click();
    await page.getByTestId('v-void-btn').click();
    await expect(page.getByTestId('confirm-void')).toBeVisible();
    await page.keyboard.press('Escape');
    // what to do: one line, the full text in the tooltip
    const fix = row.getByTestId('v-fix');
    await expect(fix).toHaveAttribute('title', /.{10,}/);
    expect(await fix.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Data quality by month is folded under one summary line', async ({ page }) => {
    await stubFonts(page);
    await openValidate(page, 'viewer');
    await expect(page.getByTestId('quality-summary')).toBeVisible();
    await expect(page.getByTestId('quality-summary')).toContainText('clean');
    await expect(page.getByTestId('quality-table')).toBeHidden();
    await page.getByTestId('quality-details').locator('summary').click();
    await expect(page.getByTestId('quality-table')).toBeVisible();
    // a viewer reads the list: no Fix, no menu
    await expect(page.getByTestId('v-fix-btn')).toHaveCount(0);
    await expect(page.getByTestId('v-more')).toHaveCount(0);
  });
});
