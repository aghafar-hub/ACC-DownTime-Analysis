import { expect, test } from '@playwright/test';
import { closePanel, noSidewaysScroll, openType, PASSWORD, pickPeriod, signIn, signInAndWait, smallTargets, stubFonts, watchConsole, type Role } from './helpers';

// Runs against `vite preview` of a production build in mock mode (made-up data).

const ANALYZE = ['Dashboard', 'Pareto', 'Repeated Failures', 'Reliability'];
const ANALYZE_RAIL = ['Dashboard', 'Pareto & Contributors', 'Repeated Failures', 'Reliability Trends'];
const DATA_VIEW = ['Event Explorer', 'Validate'];
// the left rail: every page the role may open, grouped under Analyze / Data / Setup
const RAIL: Record<Role, Record<string, string[]>> = {
  admin: { Analyze: ANALYZE_RAIL, Reports: ['Reports'], Act: ['Actions', 'Notifications'], Data: [...DATA_VIEW, 'Upload'], Setup: ['Master Data'] },
  manager: { Analyze: ANALYZE_RAIL, Reports: ['Reports'], Act: ['Actions', 'Notifications'], Data: DATA_VIEW, Setup: ['Master Data'] },
  engineer: { Analyze: ANALYZE_RAIL, Reports: ['Reports'], Act: ['Actions', 'Notifications'], Data: [...DATA_VIEW, 'Upload'], Setup: ['Master Data'] },
  viewer: { Analyze: ANALYZE_RAIL, Reports: ['Reports'], Act: ['Actions', 'Notifications'], Data: DATA_VIEW },
};

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => {
    expect(errors, 'console errors').toEqual([]);
  });

  test('login screen has the brand, the fields and the footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'Arabian Cement Company' })).toBeVisible();
    await expect(page.getByTestId('login-keep')).toBeChecked();
    await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
    await expect(page.locator('.auth-footer')).toHaveText('Arabian Cement Company');
  });

  test('a wrong password shows one plain message, then the right one works', async ({ page }) => {
    await signIn(page, 'viewer', 'not-the-password');
    await expect(page.getByTestId('login-error')).toHaveText('Email or password is not correct.');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
  });

  for (const role of Object.keys(RAIL) as Role[]) {
    test(`${role}: sees exactly the pages the role allows, under the right sections`, async ({ page }) => {
      await signInAndWait(page, role);
      await expect(page.getByTestId('user-name')).toContainText(`Demo ${role[0].toUpperCase()}${role.slice(1)}`);
      await expect(page.getByTestId('breadcrumb')).toHaveText('Analyze›Dashboard');
      await expect(page.getByTestId('topbar-title')).toHaveText('Dashboard');
      await expect(page.getByTestId('online-dot')).toBeVisible();
      // the left rail: section headings in order, each with its pages; empty sections are gone
      const rail = page.getByRole('navigation', { name: 'Primary' });
      const want = RAIL[role];
      const headings = await rail.locator('.sidebar-section-title').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
      expect(headings).toEqual(Object.keys(want));
      for (const [section, labels] of Object.entries(want)) {
        const names = await rail.locator(`[data-section="${section.toLowerCase()}"] a`).evaluateAll((els) => els.map((el) => (el.querySelector('.sidebar-link-label')?.textContent ?? '').trim()));
        expect(names, section).toEqual(labels);
      }
      if (!want.Setup) await expect(rail.locator('[data-section="setup"]')).toHaveCount(0);
      expect(await rail.getByRole('link').count()).toBe(Object.values(want).flat().length);
    });
  }

  test('page tabs show only the siblings of the open page, and none for Setup (icon rail at every width)', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await expect(page.getByTestId('rail')).toHaveAttribute('data-mode', 'icons');
    const tabNames = () => page.getByRole('navigation', { name: 'Pages' }).getByRole('link').evaluateAll((els) => els.map((el) => (el.firstChild?.textContent ?? '').trim()));
    expect(await tabNames()).toEqual(ANALYZE);
    await page.goto('/#/events');
    await expect(page.getByTestId('page-events')).toBeVisible();
    expect(await tabNames()).toEqual(['Event Explorer', 'Validate', 'Upload']);
    await expect(page.getByTestId('breadcrumb')).toHaveText('Data›Event Explorer');
    await page.goto('/#/master');
    await expect(page.getByTestId('page-master')).toBeVisible();
    await expect(page.getByTestId('page-tabs')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
    await expect(page.getByTestId('breadcrumb')).toHaveText('Setup›Master Data');
    // a page named like its section is not said twice ('Reports › Reports')
    await page.goto('/#/reports');
    await expect(page.getByTestId('breadcrumb')).toHaveText('Reports');
    // Settings sits behind the gear: no section, no tabs
    await page.getByTestId('settings-btn').click();
    await expect(page.getByTestId('page-tabs')).toHaveCount(0);
  });

  test('the rail shows section headings when open and a thin divider when narrow', async ({ page }) => {
    await signInAndWait(page, 'admin');
    const title = page.getByTestId('rail-section-data');
    // the icon rail: headings show while it is open (hover), a divider when it closes by itself
    await page.getByTestId('rail-panel').hover();
    await expect(title).toBeVisible();
    await page.mouse.move(800, 500);
    await expect(title).toBeHidden();
    const border = await page.locator('[data-section="data"]').evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).toBe('1px');
    await page.getByTestId('rail-panel').hover();
    await expect(title).toBeVisible();
    await expect(page.getByTestId('rail-section-analyze')).toHaveText('Analyze');
    await expect(title).toHaveText('Data');
    await expect(page.getByTestId('rail-section-setup')).toHaveText('Setup');
  });

  test('a deep link to a hidden tab shows a plain "You do not have access" page', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.goto('/#/users');
    await expect(page.getByTestId('no-access')).toContainText('You do not have access');
    await page.goto('/#/settings/security');
    await expect(page.getByTestId('no-access')).toBeVisible();
    await page.goto('/#/upload');
    await expect(page.getByTestId('no-access')).toBeVisible();
  });

  test('every page opens for the admin (no placeholders left)', async ({ page }) => {
    await signInAndWait(page, 'admin');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const pages: [string, string][] = [
      ['Dashboard', 'page-overview'],
      ['Pareto', 'page-pareto'],
      ['Repeated Failures', 'page-repeats'],
      ['Reliability', 'page-reliability'],
      ['Event Explorer', 'page-events'],
      ['Validate', 'page-validate'],
      ['Upload', 'page-upload'],
      ['Master Data', 'page-master'],
    ];
    for (const [label, id] of pages) {
      await nav.getByRole('link', { name: label }).first().click();
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Built in the next step')).toHaveCount(0);
    }
    // Settings and its subtabs are reached from the gear
    await page.getByTestId('settings-btn').click();
    await expect(page.getByTestId('page-settings')).toBeVisible();
    await expect(page.getByTestId('theme-picker')).toBeVisible();
    const subs: [string, string][] = [['Calculations', 'settings-calculations'], ['Security', 'settings-security'], ['Users and access', 'page-users'], ['Appearance', 'settings-appearance']];
    for (const [label, id] of subs) {
      await page.getByTestId('settings-tabs').getByRole('link', { name: label }).click();
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('breadcrumb')).toHaveText(`Settings›${label}`);
    }
  });

  test('Event Explorer: list, paging, filters, year switch', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Event Explorer' }).click();
    await expect(page.getByTestId('event-row')).toHaveCount(50);
    await page.getByTestId('show-more').click();
    await expect(page.getByTestId('event-row')).toHaveCount(100);
    const total = (await page.getByTestId('tile-shown').innerText()).match(/[\d,]+/)![0];
    expect(Number(total.replace(/,/g, ''))).toBeGreaterThan(1000);

    await page.getByTestId('failure-only').click();
    await expect(page.getByTestId('event-row').first()).toContainText('Failure');
    const failures = await page.getByTestId('list-count').textContent();
    await page.getByTestId('failure-only').click();
    // the type filters are the shared scope bar's
    await openType(page);
    await page.getByTestId('fb-cls-PL').click();
    await closePanel(page);
    await expect(page.getByTestId('event-row').first().locator('.badge--class')).toHaveText('PL');
    await page.getByTestId('reset-filters').click();

    await page.getByTestId('event-search').fill('bearing');
    await expect(page.getByTestId('event-row').first()).toContainText(/bearing/i);
    await page.getByTestId('event-search').fill('zzzz-no-such-text');
    await expect(page.getByTestId('no-results')).toBeVisible();
    await page.getByTestId('event-search').fill('');

    // voided and edited rows of the whole year
    await page.getByTestId('year-2026').click();
    await page.getByTestId('filter-show').selectOption('void');
    await expect(page.getByTestId('event-row').first()).toContainText('Void');
    await page.getByTestId('filter-show').selectOption('edited');
    await expect(page.getByTestId('event-row').first()).toContainText('Edited');
    await page.getByTestId('filter-show').selectOption('issues');
    await expect(page.getByTestId('event-row').first().getByTestId('badge-flag').first()).toBeVisible();
    await page.getByTestId('reset-filters').click();

    await pickPeriod(page, 'custom');
    await page.getByTestId('fb-from').fill('2026-03-01');
    await page.getByTestId('fb-to').fill('2026-03-31');
    await closePanel(page);
    await page.getByTestId('fb-area').click();
    await page.locator('[data-testid="fb-area-opt"][data-value="K.1"]').click();
    await expect(page.locator('[data-testid="fb-area-opt"][data-value="K.1"]')).toBeChecked();
    await closePanel(page);
    await expect(page.getByTestId('event-row').first()).toContainText('K.1');
    await expect(page.getByTestId('event-row').first()).toContainText(/\b\d{1,2} Mar \d{2}:\d{2}/); // one year: the dates leave it out
    expect(failures).toContain('matching');

    // the year chips set the shared period to that year
    await page.getByTestId('reset-filters').click();
    await page.getByTestId('year-2025').click();
    await expect(page.getByTestId('page-subtitle')).toContainText('in 1 Jan – 31 Dec 2025');
    await expect(page.getByTestId('scope-period')).toContainText('2025');
    await page.getByTestId('reset-filters').click();
    await expect(page.getByTestId('scope-period')).toContainText('Last 90 days');
  });

  test('viewer cannot see Edit or Void buttons but can read the history', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.goto('/#/events?r=year&y=2026');
    await page.getByTestId('filter-show').selectOption('edited');
    await page.getByTestId('event-row').first().getByRole('button').click();
    await expect(page.getByTestId('event-detail')).toBeVisible();
    await expect(page.getByTestId('edit-event')).toHaveCount(0);
    await expect(page.getByTestId('void-event')).toHaveCount(0);
    await expect(page.getByTestId('restore-event')).toHaveCount(0);
    await expect(page.getByTestId('history-item').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
  });

  test('engineer edits an event and sees the Edited badge and recalculated values', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    // a row that has not been edited yet
    const row = page.getByTestId('event-row').first();
    const id = await row.getAttribute('data-event-id');
    await expect(row.getByTestId('badge-edited')).toHaveCount(0);
    await row.getByRole('button').click();
    await expect(page.getByTestId('no-history')).toBeVisible();
    await page.getByTestId('edit-event').click();

    // plain-English validation
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('error-note')).toContainText('Write a short note');
    await page.getByTestId('f-note').fill('Checking the form');
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('error-form')).toContainText('Nothing has been changed yet');
    await page.getByTestId('f-code').fill('');
    await page.getByTestId('save-edit').click();
    await expect(page.getByTestId('error-code_raw')).toContainText('Enter the equipment code');
    await page.getByTestId('f-code').fill('999.UNLISTED');
    await page.getByTestId('f-desc').fill('Corrected by e2e test');
    await page.getByTestId('f-class').selectOption('PL');
    await page.getByTestId('f-note').fill('Checked against the control-room log');
    await page.getByTestId('save-edit').click();

    const result = page.getByTestId('edit-result');
    await expect(result).toContainText('Saved');
    await expect(result).toContainText('Equipment: not in the equipment list');
    await expect(result).toContainText('Criticality: NO_INC, failure: no');
    await expect(result).toContainText('Unknown code');
    await expect(page.getByTestId('history-item').first()).toContainText('Checked against the control-room log');
    await expect(page.getByTestId('detail-flags')).toContainText('Unknown code');
    await page.getByTestId('modal-close').click();

    const edited = page.locator(`[data-event-id="${id}"]`);
    await expect(edited.getByTestId('badge-edited')).toBeVisible();
    await expect(edited).toContainText('Unknown code');
  });

  test('engineer voids and restores an event with a note', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    const row = page.getByTestId('event-row').nth(2);
    const id = await row.getAttribute('data-event-id');
    await row.getByRole('button').click();
    await page.getByTestId('void-event').click();
    await page.getByTestId('confirm-void').click();
    await expect(page.getByTestId('error-note')).toBeVisible();
    await page.getByTestId('f-note').fill('Duplicate row');
    await page.getByTestId('confirm-void').click();
    await expect(page.getByTestId('edit-result')).toContainText('voided');
    await expect(page.getByTestId('restore-event')).toBeVisible();
    await page.getByTestId('modal-close').click();
    await expect(page.locator(`[data-event-id="${id}"]`).getByTestId('badge-void')).toBeVisible();
    await page.locator(`[data-event-id="${id}"]`).getByRole('button').click();
    await page.getByTestId('restore-event').click();
    await page.getByTestId('f-note').fill('It was real');
    await page.getByTestId('confirm-void').click();
    await expect(page.getByTestId('edit-result')).toContainText('restored');
    await page.getByTestId('modal-close').click();
    await expect(page.locator(`[data-event-id="${id}"]`).getByTestId('badge-void')).toHaveCount(0);
  });

  test('a temporary password forces a change before anything else', async ({ page }) => {
    await signIn(page, 'newhire@demo.test', 'Temp-Pass-1234');
    await expect(page.getByTestId('change-password-form')).toBeVisible();
    await page.goto('/#/events');
    await expect(page.getByTestId('change-password-form')).toBeVisible();
    await page.getByTestId('cp-current').fill('Temp-Pass-1234');
    await page.getByTestId('cp-new').fill('short');
    await page.getByTestId('cp-confirm').fill('short');
    await page.getByTestId('cp-submit').click();
    await expect(page.getByTestId('cp-error')).toContainText('at least 10');
    await page.getByTestId('cp-new').fill('My-Own-Password-1');
    await page.getByTestId('cp-confirm').fill('Different-Password-1');
    await page.getByTestId('cp-submit').click();
    await expect(page.getByTestId('cp-error')).toContainText('do not match');
    await page.getByTestId('cp-confirm').fill('My-Own-Password-1');
    await page.getByTestId('cp-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
  });

  test('theme choice is kept, and sign-out returns to the login screen', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.getByTestId('settings-btn').click();
    await page.getByRole('radio', { name: /Navy Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'Navy Dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'Navy Dark');
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('offline: a banner says the data is read-only', async ({ page, context }) => {
    await signInAndWait(page, 'engineer');
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toContainText('Offline');
    await expect(page.getByTestId('offline-banner')).toContainText('Uploads and edits need a connection');
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  });

  test('at 1280 the rail is the 68 px icon rail with no collapse button; it opens over the page on hover and closes by itself', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    const rail = page.getByTestId('rail');
    const panel = page.getByTestId('rail-panel');
    await expect(rail).toHaveAttribute('data-mode', 'icons');
    await expect(page.getByTestId('rail-toggle')).toHaveCount(0);
    await expect(page.getByText('Collapse menu')).toHaveCount(0);
    expect((await rail.boundingBox())!.width).toBe(68);
    await expect(page.locator('.sidebar-logo-mark')).toBeVisible();
    await expect(page.locator('.sidebar-logo-full')).toBeHidden();
    // the logo sits straight on the navy rail (no plate behind it)
    expect(await rail.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(11, 27, 46)');
    expect(await page.locator('.sidebar-logo-crop').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const mainLeft = async () => (await page.locator('#main').boundingBox())!.x;
    expect(await mainLeft()).toBe(68);
    // hover opens the labels OVER the page: the page does not move
    await panel.hover();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(232);
    await expect(page.locator('.sidebar-logo-full')).toBeVisible();
    await expect(page.getByTestId('rail-link-overview')).toContainText('Dashboard');
    expect(await mainLeft()).toBe(68);
    // choosing a page with the mouse closes it at once, even with the pointer still on the rail
    await page.getByTestId('rail-link-pareto').click();
    await expect(page.getByTestId('page-pareto')).toBeVisible();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(68);
    // it opens again once the pointer has left and comes back
    await page.mouse.move(900, 500);
    await panel.hover();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(232);
    await page.mouse.move(900, 500);
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(68);
    // the page tabs show beside the icon rail
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
  });

  test('between 861 and 1279 px the icon rail opens over the page on hover and on keyboard focus; hover keeps the text readable', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signInAndWait(page, 'viewer');
    const rail = page.getByTestId('rail');
    const panel = page.getByTestId('rail-panel');
    await expect(rail).toHaveAttribute('data-mode', 'icons');
    await expect(page.getByTestId('rail-toggle')).toHaveCount(0);
    const mainLeft = async () => (await page.locator('#main').boundingBox())!.x;
    expect(await mainLeft()).toBe(68);
    // keyboard: tabbing onto a link opens the labels
    await page.getByTestId('rail-link-overview').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('rail-link-pareto')).toBeFocused();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(232);
    await expect(page.getByTestId('rail-link-pareto').locator('.sidebar-link-label')).toBeVisible();
    expect(await mainLeft()).toBe(68);
    await page.getByTestId('rail-link-pareto').blur();
    // hover: light text on a lighter navy, never on a light grey
    const link = page.getByTestId('rail-link-reliability');
    await link.hover();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBe(232);
    // the hover tint is a see-through light over the navy, and the text stays the light rail ink
    await expect.poll(() => link.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/\/ 0\)$|^rgba\(0, 0, 0, 0\)$|transparent/);
    const color = await link.evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number);
    expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!).toBeGreaterThan(200);
    expect(await mainLeft()).toBe(68);
  });

  test('every page has no sideways scroll at 1280', async ({ page }) => {
    await signInAndWait(page, 'admin');
    for (const hash of ['overview', 'pareto', 'repeats', 'reliability', 'events', 'upload', 'master', 'settings/appearance', 'settings/calculations', 'settings/security', 'settings/users']) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByTestId('page-title')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok, hash).toBe(true);
    }
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => {
    expect(errors, 'console errors').toEqual([]);
  });

  test('bottom bar, page chips and the More sheet follow the role', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
    // exactly five slots: Dashboard, Causes (Pareto), Actions, Events, More (mobile-actions.png)
    const bar = page.getByTestId('bottom-nav');
    await expect(bar.locator('a, button')).toHaveCount(5);
    await expect(bar.locator('a, button')).toHaveText([/^Dashboard$/, /^Causes$/, /Actions$/, /^Events$/, /More$/]);
    await expect(page.getByTestId('bottom-overview')).toHaveAttribute('href', /#\/dashboard$/);
    await expect(page.getByTestId('topbar-title')).toHaveText('Dashboard');
    await expect(page.getByTestId('bottom-pareto')).toHaveAttribute('href', /#\/pareto$/);
    await expect(page.getByTestId('bottom-upload')).toHaveCount(0);
    // a viewer has no action items, so More carries no count (Validate keeps its own badge in the sheet)
    await expect(page.getByTestId('bottom-more').getByTestId('more-badge')).toHaveCount(0);
    await page.getByTestId('bottom-more').click();
    const sheet = page.getByTestId('more-sheet');
    await expect(sheet).toBeVisible();
    // pages grouped under Analyze / Data (no Setup for a viewer)
    await expect(sheet.locator('.more-group-title')).toHaveText(['Analyze', 'Reports', 'Act', 'Data']);
    await expect(sheet.locator('[data-section="analyze"] .more-tile')).toHaveCount(4);
    await expect(sheet.locator('[data-section="data"] .more-tile')).toHaveCount(2);
    for (const id of ['overview', 'pareto', 'repeats', 'reliability', 'events', 'validate']) await expect(sheet.getByTestId(`more-tile-${id}`)).toBeVisible();
    for (const id of ['upload', 'master', 'settings', 'users']) await expect(sheet.getByTestId(`more-tile-${id}`)).toHaveCount(0);
    await expect(sheet.getByTestId('more-appearance')).toHaveCount(0);
    await expect(sheet.getByTestId('more-role')).toHaveText('Viewer');
    // Back closes the sheet
    await expect(sheet.getByTestId('more-tile-overview')).toContainText('Dashboard');
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
    await page.getByTestId('bottom-more').click();
    await sheet.getByTestId('more-tile-events').click();
    await expect(page.getByTestId('page-title')).toHaveText('Event Explorer');
    await page.getByTestId('bottom-more').click();
    await page.getByTestId('more-logout').click();
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('the bar always has Dashboard, Causes, Actions, Events and More, whatever the role; admin sees every page in More', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await expect(page.getByTestId('bottom-nav').locator('a, button')).toHaveText([/^Dashboard$/, /^Causes$/, /Actions$/, /^Events$/, /More$/]);
    await expect(page.getByTestId('bottom-upload')).toHaveCount(0);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/');
    await page.reload();
    await signInAndWait(page, 'admin');
    await page.getByTestId('bottom-more').click();
    for (const id of ['overview', 'pareto', 'repeats', 'reliability', 'events', 'upload', 'master']) {
      await expect(page.getByTestId(`more-tile-${id}`)).toBeVisible();
    }
    for (const id of ['settings', 'users']) await expect(page.getByTestId(`more-tile-${id}`)).toHaveCount(0);
    await expect(page.locator('.more-group-title')).toHaveText(['Analyze', 'Reports', 'Act', 'Data', 'Setup']);
    await expect(page.locator('[data-section="data"] .more-tile')).toHaveCount(3);
    await expect(page.locator('[data-section="setup"] .more-tile')).toHaveCount(1);
    await expect(page.getByTestId('more-tile-master')).toContainText('Can edit');
  });

  test('the phone chip strip shows the siblings of the open section only', async ({ page }) => {
    await signInAndWait(page, 'admin');
    const chips = () => page.getByTestId('page-strip').locator('a').allTextContents();
    expect((await chips()).map((c) => c.trim())).toEqual(['Dashboard', 'Causes', 'Repeats', 'Reliability']);
    await page.goto('/#/events');
    await expect(page.getByTestId('page-events')).toBeVisible();
    expect((await chips()).map((c) => c.replace(/[^A-Za-z ]/g, '').trim())).toEqual(['Events', 'Validate', 'Upload']);
    await page.goto('/#/master');
    await expect(page.getByTestId('page-master')).toBeVisible();
    await expect(page.getByTestId('page-strip')).toHaveCount(0);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });

  test('Event Explorer on a phone: cards, 50 at a time, filters in a sheet, detail opens', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    await expect(page.getByTestId('event-card')).toHaveCount(50);
    await expect(page.getByTestId('event-table')).toHaveCount(0);
    await page.getByTestId('show-more').click();
    await expect(page.getByTestId('event-card')).toHaveCount(100);
    // the page's own sheet: which rows and their order
    await page.getByTestId('filters-pill').click();
    await expect(page.getByTestId('filters-sheet')).toBeVisible();
    await page.getByTestId('filter-sort').selectOption('dur_desc');
    await page.getByTestId('sheet-apply').click();
    await expect(page.getByTestId('filters-sheet')).toHaveCount(0);
    // the shared scope: the orange Filters pill and its sheet
    await page.getByTestId('fb-filters-pill').click();
    await expect(page.getByTestId('fb-sheet')).toBeVisible();
    await page.getByTestId('fb-more').click();
    await page.getByTestId('fb-cls-ELE').click();
    await page.locator('[data-testid="fb-area-opt"][data-value="K.1"]').click();
    await expect(page.getByTestId('fb-sheet-apply')).toContainText('Show');
    await page.getByTestId('fb-sheet-apply').click();
    await expect(page.getByTestId('fb-sheet')).toHaveCount(0);
    await expect(page.getByTestId('fb-filters-pill')).toContainText('2');
    await expect(page.getByTestId('event-card').first()).toContainText('K.1');
    await page.getByTestId('event-card').first().click();
    await expect(page.getByTestId('event-detail')).toBeVisible();
    await page.goBack(); // Back closes the popup
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
  });

  test('every control on the main phone screens is at least 44px', async ({ page }) => {
    await page.goto('/');
    expect(await smallTargets(page), 'login').toEqual([]);
    await signInAndWait(page, 'admin');
    for (const hash of ['overview', 'events', 'settings/appearance', 'settings/calculations', 'settings/security', 'upload', 'settings/users']) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByTestId('page-title')).toBeVisible();
      expect(await smallTargets(page), hash).toEqual([]);
    }
    await page.goto('/#/events');
    await page.getByTestId('filters-pill').click();
    expect(await smallTargets(page), 'filters sheet').toEqual([]);
    await page.goBack();
    await page.getByTestId('fb-filters-pill').click();
    await page.getByTestId('fb-more').click();
    expect(await smallTargets(page), 'scope sheet').toEqual([]);
    await page.goBack();
    await page.getByTestId('event-card').first().click();
    expect(await smallTargets(page), 'detail').toEqual([]);
    await page.getByTestId('edit-event').click();
    expect(await smallTargets(page), 'edit form').toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('bottom-more').click();
    expect(await smallTargets(page), 'more sheet').toEqual([]);
  });

  for (const width of [360, 390]) {
    test(`no sideways scroll at ${width}px on every page and sheet`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      expect((await noSidewaysScroll(page)).ok, 'login').toBe(true);
      await signInAndWait(page, 'admin');
      for (const hash of ['overview', 'pareto', 'repeats', 'reliability', 'events', 'upload', 'master', 'settings/appearance', 'settings/calculations', 'settings/security', 'settings/users']) {
        await page.goto(`/#/${hash}`);
        await expect(page.getByTestId('page-title')).toBeVisible();
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${hash}: ${JSON.stringify(r)}`).toBe(true);
      }
      await page.goto('/#/events');
      await page.getByTestId('bottom-more').click();
      expect((await noSidewaysScroll(page)).ok, 'more sheet').toBe(true);
      await page.goBack();
      await page.getByTestId('filters-pill').click();
      expect((await noSidewaysScroll(page)).ok, 'filter sheet').toBe(true);
      await page.goBack();
      await page.getByTestId('fb-filters-pill').click();
      await page.getByTestId('fb-more').click();
      expect((await noSidewaysScroll(page)).ok, 'scope sheet').toBe(true);
      await page.goBack();
      await page.getByTestId('event-card').first().click();
      expect((await noSidewaysScroll(page)).ok, 'detail').toBe(true);
    });
  }
});
