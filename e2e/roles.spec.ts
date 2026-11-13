import { expect, test } from '@playwright/test';
import { loginAs, resetDemo } from './helpers';

test.beforeAll(async ({ request }) => resetDemo(request));

test('Sales Manager only sees the modules their role allows', async ({ page }) => {
  await loginAs(page, 'Sales Manager');
  const nav = page.getByRole('complementary');
  await expect(nav.getByRole('link', { name: 'Sale Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Purchase Orders' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Audit Logs' })).toHaveCount(0);
});

test('Business Owner sees orders but cannot change them', async ({ page }) => {
  await loginAs(page, 'Business Owner');
  await page.goto('/sales?status=CONFIRMED');
  await page
    .getByRole('row', { name: /SO-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('SO-');
  for (const name of ['Edit', 'Deliver', 'Confirm', 'Cancel order']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
});

test('a new sign-up starts with no module access', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  await page.goto('/signup');
  const id = `e2e${Date.now() % 1_000_000}`;
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel(/Login Id/).fill(id);
  await page.getByLabel('Email').fill(`${id}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Strong@123');
  await page.getByLabel('Re-enter password').fill('Strong@123');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText(/No access yet/)).toBeVisible();
});
