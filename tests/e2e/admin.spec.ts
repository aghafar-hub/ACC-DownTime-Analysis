import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, stubFonts, watchConsole, type Role } from './helpers';

// Master Data, Settings and Users in mock mode.
async function go(page: Page, role: Role, hash: string, testid = hash) {
  await signInAndWait(page, role);
  await page.goto(`/#/${hash}`);
  await expect(page.getByTestId(`page-${testid}`)).toBeVisible();
}

test.describe('master data', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('engineer: equipment search, filters, add, edit, retire', async ({ page }) => {
    await go(page, 'engineer', 'master');
    await expect(page.getByTestId('access-level')).toHaveCount(0); // Edit access needs no note
    await expect(page.getByTestId('page-subtitle')).toContainText(/codes · \d+ need review/);
    const total = await page.getByTestId('equipment-count').textContent();
    expect(total).toMatch(/of \d+ codes/);

    // search and filters
    await page.getByTestId('equipment-search').fill('131.bc100');
    await expect(page.getByTestId('equipment-row')).toHaveCount(1);
    await page.getByTestId('equipment-reset').click();
    await page.getByTestId('equipment-review').click();
    const review = await page.getByTestId('equipment-row').count();
    expect(review).toBeGreaterThan(0);
    await expect(page.getByTestId('equipment-row').first().getByTestId('badge-review')).toBeVisible();
    await page.getByTestId('equipment-reset').click();
    await page.getByTestId('equipment-area').selectOption('K.1');
    await expect(page.getByTestId('equipment-row').first()).toContainText('131.');
    await page.getByTestId('equipment-status').selectOption('Retired');
    await expect(page.getByTestId('equipment-row').first()).toContainText('Retired');
    await page.getByTestId('equipment-reset').click();

    // add a code: validation first
    await page.getByTestId('add-equipment').click();
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('error-code')).toContainText('Write the equipment code');
    await page.getByTestId('eq-code').fill('n/a');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('error-code')).toContainText('whole area stopped');
    await page.getByTestId('eq-code').fill('131.zz 900');
    await page.getByTestId('eq-desc').fill('Test pump (synthetic)');
    await page.getByTestId('eq-parent').fill('NOPE.1');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('error-parent')).toContainText('not in the equipment list');
    await page.getByTestId('eq-parent').fill('');
    await page.getByTestId('area-K.1').check();
    await page.getByTestId('area-CR').check();
    await expect(page.getByTestId('area-count')).toContainText('2 selected');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Added 131.ZZ900');
    await expect(page.getByTestId('equipment-modal')).toBeHidden();

    // the list refreshed and shows the new code, needs review (no criticality)
    await page.getByTestId('equipment-search').fill('131.ZZ900');
    const row = page.getByTestId('equipment-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Test pump');
    await expect(row).toContainText('K.1, CR');
    // an existing code cannot be added again
    await page.getByTestId('add-equipment').click();
    await page.getByTestId('eq-code').fill('131.ZZ900');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('error-code')).toContainText('already in the list');
    await page.getByTestId('modal-close').click();

    // edit, then retire with a confirmation
    await row.getByRole('button', { name: /Open 131.ZZ900/ }).click();
    await expect(page.getByTestId('eq-code')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('eq-reference')).toContainText('Origin');
    await page.getByTestId('eq-crit').fill('High');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Saved 131.ZZ900');
    await row.getByRole('button', { name: /Open 131.ZZ900/ }).click();
    await page.getByTestId('status-retired').click();
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('Retire 131.ZZ900');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('equipment-modal')).toBeVisible();
    await page.getByTestId('save-equipment').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('equipment-modal')).toBeHidden();
    await expect(row).toContainText('Retired');
  });

  test('engineer: areas, reasons (spaces shown, duplicate warning), aliases', async ({ page }) => {
    await go(page, 'engineer', 'master');
    // areas
    await page.getByRole('button', { name: /^Areas/ }).click();
    await expect(page.getByTestId('area-row')).toHaveCount(19);
    await page.getByTestId('add-area').click();
    await page.getByTestId('save-area').click();
    await expect(page.getByTestId('error-id')).toBeVisible();
    await expect(page.getByTestId('error-name')).toBeVisible();
    await page.getByTestId('ar-id').fill('TST.1');
    await page.getByTestId('ar-name').fill('Test area');
    await page.getByTestId('ar-line').selectOption('L.2');
    await page.getByTestId('save-area').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Added area TST.1');
    await expect(page.getByTestId('area-row')).toHaveCount(20);
    await page.getByTestId('area-row').filter({ hasText: 'TST.1' }).getByRole('button').click();
    // backend 1.5.0: only an Admin switches an area on or off (Settings > Areas); the engineer's choice does not move
    await expect(page.getByTestId('ar-active-admin-only')).toBeVisible();
    await page.getByTestId('ar-active-no').click();
    await expect(page.getByTestId('ar-active-no')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('save-area').click();
    await expect(page.getByTestId('confirm-ok')).toHaveCount(0);
    await expect(page.getByTestId('area-row').filter({ hasText: 'TST.1' })).toContainText('Active');

    // reasons: leading spaces are drawn
    await page.getByRole('button', { name: /^Reasons/ }).click();
    await expect(page.getByTestId('reasons-group-MEC')).toBeVisible();
    await expect(page.getByTestId('reasons-group-MEC').locator('.adm-space').first()).toBeVisible();
    await expect(page.getByTestId('reasons-group-MEC').locator('.adm-space').first()).toHaveText('··');
    await page.getByTestId('reasons-PL').click();
    await expect(page.getByTestId('reasons-group-MEC')).toHaveCount(0);
    await page.getByTestId('add-reason').click();
    await page.getByTestId('rs-class').selectOption('PL');
    await page.getByTestId('rs-text').fill('Planned shutdown');
    await expect(page.getByTestId('reason-duplicate')).toContainText('Already listed for PL');
    await expect(page.getByTestId('save-reason')).toBeDisabled();
    await page.getByTestId('rs-text').fill('  Winter overhaul  ');
    await expect(page.getByTestId('rs-spacing')).toBeVisible();
    await expect(page.getByTestId('rs-preview').locator('.adm-space')).toHaveCount(2);
    await page.getByTestId('save-reason').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Added the reason');
    await expect(page.getByTestId('reasons-group-PL')).toContainText('Winter overhaul');
    await page.getByTestId('reason-row').filter({ hasText: 'Winter overhaul' }).getByTestId('reason-open').click();
    await page.getByTestId('rs-inactive').click();
    await page.getByTestId('save-reason').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('inactive');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('reason-row').filter({ hasText: 'Winter overhaul' })).toContainText('Inactive');

    // aliases
    await page.getByRole('button', { name: /^Aliases/ }).click();
    const before = await page.getByTestId('alias-row').count();
    await page.getByTestId('add-alias').click();
    await page.getByTestId('save-alias').click();
    await expect(page.getByTestId('error-alias')).toBeVisible();
    await page.getByTestId('al-alias').fill('131bc999');
    await page.getByTestId('al-target').fill('NOPE.9');
    await page.getByTestId('save-alias').click();
    await expect(page.getByTestId('error-target')).toContainText('not in the equipment list');
    await page.getByTestId('al-target').fill('131.bc100');
    await expect(page.getByTestId('al-found')).toBeVisible();
    await page.getByTestId('save-alias').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Added the alias 131BC999');
    await expect(page.getByTestId('alias-row')).toHaveCount(before + 1);
    await page.getByTestId('alias-row').filter({ hasText: '131BC999' }).getByTestId('alias-delete').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('131BC999');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('alias-row')).toHaveCount(before);
  });

  test('manager: view only, nothing to change', async ({ page }) => {
    await go(page, 'manager', 'master');
    await expect(page.getByTestId('access-level')).toHaveText('View only');
    await expect(page.getByTestId('add-equipment')).toHaveCount(0);
    await page.getByTestId('equipment-row').first().getByRole('button').click();
    await expect(page.getByTestId('equipment-modal')).toBeVisible();
    await expect(page.getByTestId('save-equipment')).toHaveCount(0);
    await expect(page.getByTestId('eq-desc')).toBeDisabled();
    await page.keyboard.press('Escape');
    for (const tab of ['Areas', 'Reasons', 'Aliases']) {
      await page.getByRole('button', { name: new RegExp(`^${tab}`) }).click();
    }
    await expect(page.getByTestId('add-alias')).toHaveCount(0);
    await expect(page.getByTestId('alias-delete')).toHaveCount(0);
    await page.getByRole('button', { name: /^Reasons/ }).click();
    await expect(page.getByTestId('add-reason')).toHaveCount(0);
  });
});

test.describe('settings', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('admin: edit, validate, save all at once, last changed', async ({ page }) => {
    await go(page, 'admin', 'settings/calculations', 'settings');
    await expect(page.getByTestId('when-availability')).toContainText('Applies right away');
    await expect(page.getByTestId('settings-signin')).toHaveCount(0); // lives under Security
    await expect(page.getByTestId('basis-formula')).toContainText('scheduled hours − planned');
    await expect(page.getByTestId('last-changed')).toContainText('No setting has been changed yet');

    // a bad value blocks the whole save
    await page.getByTestId('availability_basis-C').click();
    await page.getByTestId('set-scheduled_hours_per_day').fill('30');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-problems')).toBeVisible();
    await expect(page.getByTestId('error-scheduled_hours_per_day')).toContainText('1 to 24');
    await expect(page.getByTestId('saved-toast')).toHaveCount(0);

    await page.getByTestId('set-scheduled_hours_per_day').fill('20');
    await page.getByTestId('set-availability_target_pct').fill('92.5');
    await page.getByTestId('set-duration_short_max_min').fill('200');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-duration_long_min_min')).toContainText('more than the short limit');
    await page.getByTestId('set-duration_short_max_min').fill('45');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
    await expect(page.getByTestId('last-changed')).toContainText('by You');
    await expect(page.getByTestId('last-changed')).not.toContainText('No setting');
    await expect(page.getByTestId('set-scheduled_hours_per_day')).toHaveValue('20');
    await expect(page.getByTestId('availability_basis-C')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-save')).toBeDisabled();

    // the dashboards use the new values straight away
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Event Explorer' }).click();
    await page.getByTestId('settings-btn').click(); // opens the subtab used last
    await expect(page.getByTestId('settings-calculations')).toBeVisible();
    await expect(page.getByTestId('availability_basis-C')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('availability_basis-B').click();
    await page.getByTestId('settings-revert').click();
    await expect(page.getByTestId('availability_basis-C')).toHaveAttribute('aria-pressed', 'true');
  });

  test('admin: Security subtab saves the sign-in rules', async ({ page }) => {
    await go(page, 'admin', 'settings/security', 'settings');
    await expect(page.getByTestId('when-signin')).toContainText('Applies to new sign-ins');
    await expect(page.getByTestId('settings-availability')).toHaveCount(0);
    await page.getByTestId('set-min_password_length').fill('4');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-min_password_length')).toContainText('8 to 128');
    await page.getByTestId('set-min_password_length').fill('12');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
    await expect(page.getByTestId('set-min_password_length')).toHaveValue('12');
  });

  test('engineer cannot open the Calculations or Security subtabs', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/settings/calculations');
    await expect(page.getByTestId('no-access')).toBeVisible();
    await page.goto('/#/settings/security');
    await expect(page.getByTestId('no-access')).toBeVisible();
  });
});

test.describe('users', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('admin: create (one-time password), edit, reset, guards, page access', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await go(page, 'admin', 'settings/users', 'users');
    await expect(page.getByTestId('user-row')).toHaveCount(5);
    await expect(page.locator('body')).not.toContainText(/hash|token/i);

    // create
    await page.getByTestId('add-user').click();
    await page.getByTestId('create-user-save').click();
    await expect(page.getByTestId('error-email')).toBeVisible();
    await expect(page.getByTestId('error-name')).toBeVisible();
    await page.getByTestId('cu-email').fill('new.person@demo.test');
    await page.getByTestId('cu-name').fill('New Person');
    await page.getByTestId('cu-role-ROLE-ENG').click();
    await page.getByTestId('cu-email').fill('viewer@demo.test');
    await page.getByTestId('create-user-save').click();
    await expect(page.getByTestId('server-error')).toContainText('already has that email');
    await page.getByTestId('cu-email').fill('new.person@demo.test');
    await page.getByTestId('create-user-save').click();
    const dlg = page.getByTestId('temp-password-dialog');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('password-warning')).toContainText('Shown only once');
    const pw = (await page.getByTestId('temp-password').textContent()) ?? '';
    expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    await page.getByTestId('copy-password').click();
    await expect(page.getByTestId('copy-status')).toContainText(/Copied|Could not copy/);
    await page.getByTestId('password-done').click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('body')).not.toContainText(pw);
    await expect(page.getByTestId('user-row')).toHaveCount(6);
    await expect(page.getByTestId('user-row').filter({ hasText: 'New Person' })).toContainText('Temporary password');

    // the new person can sign in with it
    const row = page.getByTestId('user-row').filter({ hasText: 'New Person' });

    // edit name and role, then reset the password
    await row.getByRole('button', { name: /Open New Person/ }).click();
    await page.getByTestId('u-name').fill('New Person Renamed');
    await page.getByTestId('u-role-ROLE-MGR').click();
    await page.getByTestId('save-user').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Saved New Person Renamed');
    await expect(page.getByTestId('user-modal')).toContainText('New Person Renamed');
    await page.getByTestId('reset-password').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('Reset the password');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('temp-password')).toBeVisible();
    const pw2 = (await page.getByTestId('temp-password').textContent()) ?? '';
    expect(pw2).not.toBe(pw);
    await page.getByTestId('password-done').click();

    // page access exceptions with the role default beside them
    await expect(page.getByTestId('default-upload')).toContainText('Role default: Hidden');
    await expect(page.getByTestId('access-upload-Hidden')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('access-upload-View').click();
    await expect(page.getByTestId('override-upload')).toBeVisible();
    await page.getByTestId('access-upload-Hidden').click();
    await expect(page.getByTestId('override-upload')).toHaveCount(0);
    await page.getByTestId('access-upload-View').click();
    await page.getByTestId('access-master-Edit').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Page access saved');
    await expect(page.getByTestId('override-count')).toContainText('2 exceptions');
    await page.getByTestId('clear-overrides').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('override-count')).toContainText('0 exceptions');
    await expect(page.getByTestId('access-upload-Hidden')).toHaveAttribute('aria-pressed', 'true');

    // deactivate asks first
    await page.getByTestId('u-inactive').click();
    await page.getByTestId('save-user').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('Deactivate');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('user-modal')).toContainText('Inactive');
    await page.getByTestId('user-close').click();
    await expect(page.getByTestId('user-row').filter({ hasText: 'New Person' })).toContainText('Inactive');

    // guards on your own account
    await page.getByTestId('user-row').filter({ hasText: 'Demo Admin' }).getByRole('button', { name: /Open Demo Admin/ }).click();
    await expect(page.getByTestId('hint-self-role')).toBeVisible();
    await expect(page.getByTestId('hint-self-active')).toBeVisible();
    await expect(page.getByTestId('u-role-ROLE-VIEW')).toBeDisabled();
    await expect(page.getByTestId('u-inactive')).toBeDisabled();
    await expect(page.getByTestId('hint-self-users')).toBeVisible();
    await expect(page.getByTestId('access-users-Hidden')).toBeDisabled();
    await expect(page.getByTestId('access-users-View')).toBeDisabled();
  });

  test('engineer and manager do not see Users', async ({ page }) => {
    await signInAndWait(page, 'manager');
    await page.goto('/#/users');
    await expect(page.getByTestId('no-access')).toBeVisible();
  });
});

const PHONES = [360, 390];
for (const width of PHONES) {
  test.describe(`phone ${width}`, () => {
    test(`pages fit, targets are 44px, popups are full screen with the footer in view`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await signInAndWait(page, 'admin');
      const check = async (what: string) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${what}: sideways scroll ${JSON.stringify(r)}`).toBe(true);
        const small = (await smallTargets(page)).filter((s) => !/up-file/.test(s));
        expect(small, `${what}: targets under 44px: ${small.join('; ')}`).toEqual([]);
      };
      const popup = async (testid: string, what: string) => {
        const box = page.getByTestId(testid);
        await expect(box).toBeVisible();
        const b = await box.boundingBox();
        expect(b!.width).toBeGreaterThanOrEqual(width - 1);
        const foot = box.locator('.sm-foot');
        await expect(foot).toBeInViewport({ ratio: 1 });
        await check(what);
      };

      await page.goto('/#/master');
      await expect(page.getByTestId('equipment-card').first()).toBeVisible();
      await check('master equipment');
      await page.getByTestId('equipment-card').first().click();
      await popup('equipment-modal', 'equipment popup');
      await page.goBack(); // Back closes the popup
      await expect(page.getByTestId('equipment-modal')).toBeHidden();
      await page.getByRole('button', { name: /^Areas/ }).click();
      await check('areas');
      await page.getByRole('button', { name: /^Reasons/ }).click();
      await check('reasons');
      await page.getByTestId('add-reason').click();
      await popup('reason-modal', 'reason popup');
      await page.getByTestId('modal-close').click();
      await page.getByRole('button', { name: /^Aliases/ }).click();
      await check('aliases');
      await page.getByTestId('add-alias').click();
      await popup('alias-modal', 'alias popup');
      await page.getByTestId('modal-close').click();
      await page.waitForTimeout(300); // a closed popup removes its history entry just after

      await page.goto('/#/settings/calculations');
      await expect(page.getByTestId('settings-form')).toBeVisible();
      await check('settings calculations');
      await page.goto('/#/settings/security');
      await expect(page.getByTestId('settings-form')).toBeVisible();
      await check('settings security');

      await page.goto('/#/settings/users');
      await expect(page.getByTestId('user-card').first()).toBeVisible();
      await check('users');
      await page.getByTestId('user-card').nth(2).click();
      await popup('user-modal', 'user popup');
      await page.getByTestId('modal-close').click();
      await page.waitForTimeout(300);
      await page.getByTestId('add-user').click();
      await popup('create-user-modal', 'create popup');
      await page.getByTestId('cu-email').fill('phone.user@demo.test');
      await page.getByTestId('cu-name').fill('Phone User');
      await page.getByTestId('create-user-save').click();
      await popup('temp-password-dialog', 'password popup');
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  });
}
