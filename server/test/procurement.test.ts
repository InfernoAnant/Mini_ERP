import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { agentFor, makeContact, makeProduct, makeUser, resetDb, tableWithBom } from './helpers';

async function salesAgent() {
  return agentFor(await makeUser({ access: { SALES: 'ADMIN' } }));
}

async function sell(agent: Awaited<ReturnType<typeof salesAgent>>, productId: number, quantity: number) {
  const customer = await makeContact('CUSTOMER');
  const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId, quantity }] });
  expect(so.status).toBe(201);
  const res = await agent.post(`/api/sales/${so.body.id}/confirm`);
  expect(res.status).toBe(200);
  return res.body as { order: { id: number; reference: string; procurements: { reference: string; type: string; status: string }[] }; procured: string[] };
}

/** Wooden Table set to MTO manufacture with its BoM; legs/top/screws MTO purchase from Timber Traders. */
async function mtoTable(tableOnHand: number) {
  const admin = await makeUser({ isSystemAdmin: true });
  const fx = await tableWithBom(admin.id);
  const vendor = await makeContact('VENDOR', 'Timber Traders');
  await prisma.product.update({
    where: { id: fx.table.id },
    data: { procureOnDemand: true, procurementType: 'MANUFACTURING', defaultBomId: fx.bom.id, onHand: tableOnHand },
  });
  if (tableOnHand) {
    await prisma.stockMove.create({ data: { productId: fx.table.id, quantity: tableOnHand, type: 'ADJUSTMENT', reference: 'FIXTURE', userId: 0 } });
  }
  for (const [p, onHand] of [[fx.legs, 20], [fx.top, 3]] as const) {
    await prisma.product.update({ where: { id: p.id }, data: { procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id, onHand } });
    await prisma.stockMove.deleteMany({ where: { productId: p.id } });
    await prisma.stockMove.create({ data: { productId: p.id, quantity: onHand, type: 'ADJUSTMENT', reference: 'FIXTURE', userId: 0 } });
  }
  return { ...fx, vendor };
}

describe('MTO procurement', () => {
  beforeEach(resetDb);

  it('MTO manufacture: onHand 5, order 20 → draft MO for 15 with origin SO-000001', async () => {
    const { table } = await mtoTable(5);
    const res = await sell(await salesAgent(), table.id, 20);
    expect(res.procured).toEqual(['MO-000001']);
    const mo = await prisma.manufacturingOrder.findFirstOrThrow();
    expect(mo).toMatchObject({ status: 'DRAFT', origin: 'SO-000001' });
    expect(mo.quantity.toString()).toBe('15');
    expect(res.order.procurements).toEqual([{ id: mo.id, reference: 'MO-000001', type: 'MO', status: 'DRAFT' }]);
  });

  it("MTO purchase: onHand 2, order 10 → draft PO for 8 to the product's vendor", async () => {
    const vendor = await makeContact('VENDOR', 'Comfort Seating Co.');
    const chair = await makeProduct({ name: 'Office Chair', onHand: 2, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id, costPrice: 2000 });
    const res = await sell(await salesAgent(), chair.id, 10);
    expect(res.procured).toEqual(['PO-000001']);
    const po = await prisma.purchaseOrder.findFirstOrThrow({ include: { lines: true } });
    expect(po).toMatchObject({ status: 'DRAFT', vendorId: vendor.id, origin: 'SO-000001' });
    expect(po.lines.map((l) => [l.productId, l.quantity.toString(), l.unitCost.toString()])).toEqual([[chair.id, '8', '2000']]);
  });

  it('procureOnDemand off: no PO/MO created', async () => {
    const chair = await makeProduct({ name: 'Wooden Chair', onHand: 1 });
    const res = await sell(await salesAgent(), chair.id, 10);
    expect(res.procured).toEqual([]);
    expect(await prisma.purchaseOrder.count()).toBe(0);
    expect(await prisma.manufacturingOrder.count()).toBe(0);
  });

  it('free already negative: second order of 10 procures exactly 10, not more', async () => {
    const vendor = await makeContact('VENDOR');
    const chair = await makeProduct({ onHand: 2, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id });
    const agent = await salesAgent();
    await sell(agent, chair.id, 10);
    await sell(agent, chair.id, 10);
    const lines = await prisma.purchaseOrderLine.findMany({ orderBy: { id: 'asc' } });
    expect(lines.map((l) => l.quantity.toString())).toEqual(['8', '10']);
  });

  it('two products from same vendor → one PO with two lines', async () => {
    const vendor = await makeContact('VENDOR');
    const a = await makeProduct({ onHand: 0, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id });
    const b = await makeProduct({ onHand: 1, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id });
    const customer = await makeContact('CUSTOMER');
    const agent = await salesAgent();
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 4 }] });
    const res = await agent.post(`/api/sales/${so.body.id}/confirm`);
    expect(res.body.procured).toEqual(['PO-000001']);
    const lines = await prisma.purchaseOrderLine.findMany({ orderBy: { id: 'asc' } });
    expect(lines.map((l) => [l.productId, l.quantity.toString()])).toEqual([[a.id, '3'], [b.id, '3']]);
  });

  it('confirming the auto-created MO procures its short components (chain)', async () => {
    const { table, legs, top } = await mtoTable(2);
    await sell(await salesAgent(), table.id, 10); // MO for 8
    const mo = await prisma.manufacturingOrder.findFirstOrThrow();
    const mfg = await agentFor(await makeUser({ access: { MANUFACTURING: 'ADMIN' } }));
    const res = await mfg.post(`/api/manufacturing/${mo.id}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.procured).toEqual(['PO-000001']); // legs 32 (have 20) + tops 8 (have 3), same vendor
    const lines = await prisma.purchaseOrderLine.findMany({ orderBy: { id: 'asc' } });
    expect(lines.map((l) => [l.productId, l.quantity.toString()])).toEqual([[legs.id, '12'], [top.id, '5']]);
    expect((await prisma.purchaseOrder.findFirstOrThrow()).origin).toBe(mo.reference);
  });

  it('sales user without Purchase access can confirm and procurement still creates the PO', async () => {
    const vendor = await makeContact('VENDOR');
    const chair = await makeProduct({ onHand: 0, procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id });
    const res = await sell(await salesAgent(), chair.id, 2);
    expect(res.procured).toEqual(['PO-000001']);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { module: 'PURCHASE', action: 'CREATE' } });
    expect(audit.note).toBe('Auto-procurement from SO-000001');
  });
});
