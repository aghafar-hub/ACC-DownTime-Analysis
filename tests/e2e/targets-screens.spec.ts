import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, smallText, stubFonts, watchConsole } from './helpers';

// Screenshots of the target statuses, Month vs month and the data-quality scorecard in every theme, on a phone and on a
// desktop, saved to test-results/screens-targets/ for a visual check.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 800, phone: false },
];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens-targets';
const ONLY = process.env.SHOT_THEMES ? process.env.SHOT_THEMES.split(',') : THEMES;

for (const theme of ONLY) {
  for (const vp of VIEWPORTS) {
    test(`target screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.goto('/');
      await signInAndWait(page, 'admin');
      await page.goto('/#/settings/calculations');
      await page.getByTestId('set-availability_target_pct').fill('99.5');
      await page.getByTestId('set-target_mtbf_h').fill('150');
      await page.getByTestId('set-target_mttr_h').fill('1');
      await page.getByTestId('settings-save').click();
      await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
      const checks = async (label: string) => {
        expect((await noSidewaysScroll(page)).ok, `${label} sideways scroll`).toBe(true);
        expect(await smallText(page), `${label} small text`).toEqual([]);
      };
      const shot = async (name: string) => page.screenshot({ path: `${DIR}/${slug(theme)}-${vp.name}-${name}.png`, fullPage: false });

      await page.goto('/#/overview');
      await expect(page.getByTestId('kpi-reliability-target')).toBeVisible();
      await expect(page.getByTestId('chart-summary').first()).toBeVisible();
      await page.getByTestId('hero-kpis').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('overview-hero');
      await page.getByTestId('chart-area-availability').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('overview-availability-per-area');
      await checks('overview');

      await page.goto('/#/reliability');
      await expect(page.getByTestId('area-table')).toBeVisible();
      await expect(page.getByTestId('status-mtbf').first()).toBeVisible();
      await page.getByTestId('area-table-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('reliability-by-area');
      await page.getByTestId('chart-area-mtbf').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('reliability-mtbf-mttr');
      // Month vs month moved here from the Dashboard (owner)
      await page.getByTestId('reliability-mvm-toggle').click();
      await expect(page.getByTestId('chart-mvm-hours')).toBeVisible();
      await page.getByTestId('reliability-mvm').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('reliability-month-vs-month');
      await page.getByTestId('chart-mvm-hours').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('reliability-month-vs-month-chart');
      await checks('reliability');

      await page.goto('/#/validate');
      await expect(page.getByTestId('quality-card')).toBeVisible();
      await page.getByTestId('quality-details').locator('summary').click();
      await expect(page.getByTestId(vp.phone ? 'quality-list' : 'quality-table')).toBeVisible();
      await page.getByTestId('quality-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await shot('validate-scorecard');
      await checks('validate');
      expect(errors, errors.join('\n')).toEqual([]);
      await context.close();
    });
  }
}
