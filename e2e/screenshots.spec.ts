import { expect, test } from '@playwright/test';
import { loginAs, resetDemo } from './helpers';

/** Captures README screenshots into docs/screenshots. Run with: SCREENSHOTS=1 npx playwright test --grep @screens */
test('@screens capture README screenshots', async ({ page, request }) => {
  await resetDemo(request);
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: false });
  const api = page.request;
  const json = async <T>(p: Promise<{ json(): Promise<unknown> }>) => (await (await p).json()) as T;

  await page.goto('/login');
  await expect(page.getByText('Try a demo account')).toBeVisible();
  await shot('01-login');

  // Mid-flow state: SO for 10 tables confirmed → MO confirmed → PO confirmed + received, 2 work orders done.
  await api.post('/api/auth/demo-login', { data: { loginId: 'salesuser' } });
  const products = await json<{ id: number; name: string }[]>(api.get('/api/products/options'));
  const customers = await json<{ id: number; name: string }[]>(api.get('/api/contacts?type=CUSTOMER'));
  const table = products.find((p) => p.name === 'Wooden Table')!;
  const suzuki = customers.find((c) => c.name === 'Suzuki India')!;
  const so = await json<{ id: number }>(
    api.post('/api/sales', { data: { customerId: suzuki.id, lines: [{ productId: table.id, quantity: 10 }] } }),
  );
  const confirmed = await json<{ order: { procurements: { id: number }[] } }>(api.post(`/api/sales/${so.id}/confirm`));
  const moId = confirmed.order.procurements[0]!.id;
  await api.post('/api/auth/demo-login', { data: { loginId: 'mfguser' } });
  const mo = await json<{ procured: string[] }>(api.post(`/api/manufacturing/${moId}/confirm`));
  await api.post('/api/auth/demo-login', { data: { loginId: 'purchaser' } });
  const pos = await json<{ items: { id: number; lines: { id: number; quantity: number }[] }[] }>(
    api.get(`/api/purchase?q=${mo.procured[0]}`),
  );
  const po = pos.items[0]!;
  await api.post(`/api/purchase/${po.id}/confirm`);
  const receipt = await json<{ id: number }>(
    api.post('/api/operations', {
      data: {
        type: 'RECEIPT',
        purchaseOrderId: po.id,
        lines: po.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: l.quantity })),
      },
    }),
  );
  await api.post('/api/auth/demo-login', { data: { loginId: 'invmanager' } });
  await api.post(`/api/operations/${receipt.id}/confirm`);
  await api.post('/api/auth/demo-login', { data: { loginId: 'mfguser' } });
  const moDto = await json<{ workOrders: { id: number }[] }>(api.get(`/api/manufacturing/${moId}`));
  for (const wo of moDto.workOrders.slice(0, 2)) {
    await api.post(`/api/manufacturing/${moId}/work-orders/${wo.id}/complete`, { data: { realMinutes: 300 } });
  }

  await loginAs(page, 'System Admin');
  await expect(page.getByText('Sale Orders').first()).toBeVisible();
  await shot('02-dashboard');

  await page.goto(`/sales/${so.id}`);
  await expect(page.getByRole('heading', { name: 'Supply chain' })).toBeVisible();
  await shot('03-sales-order-level-up');

  await page.goto(`/manufacturing/${moId}`);
  await page.getByRole('button', { name: 'Work orders' }).click();
  await shot('04-manufacturing-work-orders');

  await page.goto('/sales?view=kanban');
  await expect(page.getByText('SO-000006')).toBeVisible();
  await shot('05-sales-kanban');

  await page.goto('/products');
  await expect(page.getByText('Wooden Panel')).toBeVisible();
  await shot('06-products-stock');

  await page.goto('/audit');
  await expect(page.getByText('Total logs')).toBeVisible();
  await shot('07-audit-log');
});
