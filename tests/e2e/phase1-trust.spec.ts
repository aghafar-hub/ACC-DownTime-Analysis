import { expect, test } from '@playwright/test';
import { signInAndWait, stubFonts, watchConsole } from './helpers';

// Inspection phase 1 (trust and bugs): the fixes a person can see.

test.describe('phase 1: trust and bugs (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the Tasks table keeps its columns after the Event timeline was open', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/events?view=timeline');
    await expect(page.getByTestId('timeline-view')).toBeVisible({ timeout: 20000 });
    await page.goto('/#/actions/tasks');
    await expect(page.getByTestId('tasks-table')).toBeVisible();
    const rows = page.getByTestId('tasks-table').getByTestId('tl-row');
    expect(await rows.count()).toBeGreaterThan(3);
    const displays = await rows.evaluateAll((trs) => [...new Set(trs.map((tr) => getComputedStyle(tr).display))]);
    expect(displays).toEqual(['table-row']);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Event records count the same events in scope as the Dashboard; the others are listed and said not to count', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/overview');
    await expect(page.getByTestId('page-overview')).toBeVisible();
    const dash = page.getByTestId('fb-count');
    await expect(dash).toContainText('events in scope', { timeout: 20000 });
    const n = (await dash.textContent())!.match(/[\d,]+/)![0];
    await page.goto('/#/events');
    await expect(page.getByTestId('page-events')).toBeVisible();
    await expect(page.getByTestId('fb-count')).toHaveText(`${n} events in scope`, { timeout: 20000 });
    await expect(page.getByTestId('page-events')).toContainText(/listed but not counted \(voided or a data problem\)/);
  });
});

test.describe('phase 1: quick clicks (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('two Actions chips clicked at once both stay on', async ({ page }) => {
    await stubFonts(page);
    await page.goto('/');
    await signInAndWait(page, 'engineer');
    await page.goto('/#/actions');
    await expect(page.getByTestId('chip-mine')).toBeVisible();
    // both clicks before the page renders again: the second must not drop the first
    await page.evaluate(() => {
      (document.querySelector('[data-testid="chip-mine"]') as HTMLElement).click();
      (document.querySelector('[data-testid="chip-ready"]') as HTMLElement).click();
    });
    await expect(page.getByTestId('chip-mine')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chip-ready')).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).toMatch(/mine=1/);
    expect(page.url()).toMatch(/ready=1/);
  });
});
