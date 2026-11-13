import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { seedDemo } from '../src/services/demo.service';
import { agentFor, app, makeUser, resetDb } from './helpers';

async function demo(loginId: string) {
  const agent = request.agent(app());
  expect((await agent.post('/api/auth/demo-login').send({ loginId })).status).toBe(200);
  return agent;
}

/** SO for 10 Wooden Tables → MO for 8 → (MO confirmed) PO for legs + tops. */
async function chain() {
  const sales = await demo('salesuser');
  const table = await prisma.product.findUniqueOrThrow({ where: { name: 'Wooden Table' } });
  const customer = await prisma.contact.findFirstOrThrow({ where: { name: 'Suzuki India' } });
  const so = await sales.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: table.id, quantity: 10 }] });
  await sales.post(`/api/sales/${so.body.id}/confirm`);
  const mo = await prisma.manufacturingOrder.findFirstOrThrow({ where: { origin: so.body.reference } });
  const mfg = await demo('mfguser');
  await mfg.post(`/api/manufacturing/${mo.id}/confirm`);
  const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { origin: mo.reference } });
  return { sales, mfg, so: so.body as { id: number; reference: string }, mo, po };
}

describe('order journey', () => {
  beforeEach(async () => {
    await resetDb();
    await seedDemo();
  });

  it("SO journey shows MO child and MO's PO grandchild", async () => {
    const { mfg, so, mo, po } = await chain();
    const admin = await demo('sysadmin');
    const res = await admin.get(`/api/sales/${so.id}/journey`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'SO', reference: so.reference, progress: { level: 2 }, canOpen: true });
    expect(res.body.children).toHaveLength(1);
    const moNode = res.body.children[0];
    expect(moNode).toMatchObject({ kind: 'MO', id: mo.id, title: '8 × Wooden Table', progress: { level: 2, percent: 50 } });
    expect(moNode.children).toHaveLength(1);
    expect(moNode.children[0]).toMatchObject({ kind: 'PO', id: po.id, status: 'DRAFT', progress: { level: 1 } });
    expect(moNode.children[0].title).toContain('Timber Traders');
    expect(moNode.children[0].title).toContain('Wooden Legs');
    const fromMo = await mfg.get(`/api/manufacturing/${mo.id}/journey`);
    expect(fromMo.body.children.map((c: { kind: string }) => c.kind)).toEqual(['PO']);
  });

  it('cancelled auto-PO appears as a grey child', async () => {
    const { so, po } = await chain();
    const purchaser = await demo('purchaser');
    await purchaser.post(`/api/purchase/${po.id}/cancel`);
    const res = await (await demo('sysadmin')).get(`/api/sales/${so.id}/journey`);
    expect(res.status).toBe(200);
    expect(res.body.children[0].children[0]).toMatchObject({ status: 'CANCELLED', progress: { cancelled: true, stage: 'Cancelled' } });
  });

  it('sales-only user sees the chain but canOpen=false on MO/PO', async () => {
    const { sales, so } = await chain();
    const res = await sales.get(`/api/sales/${so.id}/journey`);
    expect(res.status).toBe(200);
    expect(res.body.canOpen).toBe(true);
    expect(res.body.children[0].canOpen).toBe(false);
    expect(res.body.children[0].children[0].canOpen).toBe(false);
    expect(res.body.children[0].title).toBe('Manufacturing order');
    expect(res.body.children[0].children[0].title).toBe('Purchase order');
    expect(JSON.stringify(res.body)).not.toContain('Timber Traders');
  });

  it('user without SALES view → 403 on /sales/:id/journey', async () => {
    const { so } = await chain();
    const outsider = await agentFor(await makeUser({ access: { PURCHASE: 'ADMIN' } }));
    expect((await outsider.get(`/api/sales/${so.id}/journey`)).status).toBe(403);
  });
});
