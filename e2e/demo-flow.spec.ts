import { expect, test } from '@playwright/test';
import { loginAs, openRow, progress, resetDemo } from './helpers';

/**
 * The README demo, end to end through the UI: 10 Wooden Tables with 2 in stock →
 * auto-created MO → its auto-created PO → receipt confirmed by the warehouse →
 * work orders + production → delivery → the sale "levels up" to 100%.
 */
test('demand to delivery: sale → MO → PO → receive → produce → deliver', async ({ page, request }) => {
  await resetDemo(request);

  // 1 · Sales Manager sells 10 Wooden Tables (only 2 in stock)
  await loginAs(page, 'Sales Manager');
  await page.goto('/sales/new');
  await page.locator('main select').first().selectOption({ label: 'Suzuki India' });
  await page.getByLabel('Product', { exact: true }).selectOption({ label: 'Wooden Table' });
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await expect(page.getByText(/Only 2 free/)).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/sales\/\d+$/);
  const soUrl = page.url();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText(/Auto-created: MO-\d{6}/)).toBeVisible();
  await expect(progress(page)).toHaveAttribute('aria-label', /Confirmed, 50%/);
  const chain = page.locator('.card', { has: page.getByRole('heading', { name: 'Supply chain' }) });
  const moRef = (await chain.innerText()).match(/MO-\d{6}/)?.[0] ?? '';
  expect(moRef).not.toBe('');

  // 2 · Production Head confirms the MO → a PO is auto-created for the missing legs/tops
  await loginAs(page, 'Production Head');
  await openRow(page, '/manufacturing', moRef);
  await expect(page.getByText(/Not available/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  const poNotice = page.getByText(/auto-created: PO-\d{6}/);
  await expect(poNotice).toBeVisible();
  const poRef = (await poNotice.innerText()).match(/PO-\d{6}/)?.[0] ?? '';

  // 3 · Purchase Manager confirms the PO and places the receipt (stock does not move yet)
  await loginAs(page, 'Purchase Manager');
  await openRow(page, '/purchase', poRef);
  // Draft lines are editable dropdowns: check the selected products, not every option
  await expect(page.locator('select[aria-label="Product"] option:checked')).toHaveText(['Wooden Legs', 'Wooden Top']);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Place/ })
    .click();
  await expect(page.getByText(/placed — stock moves once/)).toBeVisible();

  // 4 · Inventory Manager confirms the receipt on Stock Operations → stock arrives, PO at 100%
  await loginAs(page, 'Inventory Manager');
  await page.goto('/operations?status=PLACED');
  const receipt = page.getByRole('listitem').filter({ hasText: poRef });
  await receipt.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(receipt).toHaveCount(0);
  await openRow(page, '/purchase', poRef);
  await expect(progress(page)).toHaveAttribute('aria-label', /100%/);

  // 5 · Production Head finishes the work orders and produces → MO complete
  await loginAs(page, 'Production Head');
  await openRow(page, '/manufacturing', moRef);
  await page.getByRole('button', { name: 'Work orders' }).click();
  for (let i = 0; i < 3; i++) {
    const done = page.getByRole('button', { name: 'Mark done' });
    const before = await done.count();
    await done.first().click();
    await expect(done).toHaveCount(before - 1);
  }
  await expect(progress(page)).toHaveAttribute('aria-label', /75%/);
  await page.getByRole('button', { name: 'Produce', exact: true }).click();
  await page.getByRole('listitem').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Complete! 🎉')).toBeVisible();

  // 6 · Sales Manager delivers → the sale levels up to 100%
  await loginAs(page, 'Sales Manager');
  await page.goto(soUrl);
  await expect(progress(page)).toHaveAttribute('aria-label', /Supplied, 75%/);
  await page.getByRole('button', { name: 'Deliver', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Place/ })
    .click();
  await page.getByRole('listitem').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Fully delivered').first()).toBeVisible();
  await expect(page.getByText('Complete! 🎉')).toBeVisible();
});
