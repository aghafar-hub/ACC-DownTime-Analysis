import { expect, test, type Page } from '@playwright/test';
import { noSidewaysScroll, signInAndWait, stubFonts } from './helpers';

// Reliability factor (RF) and utilization factor (UF) on the Reliability page: the By area columns, the RF against
// MTBF chart and the monthly RF / UF lines. The RF target is 95 % until it is set in Settings.

async function open(page: Page, path: string) {
  await stubFonts(page);
  await page.goto('/');
  await signInAndWait(page, 'engineer');
  await page.goto(`/#${path}`);
  await expect(page.getByTestId('page-reliability')).toBeVisible();
  await expect(page.getByTestId('area-table')).toBeVisible({ timeout: 20000 });
}

test('By area has RF (with its status) and UF; the RF chart plots the same RF; Trends has RF and UF by month', async ({ page }) => {
  await open(page, '/reliability?r=last90');
  const rows = page.getByTestId('area-row');
  const n = await rows.count();
  expect(n).toBeGreaterThan(1);
  await expect(page.getByTestId('area-table').locator('thead th')).toHaveText(['Area', 'Operating h', 'Stopped h', 'Failure h', 'Failures', 'Availability (B)', 'RF', 'UF', 'MTBF h', 'MTTR h']);
  await expect(page.getByTestId('status-reliability')).toHaveCount(n);
  await expect(page.getByTestId('area-uf')).toHaveCount(n);
  for (const c of await page.getByTestId('status-reliability').all()) await expect(c).toHaveText(/^(–|[✔▼] (On|Below) target)/);
  for (const c of await page.getByTestId('area-uf').all()) await expect(c).toHaveText(/^(\d+\.\d%|–)$/);

  const card = page.getByTestId('chart-rf-mtbf');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId('rf-target')).toContainText('RF target 95%');
  await expect(card.getByTestId('rf-median')).toBeVisible();
  const hits = await card.getByTestId('rf-hit').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')!));
  expect(hits.length).toBeGreaterThan(1);
  // one mark per area with an RF and an MTBF; most have their name next to it (a crowded one may not)
  const labels = await card.getByTestId('rf-label').allTextContents();
  expect(labels.length).toBeGreaterThan(hits.length / 2);
  for (const l of labels) expect(hits).toContain(l);
  // below target = triangle, on target = circle: every mark is one or the other
  const marks = (await card.getByTestId('rf-point-below').count()) + (await card.getByTestId('rf-point-on').count());
  expect(marks).toBe(hits.length);
  // the tooltip shows the same RF as the table
  const area = hits[0]!;
  const cell = (await page.locator(`[data-testid="area-row"][data-area="${area}"] td`).nth(5).textContent()) ?? '';
  await card.locator(`[data-testid="rf-hit"][data-key="${area}"]`).hover();
  await expect(page.getByTestId('chart-tip')).toContainText(cell.match(/\d+\.\d%/)![0]);

  await page.getByTestId('rel-tab-trends').click();
  const trend = page.getByTestId('chart-rf-uf');
  await expect(trend).toBeVisible();
  await expect(trend.getByTestId('chart-legend')).toContainText('Reliability factor RF');
  await expect(trend.getByTestId('chart-legend')).toContainText('Utilization factor UF');
  await expect(trend.getByTestId('chart-legend')).toContainText('RF target 95%');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('UF is left out of the By area table and the RF chart fits', async ({ page }) => {
    await open(page, '/reliability?r=last90');
    await expect(page.getByTestId('area-uf').first()).toBeHidden();
    await expect(page.getByTestId('status-reliability').first()).toBeVisible();
    await page.getByTestId('chart-rf-mtbf').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('rf-mtbf')).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
  });
});
