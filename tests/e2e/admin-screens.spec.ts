import { expect, test } from '@playwright/test';
import { buildWorkbook, simpleRows } from '../helpers/makeWorkbook';
import { noSidewaysScroll, setTheme, signInAndWait, stubFonts, watchConsole } from './helpers';

// Screenshots of Upload, Master Data, Settings and Users in every theme, phone and desktop,
// saved to test-results/screens-admin/ for a visual check.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 800, phone: false },
];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens-admin';

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`admin screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      const shot = async (name: string, full = false) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${name} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        await page.screenshot({ path: `${DIR}/${slug(theme)}-${vp.name}-${name}.png`, fullPage: full });
      };
      await signInAndWait(page, 'admin');

      await page.goto('/#/upload');
      await expect(page.getByTestId('history-row').or(page.getByTestId('history-card')).first()).toBeVisible();
      await shot('1-upload');
      const rows = [...simpleRows(2, '2026-10-05'), ...simpleRows(2, '2026-11-02', { code: '999.ZZ900' })];
      await page.getByTestId('file-input').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(await buildWorkbook(rows)) });
      await expect(page.getByTestId('review')).toBeVisible();
      await page.getByTestId('late-add').first().click();
      await shot('2-upload-review');
      await page.getByTestId('late-section').scrollIntoViewIfNeeded();
      await shot('3-upload-late');

      await page.goto('/#/master');
      await expect(page.getByTestId(vp.phone ? 'equipment-card' : 'equipment-row').first()).toBeVisible();
      await shot('4-master-equipment');
      await (vp.phone ? page.getByTestId('equipment-card').first() : page.getByTestId('equipment-row').first().getByRole('button')).click();
      await expect(page.getByTestId('equipment-modal')).toBeVisible();
      await shot('5-equipment-popup');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: /^Reasons/ }).click();
      await shot('6-master-reasons');

      await page.goto('/#/settings');
      await expect(page.getByTestId('settings-form')).toBeVisible();
      await page.getByTestId('settings-availability').scrollIntoViewIfNeeded();
      await shot('7-settings');

      await page.goto('/#/users');
      await expect(page.getByTestId(vp.phone ? 'user-card' : 'user-row').first()).toBeVisible();
      await shot('8-users');
      await (vp.phone ? page.getByTestId('user-card').nth(1) : page.getByTestId('user-row').nth(1).getByRole('button')).click();
      await expect(page.getByTestId('user-modal')).toBeVisible();
      await page.getByTestId('access-editor').scrollIntoViewIfNeeded();
      await shot('9-user-popup');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      await page.getByTestId('add-user').click();
      await page.getByTestId('cu-email').fill(`shot.${slug(theme)}@demo.test`);
      await page.getByTestId('cu-name').fill('Screenshot Person');
      await page.getByTestId('create-user-save').click();
      await expect(page.getByTestId('temp-password-dialog')).toBeVisible();
      await shot('10-password-dialog');
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
