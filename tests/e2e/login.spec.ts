import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, PASSWORD, setTheme, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

// The sign-in screen: split layout on a desktop, hero strip plus overlapping card on a phone.
// Runs against `vite preview` of a production build in mock mode (made-up data).

const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('login-form')).toBeVisible();
}

test.describe('desktop 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => {
    expect(errors, 'console errors').toEqual([]);
  });

  test('split layout: navy brand panel on the left, the form on the right', async ({ page }) => {
    await open(page);
    const hero = await page.locator('.auth-hero').boundingBox();
    const panel = await page.locator('.auth-panel').boundingBox();
    expect(hero!.x).toBe(0);
    expect(panel!.x).toBeGreaterThan(hero!.x + hero!.width - 2);
    expect(hero!.width).toBeGreaterThan(panel!.width * 0.9);
    // hero content
    await expect(page.getByRole('img', { name: 'Arabian Cement Company' })).toBeVisible();
    await expect(page.getByText('Understand every stop.')).toBeVisible();
    await expect(page.getByText('Turn downtime data into reliable decisions.')).toBeVisible();
    await expect(page.locator('.auth-hero-caption')).toHaveText('ACC DOWN TIME ANALYSIS');
    const art = page.locator('.auth-hero-art');
    await expect(art).toBeVisible();
    expect(await art.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // form content
    await expect(page.locator('.auth-eyebrow')).toHaveText('ACC DOWN TIME ANALYSIS');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');
    await expect(page.getByText('Sign in to your workspace')).toBeVisible();
    await expect(page.getByText('Need access? Contact your administrator')).toBeVisible();
    await expect(page.locator('.auth-footer')).toHaveText('Arabian Cement Company');
    // English only for v1: no language switch
    await expect(page.getByText('العربية')).toHaveCount(0);
  });

  test('labels, roles, attributes and keyboard order', async ({ page }) => {
    await open(page);
    const email = page.getByLabel('Email address');
    const pw = page.getByLabel('Password', { exact: true });
    await expect(email).toHaveAttribute('autocomplete', 'username');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('placeholder', 'you@company.com');
    await expect(pw).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByTestId('login-email')).toBeFocused(); // autofocus
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('login-password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('login-keep')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('login-submit')).toBeFocused();
    // the remembered-device box is the old keep-signed-in option, on by default
    await expect(page.getByRole('checkbox', { name: 'Remember this device' })).toBeChecked();
    await expect(page.getByTestId('login-submit')).toHaveText('Sign in');
    // a visible focus ring on the focused button
    const ring = await page.getByTestId('login-submit').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).not.toBe('none');
  });

  test('show and hide the password', async ({ page }) => {
    await open(page);
    const pw = page.getByTestId('login-password');
    await pw.fill('Secret-123');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await expect(pw).toHaveValue('Secret-123');
    const hide = page.getByRole('button', { name: 'Hide password' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await hide.click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('forgot password opens a plain message and no dead link', async ({ page }) => {
    await open(page);
    const forgot = page.getByRole('button', { name: 'Forgot password?' });
    await expect(forgot).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('login-forgot-help')).toHaveCount(0);
    await forgot.click();
    await expect(forgot).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('login-forgot-help')).toHaveText('Ask your administrator to reset your password. They can issue a temporary one from Settings > Users.');
    await forgot.click();
    await expect(page.getByTestId('login-forgot-help')).toHaveCount(0);
    // nothing on the screen is a link that goes nowhere
    expect(await page.locator('a[href="#"], a:not([href])').count()).toBe(0);
  });

  test('a wrong password is announced in text, the right one signs in', async ({ page }) => {
    await open(page);
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill('not-the-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Email or password is not correct.');
    await expect(page.locator('[role="alert"]')).toContainText('Email or password is not correct.');
    await expect(page.getByTestId('login-password')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
  });

  test('five wrong passwords make the next try wait, and the message says how long (backend 1.10.0: no lock)', async ({ page }) => {
    await open(page);
    await page.getByTestId('login-email').fill('manager@demo.test');
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('login-password').fill(`wrong-${i}`);
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('login-error')).toBeVisible();
    }
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    // even the right password waits: it is not checked before the wait is over
    await expect(page.getByTestId('login-error')).toContainText('Too many attempts');
    await expect(page.getByTestId('login-error')).toContainText('Try again in');
  });

  test('"Remember this device" keeps the session across a reload; unticked it does not', async ({ page }) => {
    await open(page);
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('acc_dt_session')).length);
    expect(kept).toBeGreaterThan(0);

    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await page.getByTestId('login-keep').uncheck();
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    const keptAfter = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('acc_dt_session')).length);
    expect(keptAfter).toBe(0);
  });

  test('no sideways scroll, targets of 44 px, text of 12 px', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    const box = await page.getByTestId('login-submit').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const eye = await page.getByRole('button', { name: 'Show password' }).boundingBox();
    expect(eye!.width).toBeGreaterThanOrEqual(44);
    expect(eye!.height).toBeGreaterThanOrEqual(44);
    const keep = await page.locator('.auth-remember').boundingBox();
    expect(keep!.height).toBeGreaterThanOrEqual(44);
  });

  test('the sign-in button is brand orange with white text in every theme, and the layout holds', async ({ page }, testInfo) => {
    for (const theme of THEMES) {
      await page.addInitScript((name) => localStorage.setItem('acc_dt_theme', name), theme);
      await page.goto('/');
      await expect(page.getByTestId('login-form')).toBeVisible();
      const css = await page.getByTestId('login-submit').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color };
      });
      expect(css.bg, theme).toBe('rgb(180, 83, 9)');
      expect(css.fg, theme).toBe('rgb(255, 255, 255)');
      // the brand panel stays navy in every theme
      const heroBg = await page.locator('.auth-hero').evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(heroBg, theme).toContain('rgb(8, 21, 40)');
      expect((await noSidewaysScroll(page)).ok, theme).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`login-${theme.replace(/\s+/g, '-').toLowerCase()}.png`) });
    }
  });
});

test.describe('phone', () => {
  for (const [w, h] of [[390, 844], [360, 740]]) {
    test(`${w}x${h}: hero strip on top, the form card overlaps it, nothing scrolls sideways`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: w, height: h });
      await stubFonts(page);
      const errors = watchConsole(page);
      await open(page);
      const hero = await page.locator('.auth-hero').boundingBox();
      const panel = await page.locator('.auth-panel').boundingBox();
      expect(hero!.y).toBe(0);
      expect(hero!.width).toBe(w);
      expect(panel!.y).toBeLessThan(hero!.y + hero!.height); // overlap
      expect(panel!.y).toBeGreaterThan(hero!.height / 2);
      await expect(page.getByRole('img', { name: 'Arabian Cement Company' })).toBeVisible();
      await expect(page.locator('.auth-hero-phone-caption')).toHaveText('Down Time Analysis');
      await expect(page.locator('.auth-hero-title')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');
      await expect(page.getByTestId('login-submit')).toBeVisible();
      // the whole form is reachable and the page does not scroll sideways
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
      await page.getByRole('button', { name: 'Forgot password?' }).click();
      await expect(page.getByTestId('login-forgot-help')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`login-phone-${w}.png`) });
      expect(errors, 'console errors').toEqual([]);
    });
  }

  test('a phone can sign in', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubFonts(page);
    await open(page);
    await page.getByTestId('login-email').fill('viewer@demo.test');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
  });
});

test.describe('change password screen', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('uses the same split layout, with labelled password fields', async ({ page }) => {
    await stubFonts(page);
    const errors = watchConsole(page);
    await setTheme(page, 'Carbon Dark');
    await page.goto('/');
    await page.getByTestId('login-email').fill('newhire@demo.test');
    await page.getByTestId('login-password').fill('Temp-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('change-password-form')).toBeVisible();
    await expect(page.locator('.auth-hero')).toBeVisible();
    await expect(page.getByLabel('Temporary password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByLabel('Confirm new password')).toHaveAttribute('autocomplete', 'new-password');
    await page.getByTestId('cp-new').fill('My-Own-Password-1');
    await page.getByTestId('cp-new-toggle').click();
    await expect(page.getByTestId('cp-new')).toHaveAttribute('type', 'text');
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
