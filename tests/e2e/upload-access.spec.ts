import { expect, test } from '@playwright/test';
import { buildWorkbook, simpleRows } from '../helpers/makeWorkbook';
import { PASSWORD, signInAndWait, stubFonts, watchConsole } from './helpers';

// Upload: View sees the history only, Edit can upload. The mock keeps its data
// in memory, so everything happens in one page without a reload.
test('View access sees the history but cannot upload; Edit can', async ({ page }) => {
  await stubFonts(page);
  const errors = watchConsole(page);
  await signInAndWait(page, 'admin');

  // the administrator gives the manager View access to Upload
  await page.goto('/#/users');
  await page.getByTestId('user-row').filter({ hasText: 'Demo Manager' }).getByRole('button', { name: /Open Demo Manager/ }).click();
  await page.getByTestId('access-upload-View').click();
  await page.getByTestId('save-access').click();
  await expect(page.getByTestId('saved-toast')).toBeVisible();
  await page.getByTestId('user-close').click();

  // the manager signs in on the same page
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('sign-out').click();
  await page.getByTestId('login-email').fill('manager@demo.test');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('page-title')).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page.getByTestId('page-upload')).toBeVisible();
  await expect(page.getByTestId('access-level')).toHaveText('View only');
  await expect(page.getByTestId('view-only-note')).toBeVisible();
  await expect(page.getByTestId('file-input')).toHaveCount(0);
  await expect(page.getByTestId('choose-file')).toHaveCount(0);
  await expect(page.getByTestId('history-row').first()).toBeVisible();
  await page.getByTestId('history-warnings').first().click();
  await expect(page.getByTestId('batch-warnings')).toBeVisible();
  await page.keyboard.press('Escape');

  expect(errors, 'console errors').toEqual([]);
});

test('engineer (Edit) gets the file chooser', async ({ page }) => {
  await stubFonts(page);
  await signInAndWait(page, 'engineer');
  await page.goto('/#/upload');
  await expect(page.getByTestId('access-level')).toHaveCount(0);
  await expect(page.getByTestId('file-input')).toHaveCount(1);
  await expect(page.getByTestId('view-only-note')).toHaveCount(0);
  // the file chooser is reachable with the keyboard: its button comes first
  await page.getByTestId('choose-file').focus();
  await expect(page.getByTestId('choose-file')).toBeFocused();
  await page.getByTestId('file-input').setInputFiles({ name: 'm.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(await buildWorkbook(simpleRows(2, '2026-11-02'))) });
  await expect(page.getByTestId('review')).toBeVisible();
  // the new review screen: records that need checking, with the Validate link
  await expect(page.getByTestId('flags-section')).toBeVisible();
  await expect(page.getByTestId('nothing-dropped')).toContainText('every row is stored');
});
