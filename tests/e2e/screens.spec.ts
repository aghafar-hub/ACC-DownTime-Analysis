import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, stubFonts, watchConsole } from './helpers';

// Screenshots of the main screens in every theme, on a phone and on a desktop,
// saved to test-results/screens/ for a visual check. Each also checks for
// sideways scroll and console errors.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 800, phone: false },
];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens';

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      const shot = async (name: string) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${name} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        await page.screenshot({ path: `${DIR}/${slug(theme)}-${vp.name}-${name}.png` });
      };

      await page.goto('/');
      await expect(page.getByTestId('login-form')).toBeVisible();
      await shot('1-login');

      await signInAndWait(page, 'engineer');
      await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
      await shot('2-dashboard');
      // the scope bar's filters: the phone sheet, the desktop Type panel
      if (vp.phone) {
        await page.getByTestId('fb-filters-pill').click();
        await expect(page.getByTestId('fb-sheet')).toBeVisible();
        await shot('2b-filters-sheet');
        await page.getByTestId('fb-sheet-close').click();
        await expect(page.getByTestId('fb-sheet')).toHaveCount(0);
      } else {
        await page.getByTestId('scope-type').click();
        await shot('2b-type-panel');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('scope-type-panel')).toHaveCount(0);
      }
      // closing a panel steps the history back a moment later (so the phone's Back closes panels): let it land first
      await page.waitForTimeout(400);

      // Event records follow the shared period: the whole year has edited rows
      await page.goto('/#/events?r=year&y=2026');
      await expect(page.getByTestId(vp.phone ? 'event-card' : 'event-row').first()).toBeVisible();
      await shot('3-events');

      // an edited row opened, with its history
      if (vp.phone) {
        await page.getByTestId('filters-pill').click();
        await page.getByTestId('filter-show').selectOption('edited');
        await page.getByTestId('sheet-apply').click();
        await page.getByTestId('event-card').first().click();
      } else {
        await page.getByTestId('filter-show').selectOption('edited');
        await page.getByTestId('event-row').first().getByRole('button').click();
      }
      await expect(page.getByTestId('event-detail')).toBeVisible();
      await shot('4-event-detail');
      await page.getByTestId('edit-event').click();
      await shot('5-event-edit');
      await page.keyboard.press('Escape');
      // a sheet's Back entry is dropped right after it closes (useBackClose): wait before navigating, or that Back
      // lands after the next address and returns to Events
      await expect.poll(() => page.evaluate(() => (history.state as { accSheet?: string } | null)?.accSheet ?? null)).toBeNull();

      await page.goto('/#/reports');
      await expect(page.getByTestId('builder')).toBeVisible();
      await shot('5b-reports-builder');

      if (vp.phone) {
        await page.getByTestId('bottom-more').click();
        await expect(page.getByTestId('more-sheet')).toBeVisible();
        await shot('6-more-sheet');
      } else {
        await page.getByTestId('settings-btn').click();
        await expect(page.getByTestId('settings-appearance')).toBeVisible();
        await shot('6-appearance');
      }
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
