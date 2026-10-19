import { expect, test } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, watchConsole } from './helpers';

// Phase 5 small items: a real 'Page not found', the browser tab title per page, read-only fields that read as text,
// tooltips on text cut off with '…' and the fonts bundled with the app (no request to the font service).

const SHOTS = '/tmp/claude-0/-home-user-ACC-DownTime-Analysis/7268e5dd-0f70-504b-88e9-a6f4c86830b8/scratchpad/phase5';

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an unknown address: Page not found with the address tried, the side bar and the way back', async ({ page }) => {
    const errors = watchConsole(page);
    await signInAndWait(page, 'engineer');
    await page.goto('/#/no-such-page?x=1');
    const nf = page.getByTestId('not-found');
    await expect(nf).toBeVisible();
    await expect(nf.getByTestId('page-title')).toHaveText('Page not found');
    await expect(page.getByTestId('not-found-path')).toHaveText('/no-such-page?x=1');
    await expect(page.getByTestId('rail')).toBeVisible();
    await expect(page).toHaveTitle('Page not found · ACC Downtime');
    await expect(page.getByTestId('topbar-title')).toHaveText('Page not found');
    expect(await page.getByTestId('not-found-link').count()).toBeGreaterThan(1);
    await page.screenshot({ path: `${SHOTS}/404-desktop.png` });
    await page.getByTestId('not-found-home').click();
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByTestId('page-overview')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the browser tab title follows the page', async ({ page }) => {
    await signInAndWait(page, 'admin');
    for (const [path, title] of [
      ['/dashboard', 'Dashboard · ACC Downtime'], ['/pareto', 'Causes · ACC Downtime'], ['/repeats', 'Repeated failures · ACC Downtime'],
      ['/reliability', 'Reliability · ACC Downtime'], ['/actions/tasks', 'Actions › Tasks · ACC Downtime'], ['/events', 'Events · ACC Downtime'],
      ['/validate', 'Validate · ACC Downtime'], ['/settings/users', 'Settings › Users and access · ACC Downtime'],
    ] as const) {
      await page.goto(`/#${path}`);
      await expect(page).toHaveTitle(title);
    }
    // the side bar moves to another page: the title follows
    await page.goto('/#/dashboard');
    await expect(page).toHaveTitle('Dashboard · ACC Downtime');
  });

  test('a view-only action: the problem statement reads as text and says view only', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.goto('/#/actions');
    await page.getByTestId('action-card').first().click();
    const detail = page.getByTestId('action-edit-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute('readonly', '');
    await expect(detail).toHaveAttribute('aria-readonly', 'true');
    const look = await detail.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopColor, bg: s.backgroundColor, cursor: s.cursor, resize: s.resize }; });
    expect(look).toEqual({ border: 'rgba(0, 0, 0, 0)', bg: 'rgba(0, 0, 0, 0)', cursor: 'default', resize: 'none' });
    await expect(page.getByTestId('action-problem-note')).toContainText('view only');
    await page.screenshot({ path: `${SHOTS}/action-view-only.png` });
  });

  test('text cut off with an ellipsis shows its full text as a tooltip; the fonts come from the app', async ({ page }) => {
    const fontRequests: string[] = [];
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontRequests.push(r.url()); });
    await signInAndWait(page, 'admin');
    await page.goto('/#/actions');
    await expect(page.getByTestId('action-card').first()).toBeVisible();
    // make one title cut off for sure, then point at it
    const el = page.getByTestId('action-card').first().locator('.act-title, h3, b').first();
    await el.evaluate((n) => { const e = n as HTMLElement; e.style.display = 'block'; e.style.width = '60px'; e.style.whiteSpace = 'nowrap'; e.style.overflow = 'hidden'; e.style.textOverflow = 'ellipsis'; e.removeAttribute('title'); });
    const full = ((await el.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    await el.hover();
    await expect(el).toHaveAttribute('title', full);
    // the fonts: bundled, loaded and never fetched from the font service
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('500 14px "IBM Plex Sans"'); })).toBe(true);
    expect(fontRequests).toEqual([]);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('Page not found fits the phone', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/old/bookmark');
    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByTestId('not-found-home')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    await page.screenshot({ path: `${SHOTS}/404-phone.png` });
  });
});
