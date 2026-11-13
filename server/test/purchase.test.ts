import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { agentFor, makeContact, makeProduct, makeUser, resetDb } from './helpers.js';

async function setup(level: 'ADMIN' | 'USER' = 'ADMIN') {
  const vendor = await makeContact('VENDOR', 'Timber Traders');
  const legs = await makeProduct({ name: 'Wooden Legs', costPrice: 150 });
  const user = await makeUser({ access: { PURCHASE: level } });
  const agent = await agentFor(user);
  return { vendor, legs, user, agent };
}

describe('purchase orders', () => {
  beforeEach(resetDb);

  it('create draft PO gets PO-000001 and unitCost defaults to product cost', async () => {
    const { vendor, legs, agent } = await setup();
    const res = await agent.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 12 }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reference: 'PO-000001', status: 'DRAFT', vendor: { name: 'Timber Traders' }, total: 1800 });
    expect(res.body.lines[0]).toMatchObject({
      productName: 'Wooden Legs',
      quantity: 12,
      unitCost: 150,
      receivedQty: 0,
      pendingQty: 0,
    });
  });

  it('purchase USER cannot confirm → 403', async () => {
    const { vendor, legs, agent } = await setup('USER');
    const po = await agent.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 1 }] });
    expect(po.status).toBe(201);
    expect((await agent.post(`/api/purchase/${po.body.id}/confirm`)).status).toBe(403);
  });

  it('confirm then confirm again → 409 INVALID_TRANSITION', async () => {
    const { vendor, legs, agent } = await setup();
    const po = await agent.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 1 }] });
    const first = await agent.post(`/api/purchase/${po.body.id}/confirm`);
    expect(first.status).toBe(200);
    expect(first.body.order.status).toBe('CONFIRMED');
    const second = await agent.post(`/api/purchase/${po.body.id}/confirm`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('edit confirmed PO below receivedQty → 409 QTY_BELOW_COMMITTED', async () => {
    const { vendor, legs, agent } = await setup();
    const po = await agent.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 10 }] });
    await agent.post(`/api/purchase/${po.body.id}/confirm`);
    const line = po.body.lines[0];
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: 6 } });
    await prisma.purchaseOrder.update({ where: { id: po.body.id }, data: { status: 'PARTIALLY_RECEIVED' } });
    const res = await agent
      .patch(`/api/purchase/${po.body.id}`)
      .send({ vendorId: vendor.id, lines: [{ id: line.id, productId: legs.id, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QTY_BELOW_COMMITTED');
    const ok = await agent
      .patch(`/api/purchase/${po.body.id}`)
      .send({ vendorId: vendor.id, lines: [{ id: line.id, productId: legs.id, quantity: 8 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.lines[0].quantity).toBe(8);
  });

  it('cancel writes STATUS_CHANGE audit; delete only in draft', async () => {
    const { vendor, legs, agent } = await setup();
    const po = await agent.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 1 }] });
    await agent.post(`/api/purchase/${po.body.id}/confirm`);
    expect((await agent.delete(`/api/purchase/${po.body.id}`)).status).toBe(409);
    const cancel = await agent.post(`/api/purchase/${po.body.id}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    const rows = await prisma.auditLog.findMany({
      where: { module: 'PURCHASE', action: 'STATUS_CHANGE' },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => r.newValue)).toEqual(['CONFIRMED', 'CANCELLED']);
    expect((await agent.patch(`/api/purchase/${po.body.id}`).send({ vendorId: vendor.id, lines: [] })).status).toBe(400);
  });

  it('list late=true returns only past-expected confirmed orders', async () => {
    const { vendor, legs, agent } = await setup();
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    const a = await agent
      .post('/api/purchase')
      .send({ vendorId: vendor.id, expectedDate: past, lines: [{ productId: legs.id, quantity: 1 }] });
    await agent
      .post('/api/purchase')
      .send({ vendorId: vendor.id, expectedDate: past, lines: [{ productId: legs.id, quantity: 1 }] });
    await agent.post(`/api/purchase/${a.body.id}/confirm`);
    const res = await agent.get('/api/purchase').query({ late: 'true' });
    expect(res.body.items.map((i: { reference: string }) => i.reference)).toEqual([a.body.reference]);
    expect(res.body.items[0].late).toBe(true);
  });
});
