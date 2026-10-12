import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallText, stubFonts, watchConsole } from './helpers';

// Screenshots of the bell, the panel, "Since your last visit" and Settings > Notifications in every theme, on a phone and
// a desktop, saved to test-results/screens/notifications-*.png. Each step checks sideways scroll, text under 12 px and console errors.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const ONLY = process.env.SHOT_THEMES ? process.env.SHOT_THEMES.split(',') : THEMES;
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 900, phone: false },
];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens';

for (const theme of ONLY) {
  for (const vp of VIEWPORTS) {
    test(`notification screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.addInitScript(() => { try { if (!localStorage.getItem('acc_dt_last_seen_U-DEMO-ADMIN')) localStorage.setItem('acc_dt_last_seen_U-DEMO-ADMIN', '2026-03-01 00:00:00.000'); } catch { /* ignore */ } });
      const shot = async (name: string, full = false) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${name} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        expect(await smallText(page), `${name} small text`).toEqual([]);
        await page.screenshot({ path: `${DIR}/notifications-${slug(theme)}-${vp.name}-${name}.png`, fullPage: full });
      };
      await signInAndWait(page, 'admin');
      await expect(page.getByTestId('since-card')).toBeVisible({ timeout: 20000 });
      await shot('1-overview-since');
      await page.getByTestId('bell-btn').click();
      await expect(page.getByTestId('notif-panel')).toBeVisible();
      await shot('2-panel-actions');
      await page.getByTestId('notif-group-alert').scrollIntoViewIfNeeded();
      await page.getByTestId('notif-group-alert').getByTestId('notif-snooze').first().click();
      await page.getByTestId('notif-group-alert').getByTestId('notif-snooze-menu').first().scrollIntoViewIfNeeded();
      await shot('3-panel-alerts-snooze');
      await page.getByTestId('notif-watch-toggle').click();
      await page.getByTestId('notif-watch-toggle').scrollIntoViewIfNeeded();
      await shot('4-panel-watch');
      await page.getByTestId('notif-close').click();
      await page.goto('/#/settings/notifications');
      await expect(page.getByTestId('notif-admin')).toBeVisible();
      await shot('5-settings', true);
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
