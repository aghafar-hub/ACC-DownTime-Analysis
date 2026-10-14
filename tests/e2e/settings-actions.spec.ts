import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, stubFonts, watchConsole, type Role } from './helpers';

// Settings > Actions & targets (docs/actions-mockups/desktop-settings-actions.png): who can close actions, the contractors,
// the draft rules with Run checks now, and the area targets per year with the live month-split check. Edit on Settings
// changes them; View shows them read-only. The mock keeps its state in memory: no reloads inside a test.
const targetRow = (page: Page, area: string) => page.locator(`[data-testid=target-row][data-area="${area}"]`);

async function signInHere(page: Page, role: Role) {
  await page.getByTestId('login-email').fill(`${role}@demo.test`);
  await page.getByTestId('login-password').fill('Demo-Pass-1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('page-title')).toBeVisible();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('who can close: add and remove people (saved with saveSettings)', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/actions');
    await expect(page.getByTestId('breadcrumb')).toContainText('Actions & targets');
    // the demo makes the Manager a closer
    await expect(page.getByTestId('closer')).toHaveText(['DMDemo Manager']);
    await page.getByTestId('closer-pick').selectOption({ label: 'Demo Engineer' });
    await page.getByTestId('closer-add').click();
    await expect(page.getByTestId('closer')).toHaveCount(2);
    await page.getByTestId('closers-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Who can close actions is saved.');
    await expect(page.getByTestId('closers-save')).toHaveCount(0);
    await page.locator('[data-testid=closer][data-id=U-DEMO-MGR]').getByTestId('closer-remove').click();
    await page.getByTestId('closers-save').click();
    await expect(page.getByTestId('closer')).toHaveText(['DEDemo Engineer']);
    // the engineer may now close actions
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await signInHere(page, 'engineer');
    await page.goto('/#/actions');
    await page.getByTestId('action-card').filter({ hasText: 'Liner worn' }).getByTestId('action-open').click();
    await expect(page.getByTestId('action-closers-note')).toContainText('You are on the list');
    await expect(page.getByTestId('action-next')).toContainText('Move to Closed');
  });

  test('contractors: areas, default person, one active contractor per area', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/actions');
    await expect(page.getByTestId('contractor-row')).toHaveCount(6);
    const asec = page.locator('[data-testid=contractor-row][data-id=ASEC]');
    await asec.getByTestId('contractor-areas-btn').click();
    await asec.getByTestId('contractor-area-K.1').click();
    // K.1 belongs to RHI already
    await expect(page.getByTestId('contractor-problem')).toContainText('K.1 would belong to both');
    await expect(page.getByTestId('contractors-save')).toBeDisabled();
    await asec.getByTestId('contractor-area-K.1').click();
    await asec.getByTestId('contractor-area-HD').click();
    await expect(page.getByTestId('contractor-problem')).toContainText('HD would belong to both');
    await asec.getByTestId('contractor-area-HD').click();
    await expect(page.getByTestId('contractor-problem')).toHaveCount(0);
    const rhi = page.locator('[data-testid=contractor-row][data-id=RHI]');
    await rhi.getByTestId('contractor-assignee').selectOption({ label: 'Demo Engineer' });
    await page.getByTestId('contractors-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Contractors saved.');
    await expect(rhi.getByTestId('contractor-assignee')).toHaveValue('U-DEMO-ENG');
    // a new action in an RHI area gets RHI and its default person
    await page.goto('/#/actions');
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-scope-area').click();
    await page.getByTestId('ca-area').selectOption('K.2');
    await expect(page.getByTestId('ca-owner')).toHaveValue('RHI');
    await expect(page.getByTestId('ca-assignee')).toHaveValue('U-DEMO-ENG');
  });

  test('rules and Run checks now', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/actions');
    await expect(page.getByTestId('settings-action-rules')).toBeVisible();
    await expect(page.getByTestId('set-actions_closers')).toHaveCount(0); // edited with the people picker above
    await page.getByTestId('set-actions_repeat_n').fill('1');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-actions_repeat_n')).toBeVisible();
    await page.getByTestId('set-actions_repeat_n').fill('4');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Settings saved.');
    await page.getByTestId('run-action-checks').click();
    await expect(page.getByTestId('run-action-checks-result')).toContainText(/\d+ drafts created, \d+ merged into open actions, \d+ effectiveness verdicts/);
  });

  test('area targets: the 12 months must add up to the allowance (live), Even split, overhaul months, saved per year', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/actions');
    const year = new Date().getFullYear();
    await expect(page.getByTestId('targets-year')).toHaveValue(String(year));
    // demo targets: CR 92 %, 240 h, even
    const cr = targetRow(page, 'CR');
    await expect(cr.getByTestId('target-pct')).toHaveValue('92');
    await expect(cr.getByTestId('target-allowance')).toHaveValue('240');
    await expect(cr.getByTestId('target-split-summary')).toHaveText('Even · 20 h/mo');
    await cr.getByTestId('target-expand').click();
    const months = page.getByTestId('target-months');
    await expect(months.getByTestId('target-sum')).toContainText('add up to 240 h = the 240 h allowed');
    await months.getByTestId('target-month-1').fill('30');
    await expect(months.getByTestId('target-sum')).toContainText('not 240 h (+10 h)');
    await expect(page.getByTestId('targets-bar')).toContainText('1 unsaved: CR');
    await page.getByTestId('targets-save').click();
    await expect(page.getByTestId('targets-problems')).toContainText('Nothing was saved');
    await expect(cr.getByTestId('target-split-summary')).toContainText('does not add up');
    // within 0.1 h is fine
    await months.getByTestId('target-month-1').fill('20');
    await months.getByTestId('target-month-2').fill('20.05');
    await expect(months.getByTestId('target-sum')).toContainText('= the 240 h allowed');
    await months.getByTestId('target-month-2').fill('20.2');
    await expect(months.getByTestId('target-sum')).toContainText('not 240 h (+0.2 h)');
    await months.getByTestId('target-even').click();
    await expect(months.getByTestId('target-sum')).toContainText('= the 240 h allowed');
    // a new allowance keeps an even split even; an overhaul month is marked
    await cr.getByTestId('target-allowance').fill('360');
    await expect(months.getByTestId('target-month-1')).toHaveValue('30');
    await expect(months.getByTestId('target-sum')).toContainText('= the 360 h allowed');
    await months.getByTestId('target-overhaul-3').click();
    await expect(cr).toContainText('Mar');
    await cr.getByTestId('target-pct').fill('93.5');
    await page.getByTestId('targets-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText(`Area targets for ${year} saved.`);
    await expect(page.getByTestId('targets-bar')).toHaveCount(0);
    await expect(cr.getByTestId('target-allowance')).toHaveValue('360');
    await expect(cr.getByTestId('target-split-summary')).toHaveText('Even · 30 h/mo');
    // a new area
    const fm = targetRow(page, 'FM.1');
    await fm.getByTestId('target-allowance').fill('120');
    await fm.getByTestId('target-pct').fill('101');
    await page.getByTestId('targets-save').click();
    await expect(page.getByTestId('targets-problems')).toContainText('FM.1');
    await fm.getByTestId('target-pct').fill('85');
    await page.getByTestId('targets-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('saved');
    await expect(fm.getByTestId('target-split-summary')).toHaveText('Even · 10 h/mo');
    // the Dashboard judges FM.1 against its own target now
    await page.goto('/#/dashboard');
    await expect(page.locator('[data-testid=at-row][data-area="FM.1"]')).toHaveAttribute('data-target', '85');
    await expect(page.getByTestId('chart-planned-allowance').locator('[data-testid=pa-row][data-area="FM.1"]')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });

  test('View on Settings: everything read-only; Hidden: no subtab', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.getByTestId('settings-btn').click();
    await expect(page.getByTestId('settings-tabs').getByRole('link', { name: 'Actions & targets' })).toHaveCount(0);
    // the admin gives the manager View on Settings
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await signInHere(page, 'admin');
    await page.goto('/#/settings/users');
    await page.getByTestId('user-row').filter({ hasText: 'Demo Manager' }).getByRole('button', { name: /Open Demo Manager/ }).click();
    await page.getByTestId('access-settings-View').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Page access saved');
    await page.getByTestId('user-close').click();
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await signInHere(page, 'manager');
    await page.goto('/#/settings/actions');
    await expect(page.getByTestId('settings-actions')).toBeVisible();
    await expect(page.getByTestId('access-level').first()).toHaveText('View only');
    await expect(page.getByTestId('closer-remove')).toHaveCount(0);
    await expect(page.getByTestId('closer-pick')).toHaveCount(0);
    await expect(page.getByTestId('contractor-add')).toHaveCount(0);
    await expect(page.getByTestId('contractor-name')).toHaveCount(0);
    await expect(page.getByTestId('run-action-checks')).toHaveCount(0);
    await expect(page.getByTestId('settings-save')).toHaveCount(0);
    await expect(targetRow(page, 'CR').getByTestId('target-allowance')).toHaveAttribute('readonly', '');
    await targetRow(page, 'CR').getByTestId('target-expand').click();
    await expect(page.getByTestId('target-even')).toHaveCount(0);
    await expect(page.getByTestId('target-overhaul-1')).toBeDisabled();
  });
});
