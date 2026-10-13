import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallText, stubFonts, watchConsole } from './helpers';

// Screenshots of the Validate page in every theme, on a phone and on a desktop, saved to
// test-results/screens/validate-*.png for a visual check. Each step also checks for sideways scroll,
// text under 12 px and console errors.
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
    test(`validate screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      const shot = async (name: string) => {
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${name} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        expect(await smallText(page), `${name} small text`).toEqual([]);
        await page.screenshot({ path: `${DIR}/validate-${slug(theme)}-${vp.name}-${name}.png` });
      };
      const rowSel = vp.phone ? 'v-card' : 'v-row';
      // desktop: a chip under the filters; phone: the same chips live in the Filters sheet
      const pickFlag = async (flag: string) => {
        if (!vp.phone) return page.getByTestId(`v-chip-${flag}`).click();
        await page.getByTestId('v-filters-pill').click();
        await page.getByTestId(`v-sheet-chip-${flag}`).click();
        await page.getByTestId('v-sheet-apply').click();
      };

      await signInAndWait(page, 'engineer');
      await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('validation-banner')).toBeVisible();
      await shot('1-overview-banner');

      await page.goto('/#/validate');
      await expect(page.getByTestId(rowSel).first()).toBeVisible();
      await shot('2-list');

      // overlaps are information (P1): their own view, not a problem chip
      await page.getByTestId('v-view-overlaps').click();
      await page.getByTestId(rowSel).first().getByRole('button').first().click();
      await expect(page.getByTestId('overlap-partner').first()).toBeVisible();
      await shot('3-detail-overlap');
      await page.getByTestId('modal-close').click();
      await page.getByTestId('v-view-open').click();

      await pickFlag('missing_classification');
      await page.getByTestId(rowSel).first().getByTestId('v-fix-btn').click();
      await expect(page.getByTestId('f-class')).toBeVisible();
      await shot('4-fix-form');
      await page.getByTestId('modal-close').click();

      await page.getByTestId('v-tick').first().check();
      await page.getByTestId('v-tick').nth(1).check();
      await shot('5-ticked');
      await page.getByTestId('v-bulk-open').click();
      await expect(page.getByTestId('bulk-modal')).toBeVisible();
      await shot('6-bulk');
      await page.getByTestId('modal-close').click();
      if (vp.phone) {
        await page.getByTestId('v-filters-pill').click();
        await expect(page.getByTestId('v-filters-sheet')).toBeVisible();
        await page.getByTestId('v-sheet-chip-unknown_code').click();
        await shot('7-filters-sheet');
        await page.getByTestId('v-sheet-apply').click();
        await page.getByTestId('bottom-more').click();
        await expect(page.getByTestId('more-tile-validate')).toBeVisible();
        await shot('8-more');
      }
      expect(errors, 'console errors').toEqual([]);
      await context.close();
    });
  }
}
