import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// The Actions page in mock mode (docs/actions-design.md): the board and its filters, creating actions (manual, from a
// Pareto bar, from a report, from a record, from a repeated-failure row) incl. the merge into an open action, status
// changes and the closing rules (only people in actions_closers and Admins; the mock makes the Manager a closer),
// comments, and View only. The demo mode fills the board on first use; the mock lives in memory, so a reload resets it.
const card = (page: Page, text: string | RegExp) => page.getByTestId('action-card').filter({ hasText: text });
const detail = (page: Page) => page.getByTestId('action-detail');
const dialog = (page: Page) => page.getByTestId('create-action');
const toast = (page: Page) => page.getByTestId('action-created-toast');

async function openActions(page: Page, role: Role) {
  await signInAndWait(page, role);
  await page.goto('/#/actions');
  await expect(page.getByTestId('page-actions')).toBeVisible();
  await expect(page.getByTestId('action-card').first()).toBeVisible();
}
async function openCard(page: Page, text: string | RegExp) {
  await card(page, text).first().getByTestId('action-open').click();
  await expect(detail(page)).toBeVisible();
}
/** The equipment code of the demo action with this title (the synthetic data picks the code). */
async function codeOf(page: Page, title: string): Promise<string> {
  return ((await card(page, title).first().locator('.act-card-title b').textContent()) ?? '').trim();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('Actions is in the Act section of the rail with the overdue count; the board has a column per status', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await expect(page.getByTestId('rail-section-act')).toHaveText('Act');
    await expect(page.getByTestId('rail-link-notifications')).toHaveCount(0); // the bell opens the inbox
    await page.getByTestId('rail-link-actions').click();
    await expect(page.getByTestId('page-title')).toHaveText('Actions');
    await expect(page.getByTestId('breadcrumb')).toContainText('Act');
    // the demo FM.1 action is 3 days overdue
    await expect(page.getByTestId('actions-badge-rail')).toContainText('1');
    for (const s of ['draft', 'open', 'contractor-informed', 'waiting-stoppage', 'in-progress', 'closed']) {
      await expect(page.getByTestId(`column-${s}`)).toBeVisible();
    }
    await expect(page.getByTestId('column-cancelled')).toHaveCount(0);
    await expect(page.getByTestId('column-in-progress').getByTestId('action-card')).toContainText(/overdue/);
    await expect(page.getByTestId('actions-summary')).toBeVisible();
    await expect(page.getByTestId('actions-subtitle')).toContainText('1 overdue');
    // ids as the backend makes them
    await expect(page.getByTestId('action-card').first()).toContainText(/AC-\d{6}-\d{4}/);
    // cancelled are hidden until asked for
    await page.getByTestId('show-cancelled').click();
    await expect(page.getByTestId('column-cancelled').getByTestId('action-card')).toHaveCount(1);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
  });

  test('filters, search, overdue, list view and sorting', async ({ page }) => {
    await openActions(page, 'engineer');
    const total = await page.getByTestId('action-card').count();
    await page.getByTestId('actions-search').fill('Diaphragm');
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    await expect(page.getByTestId('actions-count')).toContainText('1 actions in this view');
    await page.getByTestId('actions-search').fill('');
    await expect(page.getByTestId('action-card')).toHaveCount(total);
    await page.getByTestId('filter-area').selectOption('CM.3');
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    await expect(page).toHaveURL(/area=CM\.3/);
    await page.getByTestId('filters-reset').click();
    await page.getByTestId('filter-overdue').click();
    await expect(page.getByTestId('filter-overdue')).toBeChecked();
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    await expect(page.getByTestId('action-card')).toContainText('overdue');
    await page.getByTestId('filter-overdue').click();
    await expect(page.getByTestId('filter-overdue')).not.toBeChecked();
    await page.getByTestId('filter-status').selectOption('Draft');
    await expect(page.getByTestId('column-open')).toHaveCount(0);
    await expect(page.getByTestId('column-draft')).toBeVisible();
    await page.getByTestId('filter-status').selectOption('active');
    await page.getByTestId('filter-source').selectOption('manual');
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    await page.getByTestId('filters-reset').click();
    // the list: a sortable table with the same actions
    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('actions-table')).toBeVisible();
    await expect(page.getByTestId('action-row')).toHaveCount(total);
    await page.getByTestId('actions-sort').selectOption('priority');
    await expect(page.getByTestId('action-row').first().getByTestId('action-priority')).toContainText('High');
    // a click on an area bar of the summary filters the board
    await page.getByTestId('view-board').click();
    await page.getByTestId('as-area').first().click();
    await expect(page).toHaveURL(/area=/);
  });

  test('create a manual action; it lands on the board and the history says so', async ({ page }) => {
    await openActions(page, 'engineer');
    await page.getByTestId('new-action').click();
    await expect(dialog(page)).toBeVisible();
    await page.getByTestId('ca-scope-area').click();
    await page.getByTestId('ca-area').selectOption('CM.2');
    // the contractor follows the area (ASEC owns the cement mills)
    await expect(page.getByTestId('ca-owner')).toHaveValue('ASEC');
    await expect(page.getByTestId('ca-owner-auto')).toBeVisible();
    // the problem statement is written from the scope until the person types one
    await expect(page.getByTestId('ca-title')).toHaveAttribute('placeholder', /CM\.2/);
    await page.getByTestId('ca-title').fill('Check the separator drive (e2e)');
    await page.getByTestId('ca-priority-High').click();
    await page.getByTestId('ca-root-MEC').click();
    await page.getByTestId('ca-required').fill('Inspect the coupling and the bearings.');
    await page.getByTestId('ca-open').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(toast(page)).toContainText(/Created AC-\d{6}-\d{4} \(Open\)/);
    const c = page.getByTestId('column-open').getByTestId('action-card').filter({ hasText: 'Check the separator drive (e2e)' });
    await expect(c).toBeVisible();
    await expect(c).toContainText('High');
    await page.getByTestId('action-created-link').click();
    await expect(detail(page)).toBeVisible();
    await expect(page.getByTestId('action-title')).toContainText('Check the separator drive (e2e)');
    await expect(page.getByTestId('action-root-MEC')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('history-row').last()).toContainText('created');
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
  });

  test('the same equipment and reason: the dialog offers to add to the open action, and the result says "Added to existing action"', async ({ page }) => {
    await openActions(page, 'manager');
    const code = await codeOf(page, 'Chute blockage (demo)');
    expect(code).toMatch(/\S/);
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-equipment').fill(code);
    await page.getByTestId('ca-reason').fill('chute   BLOCKAGE');
    await expect(page.getByTestId('ca-merge')).toContainText('An open action already exists');
    const id = ((await page.getByTestId('ca-merge-add').textContent()) ?? '').replace('Add evidence to ', '').trim();
    expect(id).toMatch(/^AC-\d{6}-\d{4}$/);
    await page.getByTestId('ca-merge-add').click();
    await expect(toast(page)).toContainText(`Added to existing action ${id}`);
    await expect(toast(page)).toHaveAttribute('data-merged', 'true');
    await page.getByTestId('action-created-link').click();
    await expect(detail(page)).toHaveAttribute('data-id', id);
    await expect(page.getByTestId('history-row').first()).toContainText('Merged instead of a new action');
    await page.getByTestId('action-close').click();
    // "Keep creating a new action" creates a second one
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-equipment').fill(code);
    await page.getByTestId('ca-reason').fill('Chute blockage');
    await page.getByTestId('ca-merge-new').click();
    await expect(page.getByTestId('ca-merge')).toHaveCount(0);
    await page.getByTestId('ca-draft').click();
    await expect(toast(page)).toContainText(/Created AC-\d{6}-\d{4} \(Draft\)/);
    await expect(toast(page)).not.toHaveAttribute('data-merged', 'true');
  });

  test('create from a Pareto bar (its tooltip) and from a built report', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/pareto');
    const bar = page.getByTestId('pareto-eq-hours').getByTestId('pareto-bar').first();
    const key = await bar.getAttribute('data-key');
    // the card's bar menu (a tap on a phone shows the same button in the tooltip)
    await page.getByTestId('pareto-eq-hours-action').click();
    await page.getByTestId('bar-action').first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('ca-from')).toContainText('Losses (Pareto)');
    await expect(page.getByTestId('ca-from')).toContainText(key ?? '-');
    await expect(page.getByTestId('ca-from')).toContainText('Equipment by failure hours');
    await expect(page.getByTestId('ca-scope-equipment')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ca-equipment')).toHaveValue(key ?? '');
    await expect(page.getByTestId('ca-evidence')).toContainText(/\d+ linked records? · \d/);
    await expect(page.getByTestId('ca-source')).toContainText('Pareto');
    await page.getByTestId('ca-draft').click();
    await expect(toast(page)).toContainText(/(Created AC-\d{6}-\d{4} \(Draft\)|Added to existing action)/);

    // a report of one area: the action is about that area
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=cover,summary&area=K.1&v=report');
    await expect(page.getByTestId('report-toolbar')).toBeVisible();
    await page.getByTestId('report-create-action').click();
    await expect(page.getByTestId('ca-from')).toContainText('Report');
    await expect(page.getByTestId('ca-scope-area')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ca-area')).toHaveValue('K.1');
    await expect(page.getByTestId('ca-title')).toHaveValue(/Area K\.1 · from/);
    await page.getByTestId('ca-open').click();
    await expect(toast(page)).toContainText(/Created AC-\d{6}-\d{4} \(Open\)/);
    await page.getByTestId('action-created-link').click();
    await expect(page).toHaveURL(/#\/actions\?id=AC-/);
    await expect(detail(page).getByTestId('action-source')).toContainText('Report');
  });

  test('create from a record and from a repeated-failure row', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events');
    await page.locator('[data-testid=event-row]').first().click();
    await page.getByTestId('event-create-action').click();
    await expect(page.getByTestId('ca-from')).toContainText('Event records');
    await expect(page.getByTestId('ca-evidence')).toContainText('1 linked record');
    await page.getByTestId('ca-cancel').click();
    await expect(dialog(page)).toHaveCount(0);
    await page.goto('/#/repeats');
    const row = page.getByTestId('repeat-row').first();
    const eq = await row.getAttribute('data-equipment');
    await row.getByTestId('repeat-create-action').click();
    await expect(page.getByTestId('ca-from')).toContainText('Repeated failures');
    await expect(page.getByTestId('ca-equipment')).toHaveValue(eq ?? '');
    await expect(page.getByTestId('ca-reason')).not.toHaveValue('');
  });

  test('status: the next step for anyone with Edit; closing only for closers, with a note', async ({ page }) => {
    // the engineer is not on the closers list
    await openActions(page, 'engineer');
    await openCard(page, 'Diaphragm slots clogged');
    await expect(page.getByTestId('action-steps')).toBeVisible();
    await page.getByTestId('action-next').click();
    await expect(detail(page).getByTestId('action-status')).toHaveText('Contractor informed');
    await expect(page.getByTestId('history-row').first()).toContainText('Open → Contractor informed');
    await page.getByTestId('action-close').click();
    await openCard(page, 'Liner worn');
    // In progress: the next step would be Closed, which this person may not do
    await expect(page.getByTestId('action-next')).toHaveCount(0);
    await expect(page.getByTestId('action-cancel')).toHaveCount(0);
    await expect(page.getByTestId('action-closers-note')).toContainText('You are not on the list');
    await page.getByTestId('action-change-status').click();
    await expect(page.getByTestId('status-opt-Closed')).toHaveAttribute('data-allowed', 'false');
    await expect(page.getByTestId('status-opt-Cancelled')).toHaveAttribute('data-allowed', 'false');
    await expect(page.getByTestId('status-closer-note')).toBeVisible();
    await page.getByTestId('status-back').click();
    // a closed action cannot be changed or reopened by a non-closer
    await page.getByTestId('action-close').click();
    await openCard(page, 'Belt torn (demo)');
    await expect(page.getByTestId('action-change-status')).toHaveCount(0);
    await expect(page.getByTestId('action-assignee')).toBeDisabled();
  });

  test('a closer closes with a note (equipment: effectiveness Watching) and reopens to Open only', async ({ page }) => {
    await openActions(page, 'manager');
    await openCard(page, 'Liner worn');
    await expect(page.getByTestId('action-next')).toContainText('Move to Closed');
    await page.getByTestId('action-next').click();
    await expect(page.getByTestId('status-modal')).toBeVisible();
    await expect(page.getByTestId('status-opt-Closed').locator('input')).toBeChecked();
    await page.getByTestId('status-apply').click();
    await expect(page.getByTestId('status-note-error')).toContainText('at least 3 characters');
    await page.getByTestId('status-note').fill('ok');
    await page.getByTestId('status-apply').click();
    await expect(page.getByTestId('status-note-error')).toBeVisible();
    await page.getByTestId('status-note').fill('Liner replaced, alignment checked.');
    await page.getByTestId('status-apply').click();
    await expect(page.getByTestId('status-modal')).toHaveCount(0);
    await expect(detail(page).getByTestId('action-status')).toHaveText('Closed');
    await expect(page.getByTestId('action-closure')).toContainText('Liner replaced, alignment checked.');
    await expect(detail(page).getByTestId('action-effect')).toContainText('Watching');
    // reopen: only Open is offered
    await page.getByTestId('action-change-status').click();
    const allowed = await page.locator('[data-testid^=status-opt-][data-allowed=true]').allTextContents();
    expect(allowed.map((x) => x.trim())).toEqual([expect.stringContaining('Open')]);
    await page.getByTestId('status-apply').click();
    await expect(detail(page).getByTestId('action-status')).toHaveText('Open');
    await expect(page.getByTestId('action-closure')).toHaveCount(0);
    // cancelling needs a reason too
    await page.getByTestId('action-cancel').click();
    await page.getByTestId('status-note').fill('Duplicate of another action.');
    await page.getByTestId('status-apply').click();
    await expect(detail(page).getByTestId('action-status')).toHaveText('Cancelled');
    await page.getByTestId('action-close').click();
    // the overdue badge went with it
    await expect(page.getByTestId('actions-badge-rail')).toHaveCount(0);
  });

  test('assignment, comments and the edits history', async ({ page }) => {
    await openActions(page, 'engineer');
    await openCard(page, 'Chain slack (demo)');
    await page.getByTestId('action-assignee').selectOption({ label: 'Demo Engineer' });
    await expect(page.getByTestId('action-saved')).toBeVisible();
    await expect(page.getByTestId('history-row').first()).toContainText('assignee');
    await page.getByTestId('action-priority-select').selectOption('High');
    await expect(detail(page).getByTestId('action-priority')).toContainText('High');
    const before = Number(await page.getByTestId('comment-count').textContent());
    await page.getByTestId('comment-input').fill('Called RHI: they need the K.1 stop next week.');
    await page.getByTestId('comment-post').click();
    await expect(page.getByTestId('comment').first()).toContainText('Called RHI');
    await expect(page.getByTestId('comment').first()).toContainText('Demo Engineer');
    await expect(page.getByTestId('comment-count')).toHaveText(String(before + 1));
    await page.getByTestId('action-edit-required').fill('Replace the chain and tension it.');
    await page.getByTestId('action-edit-required-save').click();
    await expect(page.getByTestId('history-row').first()).toContainText('required_action changed');
    // "My actions" now finds it
    await page.getByTestId('action-close').click();
    await page.getByTestId('filter-mine').click();
    await expect(page.getByTestId('filter-mine')).toBeChecked();
    await expect(card(page, 'Chain slack (demo)')).toBeVisible();
  });

  test('View only: everything readable, nothing changeable', async ({ page }) => {
    await openActions(page, 'viewer');
    await expect(page.getByTestId('access-level').first()).toHaveText('View only');
    await expect(page.getByTestId('new-action')).toHaveCount(0);
    await expect(page.locator('.act-card[draggable=true]')).toHaveCount(0);
    await openCard(page, 'Chute blockage (demo)');
    await expect(page.getByTestId('action-next')).toHaveCount(0);
    await expect(page.getByTestId('action-change-status')).toHaveCount(0);
    await expect(page.getByTestId('comment-input')).toHaveCount(0);
    await expect(page.getByTestId('action-assignee')).toBeDisabled();
    await expect(page.getByTestId('action-edit-title')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('action-history')).toBeVisible();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    // no Create action anywhere else either
    await page.getByTestId('action-close').click();
    await page.goto('/#/repeats');
    await expect(page.getByTestId('repeat-row').first()).toBeVisible();
    await expect(page.getByTestId('repeat-create-action')).toHaveCount(0);
  });

  test('a link to one action opens it; offline the copy on the device is shown and changes are off', async ({ page, context }) => {
    await openActions(page, 'engineer');
    const id = await page.getByTestId('action-card').first().getAttribute('data-id');
    await page.goto(`/#/actions?id=${id}`);
    await expect(detail(page)).toHaveAttribute('data-id', id!);
    await page.getByTestId('action-close').click();
    await expect(detail(page)).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByTestId('new-action')).toBeDisabled();
    await openCard(page, 'Diaphragm');
    await expect(page.getByTestId('action-offline')).toContainText('offline');
    await expect(page.getByTestId('action-next')).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId('action-next')).toBeEnabled();
    // the browser's own "failed to load" lines for requests made while offline are expected here
    errors.splice(0, errors.length, ...errors.filter((e) => !e.includes('ERR_INTERNET_DISCONNECTED')));
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

  test('Actions on the bottom bar; status tabs, cards, filters and New', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await expect(page.getByTestId('bottom-nav').locator('a, button')).toHaveText([/^Dashboard$/, /^Causes$/, /Actions$/, /^Events$/, /More$/]);
    await expect(page.getByTestId('actions-badge-bottom')).toBeVisible();
    await page.getByTestId('bottom-actions').click();
    await expect(page.getByTestId('actions-tabs')).toBeVisible();
    await expect(page.getByTestId('action-card').first()).toBeVisible();
    await page.getByTestId('tab-open').click();
    await expect(page.locator('[data-testid=action-card]:not([data-status=Open])')).toHaveCount(0);
    await expect(page.getByTestId('actions-phone-summary')).toContainText('open');
    await page.getByTestId('chip-overdue').click();
    await expect(page.getByTestId('actions-empty')).toBeVisible();
    await page.getByTestId('chip-overdue').click();
    await page.getByTestId('actions-filters').click();
    await expect(page.getByTestId('actions-filter-sheet')).toBeVisible();
    await page.getByTestId('filter-area').selectOption('CM.3');
    await page.getByTestId('filters-done').click();
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByTestId('new-action').click();
    await expect(dialog(page)).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    await page.getByTestId('ca-cancel').click();
  });

  test('the action full screen, Change status as a sheet; Back closes it', async ({ page }) => {
    await signInAndWait(page, 'manager');
    await page.goto('/#/actions');
    await openCard(page, 'Chute blockage (demo)');
    const box = (await detail(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);
    expect(box.x).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('action-next')).toHaveCount(0);
    await page.getByTestId('action-change-status').click();
    await expect(page.getByTestId('status-sheet')).toBeVisible();
    await expect(page.getByTestId('status-opt-In-progress')).toContainText('Next');
    await expect(page.getByTestId('status-opt-Closed')).toHaveAttribute('data-allowed', 'true');
    await page.getByTestId('status-apply').click();
    await expect(page.getByTestId('status-sheet')).toHaveCount(0);
    await expect(detail(page).getByTestId('action-status')).toHaveText('In progress');
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.goBack();
    await expect(detail(page)).toHaveCount(0);
    await expect(page.getByTestId('actions-tabs')).toBeVisible();
  });
});
