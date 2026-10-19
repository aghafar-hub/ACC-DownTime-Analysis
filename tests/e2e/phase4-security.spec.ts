import { expect, test, type Page } from '@playwright/test';
import { signInAndWait, stubFonts, watchConsole } from './helpers';

// Phase 4 (backend 1.10.0, the demo server behaves like it): sign out of all devices from the user menu and, for an
// Admin, from a person's details; only Admins manage Admins; a growing wait after wrong passwords.

async function signOut(page: Page) {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
}

test.describe('phase 4', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test('user menu: sign out of all devices asks first, then ends this session too', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'engineer');
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out-all').click();
    const dlg = page.getByTestId('sign-out-all-dialog');
    await expect(dlg).toContainText('Every place you are signed in ends now');
    await dlg.getByTestId('confirm-cancel').click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out-all').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('login-notice')).toHaveText('You were signed out on all devices.');
    // signing in again works
    await signInAndWait(page, 'engineer');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('only Admins manage Admins; an Admin can sign another person out everywhere', async ({ page }) => {
    await stubFonts(page);
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/users');
    // the Admin gives the manager Edit on Users
    await page.getByTestId('user-row').filter({ hasText: 'Demo Manager' }).getByRole('button', { name: /Open Demo Manager/ }).click();
    await page.getByTestId('access-users-Edit').click();
    await page.getByTestId('access-settings-View').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Page access saved');
    await page.getByTestId('user-close').click();
    // ... and can sign the engineer out on all devices
    await page.getByTestId('user-row').filter({ hasText: 'Demo Engineer' }).getByRole('button', { name: /Open Demo Engineer/ }).click();
    await page.getByTestId('user-sign-out-all').click();
    await page.getByTestId('user-sign-out-all-dialog').getByTestId('confirm-ok').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Demo Engineer was signed out on all devices.');
    await page.getByTestId('user-close').click();
    await signOut(page);

    // the manager: non-Admins as before, the Admin read-only, no Admin role to give
    // on the same page: a reload would restart the demo server and forget the access just given
    await page.getByTestId('login-email').fill('manager@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.goto('/#/settings/users');
    await page.getByTestId('user-row').filter({ hasText: 'Demo Admin' }).getByRole('button', { name: /Open Demo Admin/ }).click();
    await expect(page.getByTestId('admin-only-note')).toHaveText(/Only an Admin can change an Admin\./);
    await expect(page.getByTestId('save-user')).toHaveCount(0);
    await expect(page.getByTestId('reset-password')).toHaveCount(0);
    await expect(page.getByTestId('user-sign-out-all')).toHaveCount(0);
    await expect(page.getByTestId('u-name')).toBeDisabled();
    await page.getByTestId('user-close').click();
    await page.getByTestId('user-row').filter({ hasText: 'Demo Viewer' }).getByRole('button', { name: /Open Demo Viewer/ }).click();
    await expect(page.getByTestId('admin-only-note')).toHaveCount(0);
    await expect(page.getByTestId('reset-password')).toBeVisible();
    await expect(page.getByTestId('u-role-ROLE-ADMIN')).toBeDisabled();
    await page.getByTestId('user-close').click();
    await page.getByTestId('add-user').click();
    await expect(page.getByTestId('cu-role-ROLE-ADMIN')).toBeDisabled();
  });

  test('wrong passwords: from the fifth a wait, said in minutes', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('login-email').fill('viewer@demo.test');
      await page.getByTestId('login-password').fill('Wrong-password-1');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('login-error')).toBeVisible();
    }
    await expect(page.getByTestId('login-error')).toContainText('Too many attempts. Try again in 1 minute.');
  });
});
