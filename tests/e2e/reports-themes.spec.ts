import { expect, test } from '@playwright/test';
import { setTheme, stubFonts, watchConsole } from './helpers';

// The printed report is a fixed light theme: the five app themes must not change a single pixel of it.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];

test.use({ viewport: { width: 1280, height: 900 } });

test('the printed look is the same in all five app themes', async ({ browser }) => {
  const shots: Buffer[] = [];
  const colours: string[][] = [];
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await stubFonts(page);
    const errors = watchConsole(page);
    await setTheme(page, theme);
    // the cover and footers print the time the report was made: freeze it so the five runs can be compared pixel for pixel
    await page.clock.setFixedTime(new Date('2026-10-13T11:00:00'));
    await page.goto('/');
    await page.getByTestId('login-email').fill('manager@demo.test');
    await page.getByTestId('login-password').fill('Demo-Pass-1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.goto('/#/reports?tpl=custom&p=lastmonth&cmp=1&s=cover,summary,daily,availability,top_equipment,when,quality&v=report');
    await page.locator('[data-testid=report][data-ready=true]').waitFor({ timeout: 60_000 });
    await page.emulateMedia({ media: 'print' });
    shots.push(await page.screenshot({ fullPage: true }));
    colours.push(await page.evaluate(() => {
      const pick = (sel: string, prop: string) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(prop);
      return [pick('.rpt-page', 'background-color'), pick('.rpt-h2', 'color'), pick('.rpt-table td', 'color'), pick('.rpt-kpi', 'background-color'), pick('.rpt-doc', '--tk-card-bg'), pick('.rpt-doc', '--tk-danger')];
    }));
    expect(errors, theme).toEqual([]);
    await ctx.close();
  }
  for (let i = 1; i < THEMES.length; i++) {
    expect(colours[i], THEMES[i]).toEqual(colours[0]);
    expect(shots[i]!.equals(shots[0]!), `${THEMES[i]} looks like ${THEMES[0]}`).toBe(true);
  }
  expect(colours[0]![0]).toBe('rgb(255, 255, 255)');
});
