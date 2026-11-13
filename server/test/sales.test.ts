import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getLevels } from '../src/services/stock.service';
import { agentFor, makeContact, makeProduct, makeUser, resetDb } from './helpers';

async function setup(level: 'ADMIN' | 'USER' = 'ADMIN') {
  const customer = await makeContact('CUSTOMER', 'Suzuki India');
  const chair = await makeProduct({ name: 'Wooden Chair', onHand: 100, salesPrice: 2000 });
  const user = await makeUser({ access: { SALES: level } });
  return { customer, chair, user, agent: await agentFor(user) };
}

async function reserved(productId: number): Promise<string> {
  return (await getLevels(prisma, [productId])).get(productId)!.reserved.toString();
}

describe('sales orders', () => {
  beforeEach(resetDb);

  it('create, confirm reserves remaining qty', async () => {
    const { customer, chair, agent } = await setup();
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 10 }] });
    expect(so.status).toBe(201);
    expect(so.body).toMatchObject({ reference: 'SO-000001', status: 'DRAFT', customer: { name: 'Suzuki India' }, total: 20000 });
    expect(so.body.lines[0]).toMatchObject({ unitPrice: 2000, available: true, deliveredQty: 0 });
    expect(await reserved(chair.id)).toBe('0');
    const res = await agent.post(`/api/sales/${so.body.id}/confirm`);
    expect(res.body.order.status).toBe('CONFIRMED');
    expect(await reserved(chair.id)).toBe('10');
  });

  it('sales USER cannot confirm → 403', async () => {
    const { customer, chair, agent } = await setup('USER');
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    expect((await agent.post(`/api/sales/${so.body.id}/confirm`)).status).toBe(403);
  });

  it('edit confirmed order below delivered → 409 QTY_BELOW_COMMITTED and nothing changes', async () => {
    const { customer, chair, agent } = await setup();
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 10 }] });
    await agent.post(`/api/sales/${so.body.id}/confirm`);
    const lineId = so.body.lines[0].id;
    await prisma.salesOrderLine.update({ where: { id: lineId }, data: { deliveredQty: 6 } });
    const res = await agent
      .patch(`/api/sales/${so.body.id}`)
      .send({ customerId: customer.id, lines: [{ id: lineId, productId: chair.id, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QTY_BELOW_COMMITTED');
    expect((await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId } })).quantity.toString()).toBe('10');
  });

  it('edit confirmed order +5 procures only the extra shortage', async () => {
    const vendor = await makeContact('VENDOR');
    const { customer, agent } = await setup();
    const chair = await makeProduct({ onHand: 10, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id });
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 10 }] });
    const confirmed = await agent.post(`/api/sales/${so.body.id}/confirm`);
    expect(confirmed.body.procured).toEqual([]);
    const lineId = so.body.lines[0].id;
    const res = await agent
      .patch(`/api/sales/${so.body.id}`)
      .send({ customerId: customer.id, lines: [{ id: lineId, productId: chair.id, quantity: 15 }] });
    expect(res.status).toBe(200);
    expect(res.body.procured).toEqual(['PO-000001']);
    const line = await prisma.purchaseOrderLine.findFirstOrThrow();
    expect(line.quantity.toString()).toBe('5');
    expect(await reserved(chair.id)).toBe('15');
  });

  it('cancel confirmed order releases reservation', async () => {
    const { customer, chair, agent } = await setup();
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 7 }] });
    await agent.post(`/api/sales/${so.body.id}/confirm`);
    expect(await reserved(chair.id)).toBe('7');
    const res = await agent.post(`/api/sales/${so.body.id}/cancel`);
    expect(res.body.status).toBe('CANCELLED');
    expect(await reserved(chair.id)).toBe('0');
  });

  it('delete confirmed → 409; delete draft → ok', async () => {
    const { customer, chair, agent } = await setup();
    const a = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    const b = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    await agent.post(`/api/sales/${a.body.id}/confirm`);
    expect((await agent.delete(`/api/sales/${a.body.id}`)).status).toBe(409);
    expect((await agent.delete(`/api/sales/${b.body.id}`)).status).toBe(200);
  });

  it('list late=true returns only past-scheduled confirmed orders; mine filters by salesperson', async () => {
    const { customer, chair, agent, user } = await setup();
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    const late = await agent
      .post('/api/sales')
      .send({ customerId: customer.id, scheduledDate: past, lines: [{ productId: chair.id, quantity: 1 }] });
    await agent
      .post('/api/sales')
      .send({ customerId: customer.id, scheduledDate: past, lines: [{ productId: chair.id, quantity: 1 }] });
    await agent.post(`/api/sales/${late.body.id}/confirm`);
    const res = await agent.get('/api/sales').query({ late: '1' });
    expect(res.body.items.map((i: { reference: string }) => i.reference)).toEqual([late.body.reference]);
    const other = await agentFor(await makeUser({ access: { SALES: 'ADMIN' } }));
    await other.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    const mine = await agent.get('/api/sales').query({ mine: 'true' });
    expect(mine.body.total).toBe(2);
    expect(user.id).toBeGreaterThan(0);
  });

  it('every status change writes an audit row', async () => {
    const { customer, chair, agent } = await setup();
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    await agent.post(`/api/sales/${so.body.id}/confirm`);
    await agent.post(`/api/sales/${so.body.id}/cancel`);
    const rows = await prisma.auditLog.findMany({ where: { module: 'SALES', recordId: so.body.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.action, r.newValue])).toEqual([
      ['CREATE', null],
      ['STATUS_CHANGE', 'CONFIRMED'],
      ['STATUS_CHANGE', 'CANCELLED'],
    ]);
  });

  it('availability warning when ordered qty exceeds free-to-use', async () => {
    const { customer, agent } = await setup();
    const scarce = await makeProduct({ onHand: 2 });
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: scarce.id, quantity: 5 }] });
    expect(so.body.lines[0].available).toBe(false);
  });
});
