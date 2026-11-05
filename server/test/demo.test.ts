import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { resetDemo, seedDemo, __resetThrottleForTests } from '../src/services/demo.service';
import { ledgerSumMatchesOnHand } from '../src/services/stock.service';
import { app, resetDb } from './helpers';

async function demoAgent(loginId: string) {
  const agent = request.agent(app());
  const res = await agent.post('/api/auth/demo-login').send({ loginId });
  expect(res.status).toBe(200);
  return agent;
}

async function productId(name: string): Promise<number> {
  return (await prisma.product.findUniqueOrThrow({ where: { name } })).id;
}

describe('demo seed and script', () => {
  beforeAll(async () => {
    await resetDb();
    await seedDemo();
  });

  it('seeds six locked demo users, products, BoMs and history', async () => {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    expect(users.map((u) => u.loginId)).toEqual(['sysadmin', 'salesuser', 'purchaser', 'mfguser', 'invmanager', 'bizowner']);
    expect(users.every((u) => u.isDemoLocked)).toBe(true);
    expect(await prisma.bom.count()).toBe(3);
    expect(await prisma.salesOrder.count({ where: { status: 'FULLY_DELIVERED' } })).toBeGreaterThan(0);
    expect(await prisma.stockOperation.count({ where: { status: 'PLACED' } })).toBeGreaterThan(0);
    expect(await ledgerSumMatchesOnHand(prisma)).toBe(true);
  });

  it('the README demo script works end to end', async () => {
    const table = await productId('Wooden Table');
    const sales = await demoAgent('salesuser');
    const customer = await prisma.contact.findFirstOrThrow({ where: { name: 'Suzuki India' } });
    const so = await sales.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: table, quantity: 10 }] });
    const confirmed = await sales.post(`/api/sales/${so.body.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.procured).toHaveLength(1);
    const mo = await prisma.manufacturingOrder.findFirstOrThrow({ where: { origin: so.body.reference } });
    expect(mo.quantity.toString()).toBe('8');

    const mfg = await demoAgent('mfguser');
    const moConfirmed = await mfg.post(`/api/manufacturing/${mo.id}/confirm`);
    expect(moConfirmed.body.procured).toHaveLength(1);
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { origin: mo.reference }, include: { lines: { include: { product: true } } } });
    expect(po.lines.map((l) => [l.product.name, l.quantity.toString()])).toEqual([
      ['Wooden Legs', '12'],
      ['Wooden Top', '5'],
    ]);

    const purchaser = await demoAgent('purchaser');
    expect((await purchaser.post(`/api/purchase/${po.id}/confirm`)).status).toBe(200);
    const receipt = await purchaser.post('/api/operations').send({
      type: 'RECEIPT',
      purchaseOrderId: po.id,
      lines: po.lines.map((l) => ({ purchaseOrderLineId: l.id, quantity: l.quantity.toNumber() })),
    });
    expect(receipt.status).toBe(201);
    const inventory = await demoAgent('invmanager');
    expect((await inventory.post(`/api/operations/${receipt.body.id}/confirm`)).status).toBe(200);

    const moNow = await mfg.get(`/api/manufacturing/${mo.id}`);
    for (const wo of moNow.body.workOrders as { id: number; expectedMinutes: number }[]) {
      expect((await mfg.post(`/api/manufacturing/${mo.id}/work-orders/${wo.id}/complete`).send({ realMinutes: wo.expectedMinutes })).status).toBe(200);
    }
    const produce = await mfg.post('/api/operations').send({ type: 'PRODUCTION', manufacturingOrderId: mo.id });
    expect((await mfg.post(`/api/operations/${produce.body.id}/confirm`)).status).toBe(200);

    const order = (await sales.get(`/api/sales/${so.body.id}`)).body;
    const deliver = await sales.post('/api/operations').send({
      type: 'DELIVERY',
      salesOrderId: so.body.id,
      lines: [{ salesOrderLineId: order.lines[0].id, quantity: 10 }],
    });
    expect((await sales.post(`/api/operations/${deliver.body.id}/confirm`)).status).toBe(200);

    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.body.id } })).status).toBe('FULLY_DELIVERED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: table } })).onHand.toString()).toBe('0');
    expect(await ledgerSumMatchesOnHand(prisma)).toBe(true);
  });

  it('dashboard counts all vs my per status and late; NONE module section is null', async () => {
    const sales = await demoAgent('salesuser');
    const res = await sales.get('/api/dashboard');
    expect(res.status).toBe(200);
    const all = await prisma.salesOrder.groupBy({ by: ['status'], _count: { _all: true } });
    for (const row of all) expect(res.body.sales.all[row.status]).toBe(row._count._all);
    expect(res.body.sales.late).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.sales.my.DRAFT).toBe('number');
    expect(res.body.purchase).toBeNull();
    expect(res.body.manufacturing).toBeNull();
    const owner = await demoAgent('bizowner');
    const full = await owner.get('/api/dashboard');
    expect(full.body.purchase).not.toBeNull();
    expect(full.body.awaitingConfirmation).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(full.body.shortages)).toBe(true);
  });

  it('resetDemo restores the seed; a second call within 15 s → 429; old session still works', async () => {
    const sales = await demoAgent('salesuser');
    __resetThrottleForTests();
    const first = await request(app()).post('/api/demo/reset');
    expect(first.status).toBe(200);
    expect(await prisma.manufacturingOrder.count({ where: { origin: { startsWith: 'SO-' } } })).toBe(0);
    const second = await request(app()).post('/api/demo/reset');
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('TOO_SOON');
    expect((await sales.get('/api/auth/me')).status).toBe(200);
    await expect(resetDemo()).rejects.toMatchObject({ status: 429 });
  });
});
