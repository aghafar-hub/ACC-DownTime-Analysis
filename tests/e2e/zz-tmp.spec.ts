import { test } from '@playwright/test';
import { signInAndWait } from './helpers';
test.use({ viewport: { width: 1920, height: 900 } });
test('shot', async ({ page }) => {
  await page.goto('/');
  await signInAndWait(page, 'admin');
  await page.goto('/#/dashboard');
  await page.getByTestId('kpi-total-hours').waitFor();
  await page.mouse.move(1500, 600);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-ACC-DownTime-Analysis/7268e5dd-0f70-504b-88e9-a6f4c86830b8/scratchpad/dash-top.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-ACC-DownTime-Analysis/7268e5dd-0f70-504b-88e9-a6f4c86830b8/scratchpad/dash-top-phone.png' });
});
