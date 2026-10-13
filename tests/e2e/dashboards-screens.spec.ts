import { expect, test } from '@playwright/test';
import { noSidewaysScroll, setTheme, signInAndWait, stubFonts, watchConsole } from './helpers';

// Screenshots of the four dashboard pages in every theme, on a phone and on a desktop, saved to
// test-results/screens-dashboards/ for a visual check. Each also checks sideways scroll, text size and console errors.
const THEMES = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, phone: true },
  { name: 'desktop', width: 1280, height: 800, phone: false },
];
const PAGES = ['overview', 'pareto', 'repeats', 'reliability'];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const DIR = 'test-results/screens-dashboards';
const ONLY = process.env.SHOT_THEMES ? process.env.SHOT_THEMES.split(',') : THEMES;
const ONLY_PAGES = process.env.SHOT_PAGES ? process.env.SHOT_PAGES.split(',') : PAGES;

/** Every visible text node smaller than 12 px. */
async function smallText(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const txt = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!txt || !el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (parseFloat(cs.fontSize) < 12 - 0.01) out.push(`${el.tagName}.${el.className} "${txt.slice(0, 30)}" ${cs.fontSize}`);
    }
    return out;
  });
}

for (const theme of ONLY) {
  for (const vp of VIEWPORTS) {
    test(`dashboard screens: ${theme} / ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone, deviceScaleFactor: vp.phone ? 2 : 1, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await stubFonts(page);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.goto('/');
      await signInAndWait(page, 'engineer');
      for (const p of ONLY_PAGES) {
        await page.goto(`/#/${p}`);
        await expect(page.getByTestId(`page-${p}`)).toBeVisible();
        await expect(page.getByTestId('filter-bar')).toBeVisible();
        await expect(page.getByTestId('loading')).toHaveCount(0);
        await expect(page.getByTestId('chart-summary').first()).toBeVisible({ timeout: 20000 });
        if (vp.phone) {
          // open every section so the whole page is checked
          const toggles = page.locator('[data-testid$="-toggle"]');
          for (let i = 0; i < (await toggles.count()); i++) {
            const t = toggles.nth(i);
            if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
          }
        }
        await page.waitForTimeout(150);
        const r = await noSidewaysScroll(page);
        expect(r.ok, `${p} sideways scroll ${JSON.stringify(r)}`).toBe(true);
        expect(await smallText(page), `${p} text under 12px`).toEqual([]);
        await page.screenshot({ path: `${DIR}/${slug(theme)}-${vp.name}-${p}.png`, fullPage: true });
        if (p === 'reliability') {
          // every sub-tab passes the same checks
          for (const tab of ['timing', 'trends', 'longest']) {
            await page.getByTestId(`rel-tab-${tab}`).click();
            await expect(page.getByTestId(`rel-panel-${tab}`)).toBeVisible();
            await page.waitForTimeout(150);
            expect((await noSidewaysScroll(page)).ok, `${p} ${tab} sideways scroll`).toBe(true);
            expect(await smallText(page), `${p} ${tab} text under 12px`).toEqual([]);
            await page.screenshot({ path: `${DIR}/${slug(theme)}-${vp.name}-${p}-${tab}.png`, fullPage: true });
          }
        }
      }
      expect(errors, errors.join('\n')).toEqual([]);
      await context.close();
    });
  }
}
