import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, PASSWORD, setTheme, signInAndWait, smallTargets, stubFonts, watchConsole, type Role } from './helpers';

// Settings: the gear in the top bar and its subtabs (Appearance, Calculations, Security,
// Users and access), by role. Runs against the mock build with made-up data.
const SUBS = ['Appearance', 'Notifications', 'Calculations', 'Security', 'Users and access'];
const subTabs = (page: Page) => page.getByTestId('settings-tabs').getByRole('link');

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  for (const role of ['admin', 'manager', 'engineer', 'viewer'] as Role[]) {
    test(`${role}: the gear is in the top bar next to the account menu`, async ({ page }) => {
      await signInAndWait(page, role);
      const gear = page.getByTestId('settings-btn');
      await expect(gear).toBeVisible();
      await expect(gear).toContainText('Settings');
      const g = (await gear.boundingBox())!;
      expect(g.height).toBeGreaterThanOrEqual(44);
      expect(g.width).toBeGreaterThanOrEqual(44);
      const u = (await page.getByTestId('user-menu-trigger').boundingBox())!;
      expect(g.x + g.width).toBeLessThanOrEqual(u.x + 1);
      await expect(page.getByTestId('appearance-btn')).toHaveCount(0);
      // the gear is there on another page too
      await page.goto('/#/events');
      await expect(gear).toBeVisible();
      await gear.click();
      await expect(page.getByTestId('page-settings')).toBeVisible();
      await expect(page).toHaveURL(/#\/settings\/appearance$/);
      await expect(page.getByTestId('breadcrumb')).toHaveText('Settings›Appearance');
    });
  }

  test('admin sees all five subtabs', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings');
    await expect(subTabs(page)).toHaveText(SUBS);
  });

  test('viewer sees Appearance and Notifications and the theme choice survives a reload', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.getByTestId('settings-btn').click();
    await expect(subTabs(page)).toHaveText(['Appearance', 'Notifications']);
    await expect(page.getByTestId('theme-picker')).toBeVisible();
    await page.getByRole('radio', { name: /Carbon Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'Carbon Dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'Carbon Dark');
    await expect(page.getByRole('radio', { name: /Carbon Dark/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('engineer (settings and users Hidden) sees Appearance and Notifications', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/settings');
    await expect(subTabs(page)).toHaveText(['Appearance', 'Notifications']);
    for (const sub of ['calculations', 'security', 'users']) {
      await page.goto(`/#/settings/${sub}`);
      await expect(page.getByTestId('no-access')).toBeVisible();
    }
  });

  test('a deep link to /settings/security as a viewer shows the no-access page', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.goto('/#/settings/security');
    await expect(page.getByTestId('no-access')).toContainText('You do not have access');
    await expect(page.getByTestId('settings-form')).toHaveCount(0);
  });

  test('the old /users link goes to /settings/users', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/users');
    await expect(page).toHaveURL(/#\/settings\/users$/);
    await expect(page.getByTestId('page-users')).toBeVisible();
  });

  test('R3 clean-up: no access sentence, no low-value tiles, one summary line; View only as a small badge', async ({ page }) => {
    await signInAndWait(page, 'admin');
    for (const sub of ['calculations', 'security']) {
      await page.goto(`/#/settings/${sub}`);
      await expect(page.getByTestId('settings-summary')).toBeVisible();
      await expect(page.getByTestId('settings-summary')).toContainText(/Last changed|No setting has been changed yet/);
      await expect(page.getByTestId(`settings-${sub}`)).not.toContainText('Your access to this page');
      await expect(page.getByTestId(`settings-${sub}`)).not.toContainText('Settings on record');
      await expect(page.getByTestId('fact-settings')).toHaveCount(0);
      await expect(page.getByTestId('fact-last-changed')).toHaveCount(0);
      await expect(page.getByTestId('access-level')).toHaveCount(0); // Edit access: nothing to say
    }
    await page.goto('/#/settings/appearance');
    await expect(page.getByTestId('settings-appearance').locator('.tiles')).toHaveCount(0);
    await expect(page.getByTestId('fact-theme')).toHaveText(/^In use: .+\.$/);
    await page.goto('/#/settings/users');
    await expect(page.getByTestId('page-users')).not.toContainText('Your access to this page');
  });

  test('the last subtab is remembered', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/security');
    await expect(page.getByTestId('settings-security')).toBeVisible();
    await page.goto('/#/events');
    await page.getByTestId('settings-btn').click();
    await expect(page).toHaveURL(/#\/settings\/security$/);
  });

  test('a person with only Users at View sees Appearance and Users and access, read-only', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/users');
    await page.getByTestId('user-row').filter({ hasText: 'Demo Engineer' }).getByRole('button', { name: /Open Demo Engineer/ }).click();
    await page.getByTestId('access-users-View').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toBeVisible();
    await page.getByTestId('user-close').click();
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('login-email').fill('engineer@demo.test');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.getByTestId('settings-btn').click();
    await expect(subTabs(page)).toHaveText(['Appearance', 'Notifications', 'Users and access']);
    await subTabs(page).filter({ hasText: 'Users and access' }).click();
    await expect(page.getByTestId('access-level')).toHaveText('View only');
    await expect(page.getByTestId('user-row').first()).toBeVisible();
    await expect(page.getByTestId('add-user')).toHaveCount(0);
    await page.goto('/#/settings/security');
    await expect(page.getByTestId('no-access')).toBeVisible();
  });
});

for (const width of [360, 390]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    test.beforeEach(async ({ page }) => stubFonts(page));

    test('gear in the header, subtab chips usable, no sideways scroll, targets 44px', async ({ page }) => {
      const errors = watchConsole(page);
      await signInAndWait(page, 'admin');
      const gear = page.getByTestId('settings-btn');
      await expect(gear).toBeVisible();
      const g = (await gear.boundingBox())!;
      expect(g.height).toBeGreaterThanOrEqual(44);
      expect(g.width).toBeGreaterThanOrEqual(44);
      expect(g.x + g.width).toBeLessThanOrEqual(width);
      expect((await noSidewaysScroll(page)).ok, 'overview header').toBe(true);
      expect(await smallTargets(page), 'header').toEqual([]);
      await gear.click();
      await expect(page.getByTestId('settings-tabs')).toBeVisible();
      for (const label of SUBS) {
        const chip = page.getByTestId('settings-tabs').getByRole('link', { name: label });
        await chip.click();
        await expect(chip).toHaveAttribute('aria-current', 'page');
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${label}: ${JSON.stringify(r)}`).toBe(true);
        const small = await smallTargets(page);
        expect(small, `${label}: ${small.join('; ')}`).toEqual([]);
      }
      // the More sheet has no Settings or Appearance row
      await page.getByTestId('bottom-more').click();
      await expect(page.getByTestId('more-sheet')).toBeVisible();
      await expect(page.getByTestId('more-appearance')).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('viewer: the gear and the Appearance subtab fit', async ({ page }) => {
      await signInAndWait(page, 'viewer');
      await page.getByTestId('settings-btn').click();
      await expect(page.getByTestId('theme-picker')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
    });
  });
}

// Screenshots of every subtab in every theme, phone and desktop, for a visual check.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
for (const theme of THEMES) {
  for (const vp of [{ name: 'phone', width: 390, height: 844, phone: true }, { name: 'desktop', width: 1280, height: 800, phone: false }]) {
    test(`settings screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await signInAndWait(page, 'admin');
      await page.getByTestId('settings-btn').click();
      for (const [sub, id] of [['appearance', 'settings-appearance'], ['calculations', 'settings-calculations'], ['security', 'settings-security'], ['users', 'page-users']]) {
        await page.goto(`/#/settings/${sub}`);
        await expect(page.getByTestId(id)).toBeVisible();
        await page.waitForTimeout(150);
        expect((await noSidewaysScroll(page)).ok, sub).toBe(true);
        await page.screenshot({ path: `test-results/screens-settings/${slug(theme)}-${vp.name}-${sub}.png` });
      }
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
