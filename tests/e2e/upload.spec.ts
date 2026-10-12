import { expect, test, type Page } from '@playwright/test';
import { buildWorkbook, simpleRows, type SheetRowSpec } from '../helpers/makeWorkbook';
import { noSidewaysScroll, signInAndWait, smallTargets, stubFonts, watchConsole } from './helpers';

// Upload flow in mock mode. Workbooks are generated here as raw XML (formula
// cells with cached results, trailing blank formula rows) and never saved to disk.
const file = async (rows: SheetRowSpec[], name = 'downtime-synthetic.xlsx', opts: Parameters<typeof buildWorkbook>[1] = { trailingBlankFormulaRows: 40 }) => ({
  name,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from(await buildWorkbook(rows, opts)),
});

// 3 late rows (before the latest stored date), 4 new rows, 1 new row with an unknown code
const monthRows = (): SheetRowSpec[] => [
  ...simpleRows(3, '2026-10-05', { description: 'late entry' }),
  ...simpleRows(4, '2026-11-02', { code: '131.BC110', description: 'new entry' }),
  { ...simpleRows(1, '2026-11-08')[0]!, code: '999.ZZ900', description: 'unknown code' },
];

async function openUpload(page: Page, phone = false) {
  if (phone) {
    await page.goto('/#/upload');
  } else {
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Upload' }).click();
  }
  await expect(page.getByTestId('page-upload')).toBeVisible();
}

test.describe('upload flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
  });

  test('engineer: review, resolve late rows, upload, history, re-upload adds nothing', async ({ page }) => {
    const errors = watchConsole(page);
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    await expect(page.getByTestId('access-level')).toContainText('can edit');
    const before = Number(((await page.getByTestId('fact-batches').textContent()) ?? '').replace(/\D/g, '')) || 0;
    expect(before).toBeGreaterThan(5);

    await page.getByTestId('file-input').setInputFiles(await file(monthRows()));
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('count-read')).toContainText('8');
    await expect(page.getByTestId('count-new')).toContainText('5');
    await expect(page.getByTestId('count-late')).toContainText('3');
    await expect(page.getByTestId('count-identical')).toContainText('0');
    await expect(page.getByTestId('nothing-dropped')).toContainText('Nothing is dropped: every row is stored');
    await expect(page.getByTestId('open-validate')).toHaveAttribute('href', /\/validate$/);
    await expect(page.getByTestId('flag-unknown_code')).toContainText('Unknown code');
    await page.getByTestId('flag-unknown_code').locator('summary').click();
    await expect(page.getByTestId('flag-unknown_code')).toContainText('9');

    // the Upload button waits for a decision on every late row
    await expect(page.getByTestId('upload-confirm')).toBeDisabled();
    await expect(page.getByTestId('late-progress')).toContainText('0 of 3 decided');
    const rows = page.getByTestId('late-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByTestId('late-add').click();
    await rows.nth(1).getByTestId('late-add').click();
    await expect(page.getByTestId('upload-confirm')).toBeDisabled();
    await expect(page.getByTestId('late-progress')).toContainText('2 of 3 decided');
    await rows.nth(2).getByTestId('late-skip').click();
    await expect(page.getByTestId('late-progress')).toContainText('All 3 late decisions made');
    await expect(page.getByTestId('upload-confirm')).toBeEnabled();
    await expect(page.getByTestId('upload-confirm')).toContainText('Upload 7 rows');

    // the warnings can be downloaded
    const download = page.waitForEvent('download');
    await page.getByTestId('download-warnings').click();
    const dl = await download;
    expect(dl.suggestedFilename()).toMatch(/^warnings-.*\.csv$/);

    await page.getByTestId('upload-confirm').click();
    await expect(page.getByTestId('upload-confirm-dialog')).toContainText('7 rows will be added');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('upload-result')).toBeVisible();
    await expect(page.getByTestId('result-added')).toContainText('7');
    await expect(page.getByTestId('result-skipped')).toContainText('1');
    await expect(page.getByTestId('result-batch')).toContainText(/^B-\d{8}-\d{6}-/);
    const batchId = (await page.getByTestId('result-batch').textContent()) ?? '';
    await expect(page.getByTestId('result-warnings')).not.toContainText(/^0/);

    // history shows the new batch first, with its warnings
    await expect(page.getByTestId('fact-batches')).toContainText(String(before + 1));
    const first = page.getByTestId('history-row').first();
    await expect(first).toHaveAttribute('data-batch', batchId);
    await expect(first).toContainText('downtime-synthetic.xlsx');
    await first.getByTestId('history-warnings').click();
    await expect(page.getByTestId('batch-warnings')).toBeVisible();
    await expect(page.getByTestId('batch-group-late_row')).toBeVisible();
    await expect(page.getByTestId('batch-group-unknown_code')).toBeVisible();
    await page.getByTestId('batch-group-late_row').locator('summary').click();
    await expect(page.getByTestId('batch-group-late_row')).toContainText('Added');
    await expect(page.getByTestId('batch-group-late_row')).toContainText('Skipped');
    const csv = page.waitForEvent('download');
    await page.getByTestId('batch-download').click();
    expect((await csv).suggestedFilename()).toContain(batchId);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('batch-warnings')).toBeHidden();

    // the new rows reach Event Explorer
    await page.getByTestId('open-events').click();
    await expect(page.getByTestId('page-events')).toBeVisible();
    await page.getByTestId('event-search').fill('new entry');
    await expect(page.getByTestId('event-row').first()).toContainText('131.BC110');

    // the same file again: everything already stored is skipped; the one late row skipped before is still late
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Upload' }).click();
    await page.getByTestId('file-input').setInputFiles(await file(monthRows()));
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('count-identical')).toContainText('7');
    await expect(page.getByTestId('count-new')).toContainText('0');
    await expect(page.getByTestId('count-late')).toContainText('1');
    await page.getByTestId('skip-all').click();
    await expect(page.getByTestId('upload-bar-text')).toContainText('nothing new to add');
    await page.getByTestId('upload-confirm').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('upload-result')).toBeVisible();
    await expect(page.getByTestId('result-added')).toContainText('0');
    await expect(page.getByTestId('result-identical')).toContainText('7');
    await expect(page.getByTestId('result-text')).toContainText('0 new rows were added');

    // and a third time, after adding the skipped one: nothing is late any more
    await page.getByTestId('upload-another').click();
    await page.getByTestId('file-input').setInputFiles(await file(monthRows()));
    await expect(page.getByTestId('count-identical')).toContainText('7');
    await page.getByTestId('add-all').click();
    await page.getByTestId('upload-confirm').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('result-added')).toContainText('1');
    await page.getByTestId('upload-another').click();
    await page.getByTestId('file-input').setInputFiles(await file(monthRows()));
    await expect(page.getByTestId('count-identical')).toContainText('8');
    await expect(page.getByTestId('count-late')).toContainText('0');
    await expect(page.getByTestId('late-section')).toHaveCount(0);

    expect(errors, 'console errors').toEqual([]);
  });

  test('a row that differs from the stored one is shown and kept as stored', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    await page.getByTestId('file-input').setInputFiles(await file(simpleRows(2, '2026-11-02')));
    await page.getByTestId('upload-confirm').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('upload-result')).toBeVisible();
    await page.getByTestId('upload-another').click();
    // same two rows, one with a different reason and description
    const changed = simpleRows(2, '2026-11-02');
    changed[1]!.reason = 'Gearbox oil leak';
    changed[1]!.description = 'rewritten in the workbook';
    await page.getByTestId('file-input').setInputFiles(await file(changed));
    await expect(page.getByTestId('count-changed')).toContainText('1');
    await expect(page.getByTestId('count-identical')).toContainText('1');
    const row = page.getByTestId('changed-row').first();
    await expect(row).toContainText('Row 3');
    await expect(row).toContainText('Belt torn');
    await expect(row).toContainText('Gearbox oil leak');
    await expect(row).toContainText('rewritten in the workbook');
    await expect(page.getByTestId('upload-bar-text')).toContainText('nothing new to add');
  });

  test('wrong files are refused with a clear message', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    const input = page.getByTestId('file-input');

    await input.setInputFiles(await file(simpleRows(2), 'wrong-sheet.xlsx', { sheetName: 'Sheet1', otherSheets: ['Notes'] }));
    await expect(page.getByTestId('upload-refused')).toContainText('no sheet called "Downtime"');
    await expect(page.getByTestId('upload-refused')).toContainText('Notes, Sheet1');

    await input.setInputFiles(await file(simpleRows(2), 'no-freq.xlsx', { dropHeaders: ['Freq'] }));
    await expect(page.getByTestId('problem-missing_columns')).toContainText('missing these columns: Freq');

    await input.setInputFiles(await file(simpleRows(3), 'never-opened.xlsx', { noCachedValues: true }));
    await expect(page.getByTestId('problem-empty_cached')).toContainText('Open the file in Excel, save it');
    await expect(page.getByTestId('problem-empty_cached')).toContainText('row 2, 3, 4');

    await input.setInputFiles(await file(simpleRows(3), 'bad-time.xlsx', { overrides: [[1, 'Stop Time', 'tomorrow']] }));
    await expect(page.getByTestId('problem-bad_time')).toContainText('row 3');

    await input.setInputFiles(await file(simpleRows(3), 'bad-failure.xlsx', { overrides: [[0, 'Failure', 'MAYBE'], [2, 'Freq', 7]] }));
    await expect(page.getByTestId('problem-bad_value')).toContainText('Fix them in Excel and choose the file again');
    await expect(page.getByTestId('problem-bad_value')).toContainText('2, 4');
    await expect(page.getByTestId('review')).toHaveCount(0);

    await input.setInputFiles({ name: 'notes.xlsx', mimeType: 'text/plain', buffer: Buffer.from('this is not a workbook') });
    await expect(page.getByTestId('problem-unreadable')).toContainText('cannot be read as an Excel workbook');
    await expect(page.getByTestId('upload-confirm')).toHaveCount(0);

    // a good file still works afterwards
    await input.setInputFiles(await file(simpleRows(2, '2026-11-02')));
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('upload-refused')).toHaveCount(0);
  });

  test('problem rows are stored, flagged and counted: blank classification, unknown area, HD on line L.2', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    const rows: SheetRowSpec[] = [
      ...simpleRows(2, '2026-11-02'),
      { ...simpleRows(1, '2026-11-04')[0]!, description: 'no classification' },
      { ...simpleRows(1, '2026-11-05')[0]!, area: 'ZZ.9', description: 'unknown area row' },
      { ...simpleRows(1, '2026-11-06')[0]!, area: 'HD', line: 'L.2', code: 'N/A', description: 'hd on line two' },
    ];
    await page.getByTestId('file-input').setInputFiles(await file(rows, 'problems.xlsx', { overrides: [[2, 'STOPPAGE CLASIFICATION', null]] }));
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('count-read')).toContainText('5');
    await expect(page.getByTestId('count-new')).toContainText('5');
    await expect(page.getByTestId('rejects-section')).toHaveCount(0);
    await expect(page.getByTestId('count-rejected')).toHaveCount(0);
    const flags = page.getByTestId('flags-section');
    await expect(page.getByTestId('flags-total')).toContainText('3 records will need checking');
    await expect(page.getByTestId('flags-total')).toContainText('2 are left out of the numbers until fixed');
    await expect(flags.getByTestId('flag-missing_classification')).toHaveAttribute('data-blocking', 'yes');
    await expect(flags.getByTestId('flag-unknown_area')).toHaveAttribute('data-blocking', 'yes');
    await expect(flags.getByTestId('flag-unknown_area')).toContainText('left out of the numbers until fixed');
    await expect(flags.getByTestId('flag-line_mismatch')).toHaveAttribute('data-blocking', 'no');
    // blocking flags are listed before the warnings
    const order = await flags.locator('details[data-testid^="flag-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order.indexOf('flag-line_mismatch')).toBeGreaterThan(order.indexOf('flag-unknown_area'));
    await page.getByTestId('upload-confirm').click();
    await expect(page.getByTestId('upload-confirm-dialog')).toContainText('5 rows will be added');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('result-added')).toContainText('5');
    await expect(page.getByTestId('result-skipped')).toContainText('0');
    await expect(page.getByTestId('result-needs-checking')).toContainText('3 records need checking');
    await expect(page.getByTestId('result-blocking')).toContainText('2 have a blocking problem');
    await expect(page.getByTestId('result-validate-link')).toHaveAttribute('href', /\/validate$/);
    // all five are stored: the explorer finds each one
    await page.getByTestId('open-events').click();
    for (const text of ['no classification', 'unknown area row', 'hd on line two']) {
      await page.getByTestId('event-search').fill(text);
      await expect(page.getByTestId('event-row')).toHaveCount(1);
    }
    // the same file again: nothing is new, nothing is lost
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Upload' }).click();
    await page.getByTestId('file-input').setInputFiles(await file(rows, 'problems.xlsx', { overrides: [[2, 'STOPPAGE CLASIFICATION', null]] }));
    await expect(page.getByTestId('count-identical')).toContainText('5');
    await expect(page.getByTestId('count-new')).toContainText('0');
    await expect(page.getByTestId('flags-none')).toBeVisible();
  });

  test('a month with nothing stored is decided as a whole: Add month or Skip month', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    // January 2025 is older than everything stored; two single late rows sit in October 2026, which already has stored rows
    const rows = [...simpleRows(6, '2025-01-10'), ...simpleRows(2, '2026-10-05', { code: '131.BC110' })];
    await page.getByTestId('file-input').setInputFiles(await file(rows, 'old-month.xlsx'));
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('count-late-months')).toContainText('1');
    await expect(page.getByTestId('count-late')).toContainText('2');
    const month = page.getByTestId('late-month');
    await expect(month).toHaveCount(1);
    await expect(month).toContainText('January 2025: 6 rows');
    await expect(month).toContainText('not stored yet');
    await expect(page.getByTestId('late-row')).toHaveCount(2);
    await expect(page.getByTestId('late-progress')).toContainText('0 of 3 decided');
    await expect(page.getByTestId('upload-confirm')).toBeDisabled();
    await month.getByTestId('month-skip').click();
    await expect(page.getByTestId('upload-confirm')).toBeDisabled();
    await page.getByTestId('late-add').first().click();
    await page.getByTestId('late-add').last().click();
    await expect(page.getByTestId('upload-confirm')).toBeEnabled();
    await expect(page.getByTestId('upload-confirm')).toContainText('Upload 2 rows');
    await month.getByTestId('month-add').click();
    await expect(page.getByTestId('upload-confirm')).toContainText('Upload 8 rows');
    await page.getByTestId('skip-all').click();
    await expect(page.getByTestId('upload-bar-text')).toContainText('nothing new to add');
    await page.getByTestId('add-all').click();
    await page.getByTestId('upload-confirm').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('result-added')).toContainText('8');
    // the batch records the month decision
    const first = page.getByTestId('history-row').first();
    await first.getByTestId('history-warnings').click();
    await expect(page.getByTestId('batch-group-late_month')).toContainText('Added');
    await page.keyboard.press('Escape');
    // now January has stored rows: the same file shows nothing late
    await page.getByTestId('upload-another').click();
    await page.getByTestId('file-input').setInputFiles(await file(rows, 'old-month.xlsx'));
    await expect(page.getByTestId('count-identical')).toContainText('8');
    await expect(page.getByTestId('late-section')).toHaveCount(0);
  });

  test('a large file is sent in chunks with progress', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await openUpload(page);
    await page.getByTestId('file-input').setInputFiles(await file(simpleRows(650, '2026-11-02', {}), 'large.xlsx'));
    await expect(page.getByTestId('count-new')).toContainText('650');
    await page.getByTestId('upload-confirm').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('upload-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('result-added')).toContainText('650');
  });
});

test.describe('upload on a phone', () => {
  for (const width of [360, 390]) {
    test(`flow fits a ${width}px phone`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await signInAndWait(page, 'engineer');
      await openUpload(page, true);
      const fits = async (what: string) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${what}: sideways scroll ${JSON.stringify(r)}`).toBe(true);
      };
      await fits('choose');
      await page.screenshot({ path: `test-results/screens-admin/upload-${width}-1-choose.png` });
      await page.getByTestId('file-input').setInputFiles(await file(monthRows()));
      await expect(page.getByTestId('review')).toBeVisible();
      await fits('review');
      await page.screenshot({ path: `test-results/screens-admin/upload-${width}-2-review.png`, fullPage: true });
      const small = (await smallTargets(page)).filter((s) => !/up-file/.test(s));
      expect(small, `targets under 44px: ${small.join('; ')}`).toEqual([]);
      await page.getByTestId('add-all').click();
      // the action bar stays in view
      const bar = page.getByTestId('upload-bar');
      await expect(bar).toBeInViewport();
      await page.getByTestId('upload-confirm').click();
      await expect(page.getByTestId('upload-confirm-dialog')).toBeVisible();
      await fits('confirm');
      await page.screenshot({ path: `test-results/screens-admin/upload-${width}-3-confirm.png` });
      // Back closes the popup
      await page.goBack();
      await expect(page.getByTestId('upload-confirm-dialog')).toBeHidden();
      await page.getByTestId('upload-confirm').click();
      await page.getByTestId('confirm-ok').click();
      await expect(page.getByTestId('upload-result')).toBeVisible();
      await fits('result');
      await page.screenshot({ path: `test-results/screens-admin/upload-${width}-4-result.png`, fullPage: true });
      await expect(page.getByTestId('history-card').first()).toBeVisible();
      await fits('history');
      await page.getByTestId('history-card').first().click();
      await expect(page.getByTestId('batch-warnings')).toBeVisible();
      await fits('warnings');
      await page.screenshot({ path: `test-results/screens-admin/upload-${width}-5-warnings.png` });
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
});
