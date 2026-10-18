import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { noSidewaysScroll, signInAndWait, smallTargets, stubFonts, watchConsole } from './helpers';

// Backend 1.9.0: the system email in Settings, Send by email on a report (PDF of the pages, optional Excel, summary in the
// body) and the actions report (one area / all, or one action) with its own Send. Runs in mock mode: nothing is sent; the
// mock keeps the emails, read through window.__accSentMail.

const SHOTS = process.env.EMAIL_SHOTS ?? '';
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
type Sent = { to: string[]; cc: string[]; subject: string; html: string; attachments: { name: string; mimeType: string; bytes: number; base64: string }[] };
const sentMail = (page: Page) => page.evaluate(() => (window as unknown as { __accSentMail: () => Sent[] }).__accSentMail());

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Settings: the system email, the setup steps and a test email (Admin)', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'admin');
    await page.goto('/#/settings/notifications');
    const box = page.getByTestId('email-sender');
    await expect(box).toBeVisible();
    await expect(page.getByTestId('email-steps')).toContainText('Send mail as');
    await page.getByTestId('set-system_email').fill('not an address');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('error-system_email')).toBeVisible();
    await page.getByTestId('set-system_email').fill('downtime@arabiancement.com');
    await page.getByTestId('set-system_email_name').fill('ACC Downtime');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('saved-toast')).toContainText('Settings saved');
    await page.getByTestId('send-test-email').click();
    await expect(page.getByTestId('send-test-result')).toContainText('Sent to admin@demo.test from "ACC Downtime" <downtime@arabiancement.com>');
    await shot(page, 'settings-email');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('a report goes by email: chips, a person from the app, Excel ticked; the PDF has one page per report page', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'manager');
    await page.goto('/#/reports?tpl=custom&p=lastmonth&cmp=1&s=cover,summary,daily&v=report');
    await page.locator('[data-testid=report][data-ready=true]').waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('report-info')).toContainText('pages');
    const pages = await page.getByTestId('rpt-scroll').getByTestId('rpt-page').count();
    await page.getByTestId('report-send').click();
    const dlg = page.getByTestId('send-email');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('ems-subject')).toHaveValue(/ - /);
    await expect(page.getByTestId('ems-send')).toBeDisabled();
    await page.getByTestId('ems-to').fill('plant.manager@outside.org; wrong');
    await page.getByTestId('ems-to').press('Enter');
    await expect(page.getByTestId('ems-to-chip')).toHaveCount(1);
    await expect(page.getByTestId('ems-to-bad')).toContainText('wrong');
    await page.getByTestId('ems-to').fill('');
    await page.getByTestId('ems-to-pick').selectOption({ label: 'Demo Engineer' });
    await expect(page.getByTestId('ems-to-person')).toHaveCount(1);
    await page.getByTestId('ems-message').fill('Last month in short.');
    await page.getByTestId('ems-excel').check();
    await shot(page, 'report-send-dialog');
    await page.getByTestId('ems-send').click();
    await expect(dlg).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('report-sent')).toContainText('Sent to 2 recipients');
    const mail = (await sentMail(page)).at(-1)!;
    expect(mail.to).toEqual(['plant.manager@outside.org', 'engineer@demo.test']);
    expect(mail.attachments.map((a) => a.mimeType)).toEqual(['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    for (const label of ['Total stoppage', 'Reliability factor (RF)', 'Utilization factor (UF)', 'Last month in short.']) expect(mail.html).toContain(label);
    const pdf = Buffer.from(mail.attachments[0]!.base64, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(pages);
    if (SHOTS) writeFileSync(`${SHOTS}/report.pdf`, pdf);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('people without Edit on Reports see no Send button; the actions report and Report / send from an action', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'engineer');
    await page.goto('/#/reports?tpl=custom&p=lastmonth&s=summary&v=report');
    await page.locator('[data-testid=report][data-ready=true]').waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('report-send')).toHaveCount(0);
    // the actions report: all areas, open actions
    await page.goto('/#/reports');
    await page.getByTestId('report-type-actions').click();
    await expect(page.getByTestId('actions-report')).toBeVisible();
    await expect(page.getByTestId('arp-send')).toHaveCount(0);
    await expect(page.getByTestId('arp-scope')).toHaveText('All areas · open actions');
    const n = await page.getByTestId('arp-row').count();
    expect(n).toBeGreaterThan(0);
    await page.getByTestId('arp-status').selectOption('all');
    expect(await page.getByTestId('arp-row').count()).toBeGreaterThanOrEqual(n);
    await shot(page, 'actions-report');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('an action by itself: from its detail to the report, then sent with its tasks in the body', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'manager');
    await page.goto('/#/actions');
    await page.locator('[data-testid^=action-card]').first().click();
    const id = (await page.getByTestId('action-id').first().textContent())!.trim();
    await page.getByTestId('action-report').first().click();
    await expect(page.getByTestId('actions-report')).toBeVisible();
    await expect(page.getByTestId('arp-title')).toHaveText('Action report');
    await expect(page.getByTestId('arp-scope')).toHaveText(`Action ${id}`);
    await expect(page.getByTestId('arp-action')).toHaveCount(1);
    await page.getByTestId('arp-send').click();
    await page.getByTestId('ems-to').fill('contractor@outside.org');
    await page.getByTestId('ems-send').click();
    await expect(page.getByTestId('send-email')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('arp-note')).toContainText('Sent to 1 recipient');
    const mail = (await sentMail(page)).at(-1)!;
    expect(mail.subject).toContain(id);
    expect(mail.html).toContain(id);
    expect(mail.attachments.map((a) => a.mimeType)).toEqual(['application/pdf']);
    const pdf = Buffer.from(mail.attachments[0]!.base64, 'base64');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (SHOTS) writeFileSync(`${SHOTS}/action.pdf`, pdf);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the send dialog and the actions report fit a phone: no sideways scroll, 44 px targets', async ({ page }) => {
    const errors = watchConsole(page);
    await stubFonts(page);
    await signInAndWait(page, 'manager');
    await page.goto('/#/reports?type=actions&ast=all');
    await expect(page.getByTestId('actions-report')).toBeVisible();
    await expect(page.getByTestId('arp-row').first()).toBeVisible();
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    await shot(page, 'phone-actions-report');
    await page.getByTestId('arp-send').click();
    await expect(page.getByTestId('send-email')).toBeVisible();
    await page.getByTestId('ems-to').fill('a@b.org');
    await page.getByTestId('ems-to').press('Enter');
    expect((await noSidewaysScroll(page)).ok).toBe(true);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, 'phone-send-dialog');
    await page.getByTestId('ems-send').click();
    await expect(page.getByTestId('send-email')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('arp-note')).toContainText('Sent to 1 recipient');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
