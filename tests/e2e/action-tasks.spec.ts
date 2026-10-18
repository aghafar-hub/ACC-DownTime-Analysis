import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// Tasks inside actions (backend 1.7.0, docs/actions-mockups/tasks/): the board's task progress, the Tasks section of an action
// with the status rules (Done needs a note, Not needed a reason, Contractor informed only for contractors), the action following
// its tasks, closing only when every task is done (the closers get "ready to close"), templates in the create dialog, the Tasks
// list, the Shutdown list with Excel, the template editor in Settings, and the phone screens. The demo data (mockApi seedDemo)
// has tasks in every state; the mock lives in memory, so a test signs out and in without reloading.
const card = (page: Page, text: string | RegExp) => page.getByTestId('action-card').filter({ hasText: text });
const detail = (page: Page) => page.getByTestId('action-detail');
const taskRow = (page: Page, n: number) => detail(page).getByTestId('task-row').nth(n - 1);

async function openActions(page: Page, role: Role) {
  await signInAndWait(page, role);
  await page.goto('/#/actions');
  await expect(page.getByTestId('action-card').first()).toBeVisible();
}
async function openCard(page: Page, text: string | RegExp) {
  await card(page, text).first().getByTestId('action-open').click();
  await expect(detail(page)).toBeVisible();
}
async function signInHere(page: Page, role: Role) {
  await page.getByTestId('login-email').fill(`${role}@demo.test`);
  await page.getByTestId('login-password').fill('Demo-Pass-1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('page-title')).toBeVisible();
}
async function signOut(page: Page) {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('sign-out').click();
}
/** Picks a status in the task status dialog (or sheet) and applies it with the note. */
async function setTaskStatus(page: Page, row: number, status: string, note = '') {
  await taskRow(page, row).getByTestId('task-status-btn').click();
  await page.getByTestId(`task-opt-${status.replace(/\s+/g, '-')}`).click();
  if (note) await page.getByTestId('task-status-note').fill(note);
  await page.getByTestId('task-status-apply').click();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  test('board: page tabs, columns follow the tasks, cards show progress, next task and who has open tasks; summary and badge count tasks', async ({ page }) => {
    await openActions(page, 'manager');
    await expect(page.getByTestId('actions-page-tabs')).toBeVisible();
    await expect(page.getByTestId('ptab-tasks-overdue')).toHaveText('4 overdue');
    for (const s of ['draft', 'open', 'in-progress', 'closed']) await expect(page.getByTestId(`column-${s}`)).toBeVisible();
    await expect(page.locator('[data-testid=column-contractor-informed], [data-testid=column-waiting-stoppage]')).toHaveCount(0);
    // the rail badge counts the overdue tasks (CR 2, RM.1 1, AFR 1)
    await expect(page.getByTestId('actions-badge-rail')).toContainText('4');
    await expect(page.getByTestId('actions-subtitle')).toContainText('4 tasks overdue');
    await expect(page.getByTestId('actions-subtitle')).toContainText('1 ready to close');
    const chute = page.getByTestId('column-in-progress').getByTestId('action-card').filter({ hasText: 'Chute blockage (demo)' });
    await expect(chute.getByTestId('task-progress')).toHaveAttribute('data-total', '5');
    await expect(chute.getByTestId('task-progress')).toContainText('2 / 5 tasks done');
    await expect(chute.getByTestId('card-next-task')).toContainText('Root cause');
    await expect(chute.getByTestId('card-next-task')).toContainText('overdue');
    await expect(chute.getByTestId('card-open-owners')).toContainText('RHI');
    await expect(chute.getByTestId('card-stop')).toContainText('1 needs stop · 6 h');
    await expect(page.getByTestId('column-open').getByTestId('action-card').filter({ hasText: 'Hydraulic pressure low' }).getByTestId('task-progress')).toContainText('0 / 4');
    await expect(card(page, 'Liner worn').getByTestId('card-ready')).toBeVisible();
    // drafts show the proposed template tasks
    await expect(page.getByTestId('column-draft').getByTestId('card-template').first()).toContainText('tasks proposed');
    // summary: open tasks by status, overdue and ready
    await expect(page.getByTestId('as-tasks-open')).toHaveText(/\d+/);
    await expect(page.getByTestId('as-overdue')).toContainText('4');
    await expect(page.getByTestId('as-ready')).toContainText('1');
    await page.getByTestId('as-ready').click();
    await expect(page.getByTestId('action-card')).toHaveCount(1);
    await expect(page.getByTestId('action-card')).toContainText('Liner worn');
    await page.getByTestId('filters-reset').click();
    await page.getByTestId('filter-task-overdue').click();
    await expect(page.getByTestId('action-card')).toHaveCount(3);
    await page.getByTestId('filter-task-overdue').click();
    await expect(page.getByTestId('actions-count')).toContainText('columns follow the tasks');
    await expect(page.getByTestId('as-tasks').getByTestId('chart-info')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-board-desktop.png', fullPage: true });
  });

  test('detail: tasks are the main section; status rules (Done note, Not needed reason, Contractor informed only for contractors); add and edit a task', async ({ page }) => {
    await openActions(page, 'engineer');
    await openCard(page, 'Chute blockage (demo)');
    await expect(detail(page).getByTestId('action-tasks')).toBeVisible();
    await expect(detail(page).getByTestId('task-row')).toHaveCount(5);
    await expect(detail(page).getByTestId('detail-progress')).toContainText('2 / 5');
    await expect(detail(page).getByTestId('tasks-overdue')).toContainText('1 overdue');
    await expect(detail(page).getByTestId('tasks-stop')).toContainText('needs a stop of RM.1 · 6.0 h');
    await expect(detail(page).getByTestId('action-steps')).toContainText('In progress');
    await expect(detail(page).getByTestId('action-due-derived')).toBeVisible();
    await expect(detail(page).getByTestId('action-due-text')).toContainText('follows the latest task due date');
    // a non-closer: Close is locked while tasks are open
    await expect(page.getByTestId('action-close-btn')).toBeDisabled();
    await expect(page.getByTestId('action-open-left')).toHaveText('3 tasks still open');
    // the task of a team (Mechanical): Contractor informed is greyed; Done needs a note
    await taskRow(page, 2).getByTestId('task-status-btn').click();
    await expect(page.getByTestId('task-status-modal')).toBeVisible();
    await expect(page.getByTestId('task-opt-Contractor-informed')).toHaveAttribute('data-allowed', 'false');
    await expect(page.getByTestId('task-opt-Contractor-informed')).toContainText('Only for RHI / ASEC tasks');
    await page.getByTestId('task-opt-Done').click();
    await page.getByTestId('task-status-apply').click();
    await expect(page.getByTestId('task-status-note-error')).toContainText('Write what was done');
    await page.getByTestId('task-status-note').fill('5-why done with RHI: wet clay and a short flap stroke.');
    await page.getByTestId('task-status-apply').click();
    await expect(page.getByTestId('task-status-modal')).toHaveCount(0);
    await expect(taskRow(page, 2)).toHaveAttribute('data-status', 'Done');
    await expect(detail(page).getByTestId('tasks-saved')).toContainText('Task 2 is done.');
    await taskRow(page, 2).getByTestId('task-toggle').click();
    await expect(detail(page).getByTestId('task-done-note')).toContainText('wet clay');
    await expect(detail(page).getByTestId('task-history-row').first()).toContainText('Done');
    // Not needed needs a reason
    await taskRow(page, 5).getByTestId('task-status-btn').click();
    await page.getByTestId('task-opt-Not-needed').click();
    await page.getByTestId('task-status-apply').click();
    await expect(page.getByTestId('task-status-note-error')).toContainText('Write why the task is not needed');
    await page.getByTestId('task-status-back').click();
    // the RHI task may be Contractor informed
    await taskRow(page, 3).getByTestId('task-status-btn').click();
    await expect(page.getByTestId('task-opt-Contractor-informed')).toHaveAttribute('data-allowed', 'true');
    await page.getByTestId('task-status-back').click();
    // add a task: it starts Open with the area contractor; a needed stop with hours
    await detail(page).getByTestId('task-add').click();
    await expect(page.getByTestId('task-dialog')).toBeVisible();
    await expect(page.getByTestId('task-owner')).toHaveValue('RHI');
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-error-title')).toBeVisible();
    await page.getByTestId('task-title').fill('Fit a vibrator on the chute (e2e)');
    await page.getByTestId('task-due-14').click();
    await page.getByTestId('task-needs-stop').check();
    await page.getByTestId('task-hours').fill('3');
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-dialog')).toHaveCount(0);
    await expect(detail(page).getByTestId('task-row')).toHaveCount(6);
    await expect(taskRow(page, 6)).toContainText('Fit a vibrator on the chute (e2e)');
    await expect(taskRow(page, 6).getByTestId('task-stop')).toContainText('3.0 h');
    await expect(detail(page).getByTestId('history-row').first()).toContainText('Task 6 added');
    // edit it: a team owner and a later date; the task history says so
    await taskRow(page, 6).getByTestId('task-toggle').click();
    await detail(page).getByTestId('task-edit').last().click();
    await expect(page.getByTestId('task-dialog')).toContainText('Edit task 6');
    await page.getByTestId('task-kind-internal').click();
    await page.getByTestId('task-owner').selectOption('MEC');
    await page.getByTestId('task-due-30').click();
    await page.getByTestId('task-save').click();
    await expect(page.getByTestId('task-dialog')).toHaveCount(0);
    await expect(taskRow(page, 6)).toContainText('Mechanical');
    await expect(detail(page).getByTestId('task-history').last().getByTestId('task-history-row').first()).toContainText('Owner RHI → MEC');
    // a note on a task
    await detail(page).getByTestId('task-note-input').last().fill('Vibrator ordered (e2e).');
    await detail(page).getByTestId('task-note-add').last().click();
    await expect(detail(page).getByTestId('task-history').last()).toContainText('Vibrator ordered (e2e).');
    await detail(page).screenshot({ path: 'tmp/tasks-detail-desktop.png' });
  });

  test('the action follows its tasks: Open becomes In progress when a task starts; the due date follows the tasks', async ({ page }) => {
    await openActions(page, 'engineer');
    await openCard(page, 'Hydraulic pressure low');
    await expect(detail(page)).toHaveAttribute('data-status', 'Open');
    await expect(page.getByTestId('action-due-input')).toHaveCount(0);
    await setTaskStatus(page, 1, 'In progress');
    await expect(detail(page)).toHaveAttribute('data-status', 'In progress');
    await expect(detail(page).getByTestId('action-status')).toHaveText('In progress');
    await expect(detail(page).getByTestId('history-row').first()).toContainText('Open → In progress');
    await setTaskStatus(page, 1, 'Open');
    await expect(detail(page)).toHaveAttribute('data-status', 'Open');
    // a draft is accepted by hand (then it follows its tasks)
    await page.getByTestId('action-close').click();
    await openCard(page, /Long stop: /);
    await expect(detail(page)).toHaveAttribute('data-status', 'Draft');
    await page.getByTestId('action-next').click();
    await expect(detail(page)).toHaveAttribute('data-status', 'Open');
  });

  test('close is blocked while tasks are open; the last task done tells the closers; a non-closer cannot close, the closer closes', async ({ page }) => {
    await openActions(page, 'engineer');
    await openCard(page, 'Feed belt misalignment');
    const id = (await detail(page).getAttribute('data-id'))!;
    await expect(page.getByTestId('action-close-btn')).toBeDisabled();
    await expect(page.getByTestId('action-open-left')).toHaveText('2 tasks still open');
    await setTaskStatus(page, 1, 'Done', 'Idlers fitted (e2e).');
    await expect(taskRow(page, 1)).toHaveAttribute('data-status', 'Done');
    await setTaskStatus(page, 2, 'Not needed', 'Belt scale checked, still within tolerance (e2e).');
    await expect(page.getByTestId('ready-banner')).toContainText('All 3 tasks done — ready to close');
    await expect(page.getByTestId('ready-banner')).toContainText('2 done · 1 not needed');
    // this person is not on the Who can close list
    await expect(page.getByTestId('ready-closer-note')).toBeVisible();
    await expect(page.getByTestId('ready-close')).toHaveCount(0);
    await expect(page.getByTestId('action-close-btn')).toBeDisabled();
    await expect(taskRow(page, 2).getByText('Belt scale re-calibration after the idlers')).toHaveClass(/tk-struck/);
    // the closer gets the notification and closes from it
    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await signOut(page);
    await signInHere(page, 'manager');
    await page.getByTestId('bell-btn').click();
    const item = page.getByTestId('notif-panel').locator('[data-testid=notif-row][data-type=action_ready_to_close]').filter({ hasText: id });
    await expect(item).toBeVisible();
    await item.getByTestId('notif-go').click();
    await expect(detail(page)).toHaveAttribute('data-id', id);
    await page.getByTestId('ready-close').click();
    await expect(page.getByTestId('ready-note-error')).toBeVisible();
    await page.getByTestId('ready-note').fill('Idlers fitted, belt tracks straight (e2e).');
    await page.getByTestId('ready-close').click();
    await expect(detail(page)).toHaveAttribute('data-status', 'Closed');
    await expect(page.getByTestId('action-closure')).toContainText('Idlers fitted, belt tracks straight (e2e).');
    await expect(page.getByTestId('ready-banner')).toHaveCount(0);
  });

  test('a task overdue notification opens the action at that task', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.getByTestId('bell-btn').click();
    const item = page.getByTestId('notif-panel').locator('[data-testid=notif-row][data-type=task_overdue]').first();
    await expect(item).toBeVisible();
    await expect(item.getByTestId('notif-go')).toHaveText('Open task');
    await item.getByTestId('notif-go').click();
    await expect(page).toHaveURL(/#\/actions\?id=AC-\d{6}-\d{4}&task=AT-/);
    await expect(detail(page).getByTestId('task-detail')).toBeVisible();
    await page.goto('/#/notifications');
    await expect(page.locator('[data-testid=nx-row]').filter({ hasText: 'Task overdue' }).first()).toBeVisible();
  });

  test('create dialog: the template picker fills editable tasks; the suggested one from a repeated-failure row', async ({ page }) => {
    await openActions(page, 'manager');
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-scope-area').click();
    await page.getByTestId('ca-area').selectOption('CM.2');
    await page.getByTestId('ca-title').fill('Separator vibration (e2e)');
    await expect(page.getByTestId('ca-tpl-none')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('ca-open')).toHaveText(/Create and open/);
    await page.getByTestId('ca-tpl-TT-REPEAT').click();
    await expect(page.getByTestId('ca-task')).toHaveCount(4);
    await expect(page.getByTestId('ca-ticked')).toHaveText('4 of 4 ticked');
    // "Area contractor" becomes the area's contractor (ASEC for the cement mills)
    await expect(page.getByTestId('ca-task').first().getByTestId('ca-task-owner')).toHaveValue('ASEC');
    await page.getByTestId('ca-task').nth(3).getByTestId('ca-task-on').uncheck();
    await page.getByTestId('ca-task').first().getByTestId('ca-task-title').fill('Repair the separator drive (e2e)');
    await page.getByTestId('ca-task-add').click();
    await page.getByTestId('ca-task').nth(4).getByTestId('ca-task-title').fill('Check the gearbox oil (e2e)');
    await expect(page.getByTestId('ca-ticked')).toHaveText('4 of 5 ticked');
    await expect(page.getByTestId('ca-due-derived')).toBeVisible();
    await expect(page.getByTestId('ca-open')).toHaveText(/Create action with 4 tasks/);
    await page.getByTestId('create-action').screenshot({ path: 'tmp/tasks-create-desktop.png' });
    await page.getByTestId('ca-open').click();
    await expect(page.getByTestId('action-created-toast')).toContainText('with 4 tasks');
    await page.getByTestId('action-created-link').click();
    await expect(detail(page).getByTestId('task-row')).toHaveCount(4);
    await expect(taskRow(page, 1)).toContainText('Repair the separator drive (e2e)');
    await expect(taskRow(page, 4)).toContainText('Check the gearbox oil (e2e)');
    // from a repeated-failure row the Repeated failure template is suggested and picked
    await page.goto('/#/repeats');
    await page.getByTestId('repeat-row').first().getByTestId('repeat-create-action').click();
    await expect(page.getByTestId('ca-tpl-TT-REPEAT')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('ca-tpl-TT-REPEAT').getByTestId('ca-tpl-suggested')).toBeVisible();
    await page.getByTestId('ca-cancel').click();
  });

  test('Tasks list: quick filters with counts, more filters, sorting, Excel; a row opens the action at that task', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/actions/tasks');
    await expect(page.getByTestId('page-tasks')).toBeVisible();
    await expect(page.getByTestId('ptab-tasks')).toHaveClass(/act-ptab--on/);
    const open = await page.getByTestId('tl-row').count();
    expect(open).toBeGreaterThan(10);
    await expect(page.getByTestId('tq-open').getByTestId('tq-count')).toHaveText(String(open));
    // overdue first
    await expect(page.getByTestId('tl-row').first()).toHaveAttribute('data-overdue', 'true');
    await page.getByTestId('tq-overdue').click();
    await expect(page.getByTestId('tl-row')).toHaveCount(4);
    await expect(page.locator('[data-testid=tl-row]:not([data-overdue])')).toHaveCount(0);
    await expect(page).toHaveURL(/tq=overdue/);
    await page.getByTestId('tq-mine').click();
    await expect(page.getByTestId('tl-row')).toHaveCount(2);
    await page.getByTestId('tq-stop').click();
    // every row of the 'Needs a stop' view carries the stop mark (read both counts once the list has changed)
    await expect.poll(async () => {
      const rows = await page.getByTestId('tl-row').count();
      return rows > 0 && rows === await page.locator('[data-testid=tl-row] [data-testid=task-stop]').count();
    }).toBe(true);
    await page.getByTestId('tq-done').click();
    await expect(page.locator('[data-testid=tl-row][data-status=Open]')).toHaveCount(0);
    await page.getByTestId('tq-open').click();
    await page.getByTestId('tf-owner').selectOption('ASEC');
    await expect(page.getByTestId('tl-row')).toHaveCount(1);
    await page.getByTestId('tasks-reset').click();
    await expect(page).not.toHaveURL(/owner=/);
    await page.getByTestId('tf-status').selectOption('Waiting stoppage');
    await expect(page.locator('[data-testid=tl-row]:not([data-status="Waiting stoppage"])')).toHaveCount(0);
    await page.getByTestId('tasks-reset').click();
    await expect(page).not.toHaveURL(/tst=/);
    await page.getByTestId('tasks-search').fill('chain links');
    await expect(page.getByTestId('tl-row')).toHaveCount(1);
    await page.getByTestId('tasks-search').fill('');
    await page.getByTestId('tl-sort-task').click();
    const titles = await page.locator('[data-testid=tl-row] .tl-task b').allTextContents();
    expect(titles).toEqual([...titles].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    await page.getByTestId('tl-sort-due').click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('tasks-excel').click();
    expect((await dl).suggestedFilename()).toMatch(/^ACC-downtime-tasks.*\.xlsx$/);
    await page.screenshot({ path: 'tmp/tasks-list-desktop.png', fullPage: true });
    // a click on a row opens the action at that task
    const row = page.getByTestId('tl-row').first();
    const task = await row.getAttribute('data-task-id');
    await row.getByTestId('tl-open').click();
    await expect(detail(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`task=${task}`));
    await expect(detail(page).locator(`[data-task-id="${task}"]`)).toHaveClass(/tk-row--open/);
    await page.getByTestId('action-close').click();
    await expect(page.getByTestId('page-tasks')).toBeVisible();
    // the status can be changed from the list
    await page.getByTestId('tl-row').filter({ hasText: 'Replace chain links' }).getByTestId('task-status-btn').click();
    await page.getByTestId('task-opt-In-progress').click();
    await page.getByTestId('task-status-apply').click();
    await expect(page.getByTestId('tl-row').filter({ hasText: 'Replace chain links' })).toHaveAttribute('data-status', 'In progress');
  });

  test('Shutdown list: open stop tasks grouped by area with totals, jump chips, filters, Print and Excel', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { print: () => void }).print = () => { (window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1; }; });
    await signInAndWait(page, 'manager');
    await page.goto('/#/actions/shutdown');
    await expect(page.getByTestId('page-shutdown')).toBeVisible();
    const groups = page.getByTestId('sd-group');
    await expect(groups.first()).toBeVisible();
    const n = await groups.count();
    expect(n).toBeGreaterThanOrEqual(5);
    // most estimated hours first; K.1 has 3 stop tasks, 13.0 h
    await expect(groups.first()).toHaveAttribute('data-area', 'K.1');
    const k1 = page.locator('[data-testid=sd-group][data-area="K.1"]');
    await expect(k1.getByTestId('sd-total-tasks')).toHaveText('3');
    await expect(k1.getByTestId('sd-total-hours')).toHaveText('13.0 h');
    await expect(k1).toContainText('Area contractor RHI');
    await expect(k1).toContainText('Kiln 1');
    // the totals add up
    const hours = (await page.getByTestId('sd-total-hours').allTextContents()).reduce((s, x) => s + parseFloat(x), 0);
    await expect(page.getByTestId('sd-sum-hours')).toHaveText(`${hours.toFixed(1)} h`);
    const tasks = (await page.getByTestId('sd-total-tasks').allTextContents()).reduce((s, x) => s + Number(x), 0);
    await expect(page.getByTestId('sd-sum-tasks')).toHaveText(String(tasks));
    await expect(page.getByTestId('sd-sum-areas')).toHaveText(String(n));
    await expect(page.getByTestId('sd-jump-chip')).toHaveCount(n);
    // filters
    await page.getByTestId('sd-ctr').selectOption('ASEC');
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute('data-area', 'CM.1');
    await page.getByTestId('sd-reset').click();
    await expect(page).not.toHaveURL(/ctr=/);
    await page.getByTestId('sd-overdue').check();
    await expect(page.locator('[data-testid=sd-row]')).toHaveCount(2);
    await page.getByTestId('sd-reset').click();
    await expect(page).not.toHaveURL(/od=1/);
    await page.getByTestId('sd-area').selectOption('K.1');
    await expect(groups).toHaveCount(1);
    // Excel and Print
    const dl = page.waitForEvent('download');
    await page.getByTestId('sd-excel').click();
    expect((await dl).suggestedFilename()).toMatch(/^ACC-downtime-shutdown-list.*\.xlsx$/);
    await page.getByTestId('sd-print-area').click();
    expect(await page.evaluate(() => (window as unknown as { printed?: number }).printed)).toBe(1);
    await page.getByTestId('sd-reset').click();
    await page.getByTestId('sd-print').click();
    expect(await page.evaluate(() => (window as unknown as { printed?: number }).printed)).toBe(2);
    // a stop task done drops off
    await page.locator('[data-testid=sd-group][data-area="K.1"]').getByTestId('sd-row').first().getByTestId('sd-open').click();
    await expect(detail(page)).toBeVisible();
    await page.screenshot({ path: 'tmp/tasks-shutdown-detail-desktop.png' });
    await page.getByTestId('action-close').click();
    await page.screenshot({ path: 'tmp/tasks-shutdown-desktop.png', fullPage: true });
  });

  test('Settings › Task templates: Edit changes and saves a template; View is read-only', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/actions');
    const sec = page.getByTestId('task-templates');
    await expect(sec.getByTestId('tt-card')).toHaveCount(3);
    await sec.locator('[data-testid=tt-card][data-id=TT-LONGSTOP]').click();
    await expect(sec.getByTestId('tt-name')).toHaveValue('Long stop');
    await expect(sec.getByTestId('tt-step')).toHaveCount(3);
    await expect(sec.getByTestId('tt-src-auto_long_stop')).toHaveAttribute('aria-pressed', 'true');
    await expect(sec.getByTestId('tt-save')).toBeDisabled();
    await sec.getByTestId('tt-add-step').click();
    await sec.getByTestId('tt-step').nth(3).getByTestId('tt-step-title').fill('Update the PM plan (e2e)');
    await sec.getByTestId('tt-step').nth(3).getByTestId('tt-step-owner').selectOption('MEC');
    await sec.getByTestId('tt-step').nth(3).getByTestId('tt-step-offset').fill('30');
    // a rule suggests one template only
    await sec.getByTestId('tt-src-auto_repeat').click();
    await sec.getByTestId('tt-save').click();
    await expect(sec.getByTestId('tt-problem')).toContainText('already suggested by Repeated failure');
    await sec.getByTestId('tt-src-auto_repeat').click();
    await sec.getByTestId('tt-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Template Long stop saved');
    await expect(sec.locator('[data-testid=tt-card][data-id=TT-LONGSTOP]')).toContainText('Update the PM plan (e2e)');
    await sec.screenshot({ path: 'tmp/tasks-templates-desktop.png' });
    // a new template
    await sec.getByTestId('tt-new').click();
    await sec.getByTestId('tt-name').fill('Long stop');
    await sec.getByTestId('tt-step-title').first().fill('Inspect (e2e)');
    await sec.getByTestId('tt-save').click();
    await expect(sec.getByTestId('tt-problem')).toContainText('already called Long stop');
    await sec.getByTestId('tt-name').fill('Belt damage (e2e)');
    await sec.getByTestId('tt-save').click();
    await expect(sec.getByTestId('tt-card')).toHaveCount(4);
    // the new step is offered in the create dialog
    await page.goto('/#/actions');
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-tpl-TT-LONGSTOP').click();
    await expect(page.getByTestId('ca-task')).toHaveCount(4);
    await page.getByTestId('ca-cancel').click();
    // the manager with View on Settings sees them read-only
    await page.goto('/#/settings/users');
    await page.getByTestId('user-row').filter({ hasText: 'Demo Manager' }).getByRole('button', { name: /Open Demo Manager/ }).click();
    await page.getByTestId('access-settings-View').click();
    await page.getByTestId('save-access').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Page access saved');
    await page.getByTestId('user-close').click();
    await signOut(page);
    await signInHere(page, 'manager');
    await page.goto('/#/settings/actions');
    const view = page.getByTestId('task-templates');
    await expect(view.getByTestId('tt-card')).toHaveCount(4);
    await expect(view.getByTestId('tt-new')).toHaveCount(0);
    await expect(view.getByTestId('tt-save')).toHaveCount(0);
    await expect(view.getByTestId('tt-add-step')).toHaveCount(0);
    await expect(view.getByTestId('tt-name')).toHaveAttribute('readonly', '');
    await expect(view.getByTestId('tt-step-owner').first()).toBeDisabled();
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

  test('action detail with task cards, the task status sheet, the Shutdown list; no sideways scroll, 44 px targets', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await page.goto('/#/actions');
    await expect(page.getByTestId('actions-page-tabs')).toBeVisible();
    await expect(page.getByTestId('actions-badge-bottom')).toContainText('4');
    await openCard(page, 'Chute blockage (demo)');
    await expect(detail(page).getByTestId('task-row')).toHaveCount(5);
    await expect(detail(page).getByTestId('task-add')).toBeVisible();
    // the tasks come before the assignment on a phone
    const tasksY = (await detail(page).getByTestId('action-tasks').boundingBox())!.y;
    const asgY = (await detail(page).getByTestId('action-assignment').boundingBox())!.y;
    expect(tasksY).toBeLessThan(asgY);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-detail-phone.png' });
    await taskRow(page, 2).getByTestId('task-status-btn').click();
    await expect(page.getByTestId('task-status-sheet')).toBeVisible();
    await expect(page.getByTestId('task-opt-Contractor-informed')).toHaveAttribute('data-allowed', 'false');
    await page.getByTestId('task-opt-Done').click();
    await page.getByTestId('task-status-note').fill('5-why done with RHI and Process (e2e).');
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-status-phone.png' });
    await page.getByTestId('task-status-apply').click();
    await expect(page.getByTestId('task-status-sheet')).toHaveCount(0);
    await expect(taskRow(page, 2)).toHaveAttribute('data-status', 'Done');
    // a task card opens to its history and buttons
    await taskRow(page, 3).getByTestId('task-toggle').click();
    await expect(taskRow(page, 3).getByTestId('task-detail')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    // Back closes the action
    await page.goBack();
    await expect(detail(page)).toHaveCount(0);
    // the Shutdown list, filtered to K.1
    await page.getByTestId('ptab-shutdown').click();
    await expect(page.getByTestId('page-shutdown')).toBeVisible();
    await page.getByTestId('sd-area').selectOption('K.1');
    await expect(page.getByTestId('sd-group')).toHaveCount(1);
    await expect(page.getByTestId('sd-phone-summary')).toContainText('K.1 · 3 tasks · 13.0 h');
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-shutdown-phone.png', fullPage: true });
    // the Tasks list on a phone
    await page.getByTestId('ptab-tasks').click();
    await expect(page.getByTestId('tl-row').first()).toBeVisible();
    await page.getByTestId('tq-overdue').click();
    // task 2 of the chute blockage was overdue and is done now
    await expect(page.getByTestId('tl-row')).toHaveCount(3);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-list-phone.png', fullPage: true });
  });

  test('phone 360: the board and the create dialog with a template fit', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signInAndWait(page, 'manager');
    await page.goto('/#/actions');
    await expect(page.getByTestId('action-card').first()).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: 'tmp/tasks-board-phone.png', fullPage: true });
    await page.getByTestId('new-action').click();
    await page.getByTestId('ca-tpl-TT-REPEAT').click();
    await expect(page.getByTestId('ca-task')).toHaveCount(4);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
    await page.getByTestId('create-action').screenshot({ path: 'tmp/tasks-create-phone.png' });
    await page.getByTestId('ca-cancel').click();
  });
});
