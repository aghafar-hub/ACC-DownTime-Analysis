import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole } from './helpers';

// The Notifications page (the bell's inbox, docs/actions-mockups/desktop-notifications.png): opened from the panel's
// "See all", category tabs with counts, the derived items under Data quality (only for people who can fix them), the
// item beside the list, Create action from an alert, snooze / dismiss, Mark all read, and the phone layout.
const rows = (page: Page) => page.getByTestId('nx-row');

/** The demo fills the actions (and their overdue alert) on first use; a focus refresh brings the new alerts in. */
async function openInbox(page: Page, role: 'admin' | 'engineer' | 'viewer' | 'manager', via: 'panel' | 'rail' = 'panel') {
  await signInAndWait(page, role);
  await page.goto('/#/actions');
  await expect(page.getByTestId('action-card').first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  if (via === 'rail') {
    // opening the panel marks what is in it as seen; the rail link leaves them new
    await page.getByTestId('rail-link-notifications').click();
  } else {
    await page.getByTestId('bell-btn').click();
    await expect(page.getByTestId('notif-panel')).toBeVisible();
    await page.getByTestId('notif-see-all').click();
  }
  await expect(page.getByTestId('page-notifications')).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('See all opens the inbox: tabs per category with counts; derived items are under Data quality', async ({ page }) => {
    await openInbox(page, 'admin');
    await expect(page).toHaveURL(/#\/notifications$/);
    await expect(page.getByTestId('page-title')).toHaveText('Notifications');
    await expect(page.getByTestId('breadcrumb')).toContainText('Act');
    await expect(page.getByTestId('rail-link-notifications')).toHaveClass(/sidebar-link--active/);
    const total = await rows(page).count();
    await expect(page.getByTestId('nx-tab-all')).toContainText(String(total));
    for (const [tab, cat] of [['reliability', 'Reliability'], ['data-quality', 'Data quality'], ['actions', 'Actions']] as const) {
      await page.getByTestId(`nx-tab-${tab}`).click();
      const n = Number(await page.getByTestId(`nx-tab-${tab}`).getByTestId('nx-tab-count').textContent());
      await expect(rows(page)).toHaveCount(n);
      if (n) await expect(page.locator(`[data-testid=nx-row]:not([data-category="${cat}"])`)).toHaveCount(0);
    }
    // the admin can fix records: the derived items are listed under Data quality, without snooze or dismiss
    await page.getByTestId('nx-tab-data-quality').click();
    const derived = page.locator('[data-testid=nx-row][data-kind=action]');
    await expect(derived.first()).toBeVisible();
    await expect(derived.first().getByTestId('nx-dismiss')).toHaveCount(0);
    await expect(derived.first().getByTestId('nx-create')).toHaveCount(0);
    // the overdue action is under Actions and opens that action
    await page.getByTestId('nx-tab-actions').click();
    await expect(rows(page).first()).toContainText(/AC-\d{6}-\d{4}/);
    await rows(page).first().getByTestId('nx-go').click();
    await expect(page).toHaveURL(/#\/actions\?id=AC-/);
    await expect(page.getByTestId('action-detail')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });

  test('the chosen item beside the list; Create action from an alert; snooze, dismiss, Mark all read', async ({ page }) => {
    await openInbox(page, 'engineer', 'rail');
    await expect(page.getByTestId('nx-new').first()).toBeVisible();
    await page.getByTestId('nx-tab-reliability').click();
    // wait for the tab's own list: every row is a Reliability item
    await expect(rows(page).locator(':scope:not([data-category="Reliability"])')).toHaveCount(0);
    const first = rows(page).first();
    await expect(first).toHaveAttribute('data-category', 'Reliability');
    const title = (await first.getByTestId('nx-title').textContent()) ?? '';
    await first.getByTestId('nx-title').click();
    await expect(page.getByTestId('nx-detail')).toContainText(title.slice(0, 20));
    // Create action from the alert
    await first.getByTestId('nx-create').click();
    await expect(page.getByTestId('create-action')).toBeVisible();
    await expect(page.getByTestId('ca-from')).toContainText('Notification');
    await expect(page.getByTestId('ca-from')).toContainText('Reliability');
    await expect(page.getByTestId('ca-source')).toContainText('Notification');
    await page.getByTestId('ca-draft').click();
    await expect(page.getByTestId('action-created-toast')).toContainText(/(Created AC-\d{6}-\d{4} \(Draft\)|Added to existing action AC-)/);
    // snooze one, dismiss another
    const before = await rows(page).count();
    await rows(page).first().getByTestId('nx-snooze').click();
    await page.getByTestId('nx-snooze-7').click();
    await expect(page.getByTestId('nx-status')).toHaveText('Snoozed for 7 days.');
    await expect(rows(page)).toHaveCount(before - 1);
    await rows(page).first().getByTestId('nx-dismiss').click();
    await expect(page.getByTestId('nx-status')).toHaveText('Dismissed.');
    await expect(rows(page)).toHaveCount(before - 2);
    // Mark all read clears the New tags and the bell's amber dot
    await page.getByTestId('nx-tab-all').click();
    await page.getByTestId('nx-mark-all').click();
    await expect(page.getByTestId('nx-new')).toHaveCount(0);
    await expect(page.getByTestId('bell-dot')).toHaveCount(0);
    await expect(page.getByTestId('nx-mark-all')).toBeDisabled();
    // the area filter
    await page.getByTestId('nx-area-filter').selectOption('K.1');
    const n = await rows(page).count();
    for (let i = 0; i < n; i++) await expect(rows(page).nth(i).getByTestId('nx-area')).toContainText('K.1');
  });

  test('a viewer: the inbox without derived items and without Create action', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.getByTestId('rail-link-notifications').click();
    await expect(page.getByTestId('page-notifications')).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator('[data-testid=nx-row][data-kind=action]')).toHaveCount(0);
    await expect(page.getByTestId('nx-create')).toHaveCount(0);
    await expect(page.getByTestId('nx-rules')).toHaveText(/My settings/);
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('category chips and the list; See all from the full-screen panel; the More sheet lists it', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.getByTestId('bottom-more').click();
    await expect(page.getByTestId('more-section-act')).toHaveText('Act');
    await expect(page.getByTestId('more-tile-notifications')).toBeVisible();
    await expect(page.getByTestId('more-tile-actions')).toBeVisible();
    await page.goBack();
    await page.getByTestId('bell-btn').click();
    await page.getByTestId('notif-see-all').click();
    await expect(page.getByTestId('page-notifications')).toBeVisible();
    await expect(page.getByTestId('notif-panel')).toHaveCount(0);
    await expect(rows(page).first()).toBeVisible();
    await page.getByTestId('nx-tab-reliability').click();
    await expect(page.locator('[data-testid=nx-row]:not([data-category=Reliability])')).toHaveCount(0);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
  });
});
