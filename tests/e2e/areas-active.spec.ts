import { expect, test, type Page } from '@playwright/test';
import { closePanel, PASSWORD, signInAndWait, stubFonts, watchConsole } from './helpers';

// Settings > Areas (backend 1.5.0, mock mode): an Admin switches AFR off and every page behaves as if its records did not
// exist; others cannot switch; switching it on again restores every number. The demo data starts with every area active.
// The demo data's latest stop day is 11 Oct 2026; AFR stops on that day.

const num = (s: string | null): number => Number(((s ?? '').match(/-?[\d,]+(\.\d+)?/)?.[0] ?? 'NaN').replace(/,/g, ''));

async function dashboard(page: Page, query = '') {
  await page.goto(`/#/dashboard${query}`);
  await expect(page.getByTestId('page-overview')).toBeVisible();
  await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
}
const totalHours = async (page: Page): Promise<number> => num(await page.getByTestId('kpi-total-hours-value').textContent());

async function areaOffered(page: Page, id: string): Promise<boolean> {
  await page.getByTestId('fb-area').click();
  await expect(page.getByTestId('fb-area-opt').first()).toBeVisible();
  const n = await page.locator(`[data-testid="fb-area-opt"][data-value="${id}"]`).count();
  await closePanel(page);
  return n > 0;
}

async function timelineAreas(page: Page): Promise<string[]> {
  // the page left behind may still tidy its address once: go again until the timeline is there
  await expect(async () => {
    await page.goto('/#/events?view=timeline');
    await expect(page.getByTestId('timeline-view')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByTestId('tl-date')).toHaveValue('2026-10-11', { timeout: 20000 });
  await expect(page.getByTestId('timeline-bar').first()).toBeVisible();
  return (await page.getByTestId('tl-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-area')))) as string[];
}

async function switchArea(page: Page, id: string, on: boolean) {
  await page.goto('/#/settings/areas');
  await expect(page.getByTestId('settings-areas')).toBeVisible({ timeout: 20000 });
  const row = page.locator(`[data-testid="area-active-row"][data-area="${id}"]`);
  await expect(row).toHaveAttribute('data-active', on ? 'false' : 'true');
  await row.getByTestId('area-active-switch').click();
  if (!on) {
    await expect(page.getByTestId('confirm-dialog')).toContainText(`Switch off ${id}?`);
    await page.getByTestId('confirm-ok').click();
  }
  await expect(row).toHaveAttribute('data-active', on ? 'true' : 'false');
  await expect(page.getByTestId('saved-toast')).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
}

test.describe('areas on and off', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('admin switches AFR off: numbers, filters and events leave it out; switching on restores them', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await dashboard(page);
    const all = await totalHours(page);
    expect(await areaOffered(page, 'AFR')).toBe(true);
    await expect(page.getByTestId('data-status-inactive')).toHaveCount(0);
    // AFR's own share of the same period (total hours are area-hours: they add up over areas)
    await dashboard(page, '?area=AFR');
    const afr = await totalHours(page);
    expect(afr).toBeGreaterThan(0);
    await dashboard(page, '?r=last90');
    expect(await timelineAreas(page)).toContain('AFR');

    await switchArea(page, 'AFR', false);
    await expect(page.getByTestId('areas-inactive-summary')).toContainText('AFR');

    await dashboard(page);
    await expect(page.getByTestId('data-status-inactive')).toHaveText('AFR inactive');
    await expect.poll(() => totalHours(page)).toBeLessThan(all);
    expect(Math.abs((await totalHours(page)) - (all - afr))).toBeLessThan(0.2);
    expect(await areaOffered(page, 'AFR')).toBe(false);
    // a link naming only AFR shows nothing, never every area
    await page.goto('/#/dashboard?area=AFR');
    await expect(page.getByTestId('page-overview')).toBeVisible();
    await expect(page.getByText('No records match these filters.')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('kpi-total-hours-value')).toHaveCount(0);
    await dashboard(page, '?r=last90'); // back to the default filters (they are shared with Event records)

    // Event records: no AFR row in the timeline, no AFR record in the list
    expect(await timelineAreas(page)).not.toContain('AFR');
    await page.goto('/#/events');
    await expect(page.getByTestId('event-row').first()).toBeVisible({ timeout: 20000 });
    await page.getByTestId('event-search').fill('AFR');
    await expect(page.getByTestId('event-row').filter({ hasText: /^AFR\b|\sAFR\s/ })).toHaveCount(0);
    await page.getByTestId('event-search').fill('');

    // Validate: the records of AFR are not counted; a small note says how many are hidden
    await page.goto('/#/validate');
    await expect(page.getByTestId('page-validate')).toBeVisible();
    await expect(page.getByTestId('v-inactive-hidden')).toContainText(/records? of inactive areas hidden \(AFR\)/, { timeout: 30000 });

    // switched on again: every number comes back
    await switchArea(page, 'AFR', true);
    await dashboard(page);
    await expect(page.getByTestId('data-status-inactive')).toHaveCount(0);
    await expect.poll(() => totalHours(page)).toBe(all);
    expect(await areaOffered(page, 'AFR')).toBe(true);
    expect(await timelineAreas(page)).toContain('AFR');
  });

  test('a non-admin cannot switch areas, and sees what an Admin switched off', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await switchArea(page, 'AFR', false);
    await signOut(page);

    // sign in on the same page: the demo data lives in this page's memory (a new page load would start it again)
    await page.getByTestId('login-email').fill('engineer@demo.test');
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    // the engineer's dashboard follows the plant-wide switch
    await dashboard(page);
    await expect(page.getByTestId('data-status-inactive')).toHaveText('AFR inactive');
    expect(await areaOffered(page, 'AFR')).toBe(false);
    // no Areas subtab, and its address shows the no-access page
    await page.getByTestId('settings-btn').click();
    await expect(page.getByTestId('settings-tabs').getByRole('link', { name: 'Areas' })).toHaveCount(0);
    await page.goto('/#/settings/areas');
    await expect(page.getByTestId('no-access')).toBeVisible();
    // master data (the engineer edits it): the Active choice is Admin only
    await page.goto('/#/master');
    await expect(page.getByTestId('page-master')).toBeVisible();
    await page.getByRole('button', { name: /^Areas/ }).click();
    await expect(page.locator('[data-testid="area-row"][data-area="AFR"]')).toContainText('Inactive');
    await page.locator('[data-testid="area-row"][data-area="AFR"]').getByRole('button').click();
    await expect(page.getByTestId('area-modal')).toBeVisible();
    await expect(page.getByTestId('ar-active-admin-only')).toBeVisible();
    await page.getByTestId('ar-active-yes').click();
    await expect(page.getByTestId('ar-active-no')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
  });

  test('actions of an inactive area stay on the board, marked', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/actions');
    const k2 = page.getByTestId('action-card').filter({ hasText: 'K.2' });
    await expect(k2.first()).toBeVisible({ timeout: 20000 });
    const before = await page.getByTestId('action-card').count();
    await expect(page.getByTestId('action-area-inactive')).toHaveCount(0);
    await switchArea(page, 'K.2', false);
    await page.goto('/#/actions');
    await expect(k2.first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('action-card')).toHaveCount(before);
    await expect(k2.first().getByTestId('action-area-inactive')).toBeVisible();
    await k2.first().getByTestId('action-open').click();
    await expect(page.getByTestId('action-detail-area-inactive')).toContainText('K.2');
  });
});
