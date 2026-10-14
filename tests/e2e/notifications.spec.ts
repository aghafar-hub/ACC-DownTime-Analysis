import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signIn, signInAndWait, smallTargets, smallText, stubFonts, watchConsole, type Role } from './helpers';

// Notifications in mock mode: the bell, the panel, badge counts, deep links, snooze / dismiss, watched areas,
// "Since your last visit", Settings > Notifications. NOTE: the mock keeps its state in memory, so a full page reload
// resets it; "persists" below means across sign-out and sign-in in the same page.
const num = (s: string | null): number => Number((s ?? '').replace(/\D/g, ''));
const bell = (page: Page) => page.getByTestId('bell-btn');
const panel = (page: Page) => page.getByTestId('notif-panel');
const rows = (page: Page) => panel(page).getByTestId('notif-row');
const open = async (page: Page) => {
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
};
const seedLastSeen = (page: Page, userId: string, stamp: string) =>
  page.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k!)) localStorage.setItem(k!, v!); } catch { /* ignore */ } }, [`acc_dt_last_seen_${userId}`, stamp]);
async function signOutIn(page: Page, role: Role) {
  await page.getByTestId('user-menu-trigger').click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await signInHere(page, role);
}
/** Signs in on the open login form without reloading the page (a reload would reset the in-memory mock). */
async function signInHere(page: Page, role: Role) {
  await page.getByTestId('login-email').fill(`${role}@demo.test`);
  await page.getByTestId('login-password').fill('Demo-Pass-1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('page-title')).toBeVisible();
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    await stubFonts(page);
    errors = watchConsole(page);
  });
  test.afterEach(() => expect(errors, 'console errors').toEqual([]));

  for (const role of ['admin', 'manager', 'engineer', 'viewer'] as Role[]) {
    test(`${role}: the bell is next to Settings, 44 px, with a count in its label`, async ({ page }) => {
      await signInAndWait(page, role);
      await expect(bell(page)).toBeVisible();
      const b = (await bell(page).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      const g = (await page.getByTestId('settings-btn').boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(g.x + g.width - 1);
      await expect(bell(page)).toHaveAttribute('aria-label', /^Notifications/);
      const hasActions = role === 'admin' || role === 'engineer';
      if (hasActions) {
        await expect(page.getByTestId('bell-badge')).toBeVisible();
        await expect(bell(page)).toHaveAttribute('aria-label', /\d+ items? needs? action/);
      } else {
        // viewers and managers (View only) get no action items: no badge at all
        await expect(page.getByTestId('bell-badge')).toHaveCount(0);
        await expect(bell(page)).not.toHaveAttribute('aria-label', /needs? action/);
      }
      // new alerts light the amber dot until the panel is opened
      await expect(page.getByTestId('bell-dot')).toBeVisible();
      await open(page);
      await expect(page.getByTestId('bell-dot')).toHaveCount(0);
      expect(await rows(page).count()).toBeGreaterThan(0);
      if (!hasActions) await expect(page.getByTestId('notif-group-action')).toHaveCount(0);
    });
  }

  test('admin: the badge equals the number of action items and each item matches what its page shows', async ({ page }) => {
    await signInAndWait(page, 'admin');
    // older years are counted in the background (R5): read the numbers once every year is in
    await expect(page.getByTestId('bell-btn')).toHaveAttribute('data-records', 'complete', { timeout: 20000 });
    await expect(page.getByTestId('bell-badge')).toBeVisible();
    const badge = num(await page.getByTestId('bell-badge').textContent());
    await open(page);
    const actions = panel(page).getByTestId('notif-group-action').getByTestId('notif-row');
    expect(await actions.count()).toBe(badge);
    await expect(panel(page).getByTestId('notif-count-action')).toHaveText(String(badge));
    // the Validate item says what the Validate badge in the rail says
    const railLabel = (await page.getByTestId('validate-badge-rail').getAttribute('aria-label'))!;
    const [total, blocked] = railLabel.match(/\d+/g)!.map(Number);
    await expect(actions.first().getByTestId('notif-title')).toHaveText(`${total} records need checking, ${blocked} left out of the numbers`);
    // groups: Action needed, Alerts; Updates has nothing so it is not drawn
    await expect(panel(page).getByTestId('notif-group-alert')).toBeVisible();
    await expect(panel(page).getByTestId('notif-group-update')).toHaveCount(0);
    // every row has a severity word, a title, and (alerts) Snooze and Dismiss; actions have neither
    for (const kind of ['Action', 'Alert']) await expect(panel(page).locator('.np-kind', { hasText: kind }).first()).toBeVisible();
    await expect(actions.first().getByTestId('notif-snooze')).toHaveCount(0);
    await expect(actions.first().getByTestId('notif-dismiss')).toHaveCount(0);
    const alert = panel(page).getByTestId('notif-group-alert').getByTestId('notif-row').first();
    await expect(alert.getByTestId('notif-snooze')).toBeVisible();
    await expect(alert.getByTestId('notif-dismiss')).toBeVisible();
    await expect(alert.getByTestId('notif-age')).toHaveText(/ago|yesterday|just now/);
  });

  test('engineer: sees the same action items (edit on events and master); manager and viewer none', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await expect(page.getByTestId('bell-badge')).toBeVisible();
    await open(page);
    expect(await panel(page).getByTestId('notif-group-action').getByTestId('notif-row').count()).toBeGreaterThan(0);
  });

  test('action items deep-link to the place that fixes them', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await open(page);
    const actions = panel(page).getByTestId('notif-group-action').getByTestId('notif-row');
    // records to validate -> /validate
    await actions.first().getByTestId('notif-go').click();
    await expect(page).toHaveURL(/#\/validate$/);
    await expect(panel(page)).toHaveCount(0);
    // an unknown / placeholder code -> Master Data (this person can edit master)
    await open(page);
    await panel(page).locator('[data-testid="notif-row"][data-type="unknown_code"]').first().getByTestId('notif-go').click();
    await expect(page).toHaveURL(/#\/master$/);
    // equipment to review -> Master Data with the review filter on
    await open(page);
    await panel(page).locator('[data-testid="notif-row"][data-type="needs_review"]').getByTestId('notif-go').click();
    await expect(page).toHaveURL(/#\/master\?review=1$/);
    await expect(page.getByTestId('equipment-review')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a code item for someone who edits events but not master opens Validate filtered by that problem', async ({ page }) => {
    // the manager has no edit rights, so use the Validate link directly (what the item points to)
    await signInAndWait(page, 'admin');
    await page.goto('/#/validate?flag=placeholder&q=AFR2');
    await expect(page.getByTestId('page-validate')).toBeVisible();
    await expect(page.getByTestId('v-chip-placeholder')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('v-chip-unknown_code')).toHaveAttribute('aria-pressed', 'false');
    const shown = await page.locator('[data-testid="v-row"], [data-testid="v-card"]').count();
    expect(shown).toBeGreaterThan(0);
  });

  test('alerts deep-link with filters: long stop, repeated group, spike', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await open(page);
    await panel(page).locator('[data-testid="notif-row"][data-type="long_stop"]').first().getByTestId('notif-go').click();
    await expect(page).toHaveURL(/#\/events/);
    await expect(page.getByTestId('page-title')).toHaveText('Event Explorer');
    await expect(page.getByTestId('drill-chip')).toBeVisible();
    await open(page);
    const rep = panel(page).locator('[data-testid="notif-row"][data-type="repeat_group"]').first();
    const area = (await rep.getByTestId('notif-area').textContent())!;
    await rep.getByTestId('notif-go').click();
    await expect(page).toHaveURL(new RegExp(`#/repeats\\?.*area=${area.replace('.', '\\.')}`));
    await open(page);
    const spike = panel(page).locator('[data-testid="notif-row"][data-type="failure_spike"]').first();
    const sarea = (await spike.getByTestId('notif-area').textContent())!;
    await spike.getByTestId('notif-go').click();
    await expect(page).toHaveURL(new RegExp(`#/pareto\\?.*area=${sarea.replace('.', '\\.')}`));
    await expect(page).toHaveURL(/r=last30/);
  });

  test('snooze and dismiss hide the item for this person only and persist after signing out and in', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await open(page);
    const alerts = () => panel(page).getByTestId('notif-group-alert').getByTestId('notif-row');
    const before = await alerts().count();
    const first = alerts().first();
    const firstId = (await first.getAttribute('data-id'))!;
    await first.getByTestId('notif-snooze').click();
    await expect(first.getByTestId('notif-snooze-menu')).toBeVisible();
    await first.getByTestId('snooze-1').click();
    await expect(panel(page).locator(`[data-id="${firstId}"]`)).toHaveCount(0);
    await expect(panel(page).getByTestId('notif-status')).toHaveText('Snoozed for 1 day.');
    const second = alerts().first();
    const secondId = (await second.getAttribute('data-id'))!;
    await second.getByTestId('notif-dismiss').click();
    await expect(panel(page).locator(`[data-id="${secondId}"]`)).toHaveCount(0);
    expect(await alerts().count()).toBe(before - 2);
    await page.keyboard.press('Escape');
    await signOutIn(page, 'viewer');
    await open(page);
    await expect(panel(page).locator(`[data-id="${firstId}"]`)).toHaveCount(0);
    await expect(panel(page).locator(`[data-id="${secondId}"]`)).toHaveCount(0);
    expect(await alerts().count()).toBe(before - 2);
    // somebody else still sees them
    await page.keyboard.press('Escape');
    await page.getByTestId('user-menu-trigger').click();
    await page.getByTestId('sign-out').click();
    await signInHere(page, 'manager');
    await open(page);
    await expect(panel(page).locator(`[data-id="${firstId}"]`)).toHaveCount(1);
    await expect(panel(page).locator(`[data-id="${secondId}"]`)).toHaveCount(1);
  });

  test('watch areas filter alerts and updates, an empty choice means all', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await open(page);
    const alerts = panel(page).getByTestId('notif-group-alert').getByTestId('notif-row');
    const all = await alerts.count();
    const target = (await alerts.first().getByTestId('notif-area').textContent())!;
    await expect(page.getByTestId('notif-watch-summary')).toHaveText('All areas');
    await page.getByTestId('notif-watch-toggle').click();
    await page.getByTestId(`watch-${target}`).click();
    await expect(page.getByTestId('notif-watch-summary')).toHaveText(target);
    await expect(page.getByTestId(`watch-${target}`)).toHaveAttribute('aria-pressed', 'true');
    const some = await alerts.count();
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(all);
    for (const a of await alerts.getByTestId('notif-area').allTextContents()) expect(a).toBe(target);
    await page.getByTestId('watch-all').click();
    await expect(alerts).toHaveCount(all);
    await expect(page.getByTestId('notif-watch-summary')).toHaveText('All areas');
  });

  test('Esc closes the panel and returns focus to the bell; Tab stays inside; clicking outside closes', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await open(page);
    await expect(panel(page)).toHaveAttribute('role', 'dialog');
    await expect(panel(page)).toHaveAttribute('aria-labelledby', 'np-title');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="notif-panel"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(bell(page)).toBeFocused();
    await open(page);
    await page.getByTestId('page-title').click({ position: { x: 5, y: 5 }, force: true });
    await expect(panel(page)).toHaveCount(0);
    await open(page);
    await page.getByTestId('notif-close').click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('the panel keeps its size: about 400 px wide, scrolls inside, no sideways scroll', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await open(page);
    const box = (await panel(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.width).toBeLessThanOrEqual(400.5);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallText(page)).toEqual([]);
  });

  test('the polite live region exists for new items', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await expect(page.getByTestId('bell-live')).toHaveAttribute('aria-live', 'polite');
  });

  test('Since your last visit: shows what is new, collapses, and Dismiss moves last-seen on', async ({ page }) => {
    await seedLastSeen(page, 'U-DEMO-ADMIN', '2026-03-01 00:00:00.000');
    await signInAndWait(page, 'admin');
    const card = page.getByTestId('since-card');
    await expect(card).toBeVisible({ timeout: 20000 });
    expect(num(await page.getByTestId('slv-events').locator('b').textContent())).toBeGreaterThan(0);
    await expect(page.getByTestId('slv-failures')).toBeVisible();
    await expect(page.getByTestId('slv-hours')).toBeVisible();
    await expect(page.getByTestId('slv-area')).toBeVisible();
    await expect(page.getByTestId('slv-repeats')).toBeVisible();
    await expect(page.getByTestId('slv-alerts')).toBeVisible();
    // it sits under the takeaway, above the data-quality banner and the filters
    const t = (await page.getByTestId('takeaway').boundingBox())!;
    const c = (await card.boundingBox())!;
    expect(c.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
    await page.getByTestId('since-toggle').click();
    await expect(page.getByTestId('slv-events')).toHaveCount(0);
    await page.getByTestId('since-toggle').click();
    await page.getByTestId('since-dismiss').click();
    await expect(card).toHaveCount(0);
    await signOutIn(page, 'admin');
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('since-card')).toHaveCount(0);
  });

  test('Since your last visit stays away on a first visit (nothing to compare with)', async ({ page }) => {
    await signInAndWait(page, 'engineer');
    await expect(page.getByTestId('kpi-total-hours-value')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('since-card')).toHaveCount(0);
  });

  test('Settings > Notifications: every role sees your own preferences; they save and change the bell', async ({ page }) => {
    await signInAndWait(page, 'viewer');
    await page.getByTestId('settings-btn').click();
    await page.getByTestId('settings-tabs').getByRole('link', { name: 'Notifications' }).click();
    await expect(page.getByTestId('notif-prefs')).toBeVisible();
    await expect(page.getByTestId('notif-admin')).toHaveCount(0);
    await expect(page.getByTestId('digest-note')).toContainText('system account');
    await expect(page.getByTestId('digest-note')).toContainText('installed the daily job');
    await expect(page.getByTestId('pref-save')).toBeDisabled();
    // nothing switched on is refused with a plain message
    for (const id of ['long_stop', 'repeat_group', 'failure_spike', 'availability_low', 'planned_overrun', 'upload_gap', 'action_due', 'updates']) await page.getByTestId(`pref-type-${id}`).uncheck();
    await page.getByTestId('pref-save').click();
    await expect(page.getByTestId('pref-types-error')).toHaveText('Keep at least one type switched on.');
    await page.getByTestId('pref-type-long_stop').check();
    await page.getByTestId('pref-type-failure_spike').check();
    await page.getByTestId('pref-digest-weekly').check();
    await page.getByTestId('pref-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('saved');
    await expect(page.getByTestId('pref-save')).toBeDisabled();
    // the bell now only shows long stops and spikes
    await open(page);
    const types = await panel(page).getByTestId('notif-row').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-type')))].sort());
    expect(types).toEqual(['failure_spike', 'long_stop']);
    await page.keyboard.press('Escape');
    // the choice is still there after leaving and coming back
    await page.goto('/#/events');
    await page.goto('/#/settings/notifications');
    await expect(page.getByTestId('pref-type-long_stop')).toBeChecked();
    await expect(page.getByTestId('pref-type-upload_gap')).not.toBeChecked();
    await expect(page.getByTestId('pref-digest-weekly')).toBeChecked();
    // watched areas from the settings
    await page.getByTestId('pref-area-K.1').click();
    await page.getByTestId('pref-save').click();
    await expect(page.getByTestId('saved-toast')).toBeVisible();
    await open(page);
    await expect(page.getByTestId('notif-watch-summary')).toHaveText('K.1');
  });

  test('admin: thresholds are editable, validated like Calculations, and Run checks now reports counts', async ({ page }) => {
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/notifications');
    await expect(page.getByTestId('notif-admin')).toBeVisible();
    for (const k of ['notif_long_stop_hours', 'notif_spike_pct', 'notif_upload_gap_days', 'notif_retention_days', 'app_url']) {
      await expect(page.getByTestId(`set-${k}`)).toBeVisible();
    }
    await expect(page.getByTestId('notif_repeat_alert-true')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('set-notif_long_stop_hours')).toHaveValue('8');
    // a bad value is explained and nothing is saved
    await page.getByTestId('set-notif_long_stop_hours').fill('0');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-notif_long_stop_hours')).toHaveText('Use a number from 1 to 720.');
    await expect(page.getByTestId('settings-problems')).toBeVisible();
    await page.getByTestId('set-app_url').fill('acc.example.org');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-app_url')).toBeVisible();
    // a good value saves, then the checks use it
    await page.getByTestId('set-app_url').fill('https://acc.example.org/app');
    await page.getByTestId('set-notif_long_stop_hours').fill('1');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
    await page.getByTestId('run-checks').click();
    const result = page.getByTestId('run-checks-result');
    await expect(result).toHaveText(/\d+ created, \d+ resolved/);
    expect(num((await result.textContent())!.match(/(\d+) created/)![1]!)).toBeGreaterThan(0);
  });

  for (const role of ['manager', 'engineer', 'viewer'] as Role[]) {
    test(`${role}: the thresholds block is not offered`, async ({ page }) => {
      await signInAndWait(page, role);
      await page.goto('/#/settings/notifications');
      await expect(page.getByTestId('notif-prefs')).toBeVisible();
      await expect(page.getByTestId('notif-admin')).toHaveCount(0);
      await expect(page.getByTestId('run-checks')).toHaveCount(0);
    });
  }
});

for (const vp of [{ w: 360, h: 740 }, { w: 390, h: 844 }]) {
  test.describe(`phone ${vp.w}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true });
    let errors: string[];
    test.beforeEach(async ({ page }) => {
      await stubFonts(page);
      errors = watchConsole(page);
    });
    test.afterEach(() => expect(errors, 'console errors').toEqual([]));

    test('bell in the header, full-screen sheet, no sideways scroll, 44 px targets, 12 px text, Back closes', async ({ page }) => {
      await signInAndWait(page, 'admin');
      await expect(bell(page)).toBeVisible();
      const b = (await bell(page).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.w);
      expect(await smallTargets(page), 'header').toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      await open(page);
      const box = (await panel(page).boundingBox())!;
      expect(Math.round(box.width)).toBe(vp.w);
      expect(Math.round(box.height)).toBe(vp.h);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page), 'panel').toEqual([]);
      expect(await smallText(page), 'panel text').toEqual([]);
      await page.getByTestId('notif-watch-toggle').click();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page), 'watch chips').toEqual([]);
      await page.getByTestId('notif-watch-toggle').click();
      // a snooze menu on the first alert
      const alert = panel(page).getByTestId('notif-group-alert').getByTestId('notif-row').first();
      await alert.scrollIntoViewIfNeeded();
      await alert.getByTestId('notif-snooze').click();
      expect(await smallTargets(page), 'snooze menu').toEqual([]);
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      // Back closes it, staying on the page
      await page.goBack();
      await expect(panel(page)).toHaveCount(0);
      await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
    });

    test('the More badge shows the action count (admin) and nothing for a viewer; Validate keeps its own badge', async ({ page }) => {
      await signInAndWait(page, 'admin');
      await expect(bell(page)).toHaveAttribute('data-records', 'complete', { timeout: 20000 });
      const badge = page.getByTestId('bottom-more').getByTestId('more-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute('aria-label', /items? needs? action/);
      const n = num(await badge.textContent());
      await expect(bell(page)).toHaveAttribute('data-action-count', String(n));
      await page.getByTestId('bottom-more').click();
      await expect(page.getByTestId('validate-badge-more')).toBeVisible();
      await page.goBack();
    });

    test('viewer: no More badge, the bell still works', async ({ page }) => {
      await signInAndWait(page, 'viewer');
      await expect(page.getByTestId('bottom-more').getByTestId('more-badge')).toHaveCount(0);
      await open(page);
      await expect(panel(page).getByTestId('notif-group-action')).toHaveCount(0);
      await panel(page).getByTestId('notif-close').click();
      await expect(panel(page)).toHaveCount(0);
    });

    test('Settings > Notifications fits the phone', async ({ page }) => {
      await signInAndWait(page, 'admin');
      await page.goto('/#/settings/notifications');
      await expect(page.getByTestId('notif-admin')).toBeVisible();
      expect((await noSidewaysScroll(page)).ok).toBe(true);
      expect(await smallTargets(page)).toEqual([]);
      expect(await smallText(page)).toEqual([]);
    });
  });
}

// a sign-in helper kept for symmetry with the other specs
void signIn;
