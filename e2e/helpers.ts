import { type APIRequestContext, expect, type Page } from '@playwright/test';

export type DemoRole =
  'System Admin' | 'Sales Manager' | 'Purchase Manager' | 'Production Head' | 'Inventory Manager' | 'Business Owner';

/** Restore the seeded demo. The API allows one reset per 15 s, so wait once and retry on 429. */
export async function resetDemo(request: APIRequestContext): Promise<void> {
  let res = await request.post('/api/demo/reset');
  if (res.status() === 429) {
    await new Promise((r) => setTimeout(r, 16_000));
    res = await request.post('/api/demo/reset');
  }
  expect(res.ok(), `demo reset failed: ${res.status()}`).toBeTruthy();
}

/** Log in through the "Try a demo account" buttons on the login page. */
export async function loginAs(page: Page, role: DemoRole): Promise<void> {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Open the first list row containing `text` (list rows navigate on click). */
export async function openRow(page: Page, listPath: string, text: string): Promise<void> {
  await page.goto(`${listPath}?q=${encodeURIComponent(text)}`);
  await page.getByRole('row', { name: new RegExp(text) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(text);
}

/** The order's big level bar (aria-label "Progress: <stage>, <n>%"). */
export const progress = (page: Page) => page.getByLabel(/^Progress:/);
