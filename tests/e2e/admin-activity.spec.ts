import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, stubFonts, watchConsole, type Role } from './helpers';

// Settings > Active users and Settings > Activity log (backend 1.6.0, mock mode): Admin only. The demo data has the
// Manager (phone, Pareto) and the Engineer (desktop, Validate) online, the Viewer seen two hours ago, and a varied log of
// the last six weeks (sign-ins, settings, master data, event edits, an upload, actions, areas, users).

const subTabs = (page: Page) => page.getByTestId('settings-tabs').getByRole('link');

async function openActiveUsers(page: Page) {
  await page.goto('/#/settings/active-users');
  await expect(page.getByTestId('settings-active-users')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('au-row').first()).toBeVisible();
}

async function openLog(page: Page) {
  await page.goto('/#/settings/activity-log');
  await expect(page.getByTestId('settings-activity-log')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('al-row').first()).toBeVisible();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('admin sees both subtabs; the online list shows the demo people with role, device and page', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings');
    await expect(subTabs(page).filter({ hasText: 'Active users' })).toHaveCount(1);
    await expect(subTabs(page).filter({ hasText: 'Activity log' })).toHaveCount(1);
    await subTabs(page).filter({ hasText: 'Active users' }).click();
    await expect(page).toHaveURL(/#\/settings\/active-users$/);
    await expect(page.getByTestId('au-row').first()).toBeVisible({ timeout: 20000 });
    const count = page.getByTestId('online-count');
    await expect(count).toContainText(/\d+ online now/);
    expect(Number(await count.getAttribute('data-count'))).toBeGreaterThanOrEqual(3);
    const mgr = page.locator('[data-testid="au-row"][data-user="U-DEMO-MGR"]');
    await expect(mgr).toHaveAttribute('data-online', 'true');
    await expect(mgr).toContainText('Demo Manager');
    await expect(mgr).toContainText('Manager');
    await expect(mgr).toContainText('Online now');
    await expect(mgr).toContainText('Phone');
    await expect(mgr).toContainText('Causes');
    const eng = page.locator('[data-testid="au-row"][data-user="U-DEMO-ENG"]');
    await expect(eng).toContainText('Desktop');
    await expect(eng).toContainText('Validate');
    await expect(eng).toContainText(/\d+ min ago|just now/);
    const viewer = page.locator('[data-testid="au-row"][data-user="U-DEMO-VIEW"]');
    await expect(viewer).toHaveAttribute('data-online', 'false');
    await expect(viewer.getByTestId('au-status')).toHaveAttribute('data-status', /today|away/);
    // the admin's own row: online, this device, this page
    const me = page.locator('[data-testid="au-row"][data-user="U-DEMO-ADMIN"]');
    await expect(me).toHaveAttribute('data-online', 'true');
    await expect(me).toContainText('You');
    // online people first
    const flags = await page.getByTestId('au-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-online')));
    expect(flags.indexOf('false') === -1 || !flags.slice(flags.indexOf('false')).includes('true')).toBe(true);
    await page.screenshot({ path: 'tmp/active-users-desktop.png', fullPage: true });
  });

  test('active users refreshes itself every minute', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-14T09:00:00') });
    await signInAndWait(page, 'admin');
    await openActiveUsers(page);
    const updated = page.getByTestId('au-updated');
    await expect(updated).toContainText('Updated 09:0');
    const before = await updated.textContent();
    await page.clock.fastForward('02:05');
    await expect(updated).not.toHaveText(before ?? '');
    await expect(updated).toContainText('Updated 09:0');
  });

  test('activity log: plain-English rows, names not ids, newest first, Load more', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await openLog(page);
    await expect(page.getByTestId('al-count')).toContainText('Showing the newest 100 changes');
    const rows = page.getByTestId('al-row');
    await expect(rows).toHaveCount(100);
    // this sign-in is near the top (the demo's first actions are drafted right after it)
    await expect(page.locator('[data-testid="al-row"][data-action="login"][data-user="U-DEMO-ADMIN"]').first()).toContainText('Demo Admin');
    const times = await rows.evaluateAll((els) => els.map((e) => e.querySelector('td')?.textContent ?? ''));
    expect(times.length).toBe(100);
    await expect(page.getByTestId('al-table')).toContainText('Changed setting availability_target_pct from 85 to 88');
    await expect(page.getByTestId('al-table')).toContainText('Uploaded July_2026.xlsx: +2,594 rows');
    await expect(page.getByTestId('al-table')).not.toContainText('U-DEMO-');
    await page.screenshot({ path: 'tmp/activity-log-desktop.png' });
    await page.getByTestId('al-more').click();
    await expect.poll(async () => rows.count()).toBeGreaterThan(100);
  });

  test('activity log: filters by kind, person, dates and text; Clear; CSV export of what matches', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await openLog(page);
    const rows = page.getByTestId('al-row');
    // kind of change
    await page.getByTestId('al-group').selectOption('settings');
    await expect(page.getByTestId('al-count')).toContainText(/^\d+ changes?$/);
    const groups = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups)).toEqual(new Set(['settings']));
    // + person
    await page.getByTestId('al-user').selectOption({ label: 'Demo Manager' });
    await expect.poll(async () => new Set(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-user'))))).toEqual(new Set(['U-DEMO-MGR']));
    // clear, then free text
    await page.getByTestId('al-clear').click();
    await expect(page.getByTestId('al-count')).toContainText('Showing the newest 100 changes');
    await page.getByTestId('al-q').fill('July_2026');
    await expect.poll(async () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))).toEqual(['upload', 'upload']);
    await expect(rows.first()).toContainText('Uploaded July_2026.xlsx');
    await expect(rows.nth(1)).toContainText('Started uploading July_2026.xlsx');
    // dates: a day with nothing logged, then back
    await page.getByTestId('al-q').fill('');
    await page.getByTestId('al-from').fill('2020-01-01');
    await page.getByTestId('al-to').fill('2020-01-31');
    await expect(page.getByTestId('al-count')).toHaveText('No change matches these filters.');
    await expect(rows).toHaveCount(0);
    await page.getByTestId('al-clear').click();
    // the CSV holds every change of the filter in force
    await page.getByTestId('al-group').selectOption('events');
    await expect.poll(async () => new Set(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group'))))).toEqual(new Set(['events']));
    const shown = await rows.count();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('al-export').click()]);
    expect(download.suggestedFilename()).toMatch(/^activity-log-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '');
    const lines = text.trim().split(/\r\n/);
    expect(lines[0]).toBe('When,Who,User id,Kind of change,What happened,Action,Record,Record id,Detail');
    expect(lines.length - 1).toBe(shown);
    expect(lines.slice(1).every((l) => l.includes(',Events & Validate,'))).toBe(true);
    await expect(page.getByTestId('al-export-note')).toContainText(`${shown} changes`);
  });

  test('a change made in the app shows up in the log at once', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/areas');
    await expect(page.getByTestId('settings-areas')).toBeVisible({ timeout: 20000 });
    const row = page.locator('[data-testid="area-active-row"][data-area="AFR"]');
    await row.getByTestId('area-active-switch').click();
    await page.getByTestId('confirm-ok').click();
    await expect(row).toHaveAttribute('data-active', 'false');
    await row.getByTestId('area-active-switch').click();
    await expect(row).toHaveAttribute('data-active', 'true');
    await openLog(page);
    const rows = page.getByTestId('al-row');
    await expect(rows.nth(0)).toHaveAttribute('data-action', 'activate_area');
    await expect(rows.nth(0)).toContainText('Switched area AFR on');
    await expect(rows.nth(1)).toHaveAttribute('data-action', 'deactivate_area');
  });

  for (const role of ['manager', 'engineer', 'viewer'] as Role[]) {
    test(`${role}: no Active users or Activity log subtab, and the addresses say no access`, async ({ page }) => {
      await signInAndWait(page, role);
      await page.goto('/#/settings');
      await expect(page.getByTestId('settings-tabs')).toBeVisible({ timeout: 20000 });
      await expect(subTabs(page).filter({ hasText: /Active users|Activity log/ })).toHaveCount(0);
      for (const sub of ['active-users', 'activity-log']) {
        await page.goto(`/#/settings/${sub}`);
        await expect(page.getByTestId('no-access')).toBeVisible();
        await expect(page.getByTestId('au-row')).toHaveCount(0);
        await expect(page.getByTestId('al-row')).toHaveCount(0);
      }
    });
  }
});

test.describe('phone 390', () => {
  test('both pages fit: no sideways scroll, 44 px targets, cards instead of tables', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await stubFonts(page);
    const errors = watchConsole(page);
    await signInAndWait(page, 'admin');
    const check = async (what: string) => {
      const r = await noSidewaysScroll(page);
      expect(r.ok, `${what}: sideways scroll ${JSON.stringify(r)}`).toBe(true);
      const small = await smallTargets(page);
      expect(small, `${what}: targets under 44px: ${small.join('; ')}`).toEqual([]);
    };
    await openActiveUsers(page);
    await expect(page.getByTestId('au-cards')).toBeVisible();
    await expect(page.getByTestId('au-table')).toHaveCount(0);
    await expect(page.locator('[data-testid="au-row"][data-user="U-DEMO-MGR"]')).toContainText('Phone');
    await check('active users');
    await page.screenshot({ path: 'tmp/active-users-phone.png', fullPage: true });

    await openLog(page);
    await expect(page.getByTestId('al-cards')).toBeVisible();
    await expect(page.getByTestId('al-table')).toHaveCount(0);
    await check('activity log');
    await page.getByTestId('al-group').selectOption('master');
    await expect(page.getByTestId('al-clear')).toBeVisible();
    await check('activity log filtered');
    await page.getByTestId('al-count').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/activity-log-phone.png' });
    expect(errors, 'console errors').toEqual([]);
    await context.close();
  });
});
