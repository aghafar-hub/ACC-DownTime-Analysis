import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

// Screenshots of "Keep as entered" on the Validate page: the open list, the confirmation sheet, a blocking record kept, and
// the Kept as entered view. Saved to test-results/screens/keep-*.png for a visual check (ACC Light and Carbon Dark by default).
const THEMES = process.env.SHOT_THEMES ? process.env.SHOT_THEMES.split(',') : ['ACC Light', 'Carbon Dark'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 900, phone: false },
];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens';

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`keep as entered screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      const shot = async (name: string) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${name} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        expect(await smallText(page), `${name} small text`).toEqual([]);
        if (vp.phone) expect(await smallTargets(page), `${name} small targets`).toEqual([]);
        await page.screenshot({ path: `${DIR}/keep-${slug(theme)}-${vp.name}-${name}.png` });
      };
      const rowSel = vp.phone ? 'v-card' : 'v-row';
      const pickFlag = async (flag: string) => {
        if (!vp.phone) return page.getByTestId(`v-chip-${flag}`).click();
        await page.getByTestId('v-filters-pill').click();
        await page.getByTestId(`v-sheet-chip-${flag}`).click();
        await page.getByTestId('v-sheet-apply').click();
      };

      await signInAndWait(page, 'engineer');
      await page.goto('/#/validate');
      await expect(page.getByTestId(rowSel).first()).toBeVisible();
      await shot('1-list');

      // a record with an unknown code: the confirmation sheet
      await pickFlag('unknown_code');
      const warnRow = page.getByTestId(rowSel).filter({ has: page.locator('xpath=self::*[@data-blocking="no"]') }).first();
      await warnRow.getByTestId('v-keep-btn').click();
      await expect(page.getByTestId('keep-modal')).toBeVisible();
      await shot('2-sheet-warning');
      await page.getByTestId('keep-apply').click();
      await expect(page.getByTestId('keep-result')).toBeVisible();
      await page.getByTestId('keep-close').click();

      // a blocking record: the sheet says it is still left out of the numbers
      await page.getByTestId('v-reset').click();
      await pickFlag('missing_classification');
      await page.getByTestId(rowSel).first().getByTestId('v-keep-btn').click();
      await expect(page.getByTestId('keep-sentence')).toContainText('still left out of the numbers');
      await shot('3-sheet-blocking');
      await page.getByTestId('keep-apply').click();
      await expect(page.getByTestId('keep-result')).toBeVisible();
      await page.getByTestId('keep-close').click();
      await page.getByTestId('v-reset').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot('4-list-after');

      await page.getByTestId('v-view-kept').click();
      await expect(page.getByTestId(vp.phone ? 'v-kept-card' : 'v-kept-row').first()).toBeVisible();
      await expect(page.getByTestId('v-kept-note').first()).toBeVisible({ timeout: 15000 });
      await shot('5-kept-view');

      await page.getByTestId(vp.phone ? 'v-kept-card' : 'v-kept-row').first().getByRole('button').first().click();
      await expect(page.getByTestId('detail-kept')).toBeVisible();
      await page.getByTestId('detail-kept').scrollIntoViewIfNeeded();
      await shot('6-detail-kept');
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
