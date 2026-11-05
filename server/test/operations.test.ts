import type { AccessLevel, Module } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ledgerSumMatchesOnHand } from '../src/services/stock.service';
import { agentFor, makeContact, makeProduct, makeUser, resetDb, tableWithBom } from './helpers';

type Agent = Awaited<ReturnType<typeof agentFor>>;

async function as(access: Partial<Record<Module, AccessLevel>>): Promise<Agent> {
  return agentFor(await makeUser({ access }));
}

async function onHand(id: number): Promise<string> {
  return (await prisma.product.findUniqueOrThrow({ where: { id } })).onHand.toString();
}

/** Confirmed sales order for `qty` of a product with `stock` on hand. */
async function confirmedSale(stock: number | string, qty: number | string) {
  const salesAdmin = await as({ SALES: 'ADMIN' });
  const customer = await makeContact('CUSTOMER');
  const product = await makeProduct({ onHand: stock });
  const so = await salesAdmin.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: product.id, quantity: qty }] });
  await salesAdmin.post(`/api/sales/${so.body.id}/confirm`);
  return { salesAdmin, product, so: so.body as { id: number; lines: { id: number }[] } };
}

function deliver(agent: Agent, so: { id: number; lines: { id: number }[] }, quantity: number | string) {
  return agent.post('/api/operations').send({ type: 'DELIVERY', salesOrderId: so.id, lines: [{ salesOrderLineId: so.lines[0]!.id, quantity }] });
}

describe('stock operations: place, then confirm', () => {
  beforeEach(resetDb);

  it('placing a delivery does not change onHand; confirming does', async () => {
    const { salesAdmin, product, so } = await confirmedSale(10, 4);
    const op = await deliver(salesAdmin, so, 4);
    expect(op.status).toBe(201);
    expect(op.body).toMatchObject({ reference: 'OP-000001', type: 'DELIVERY', status: 'PLACED', source: { kind: 'SO', id: so.id } });
    expect(await onHand(product.id)).toBe('10');
    const confirmed = await salesAdmin.post(`/api/operations/${op.body.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(await onHand(product.id)).toBe('6');
  });

  it('SALES ADMIN can place and confirm their own delivery', async () => {
    const { salesAdmin, so } = await confirmedSale(5, 5);
    const op = await deliver(salesAdmin, so, 5);
    expect((await salesAdmin.post(`/api/operations/${op.body.id}/confirm`)).status).toBe(200);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe('FULLY_DELIVERED');
  });

  it('SALES USER can place a delivery but confirming it → 403; the inventory manager can confirm it', async () => {
    const { so } = await confirmedSale(5, 5);
    const salesUser = await as({ SALES: 'USER' });
    const op = await deliver(salesUser, so, 2);
    expect(op.status).toBe(201);
    const denied = await salesUser.post(`/api/operations/${op.body.id}/confirm`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/supervisor or manager/);
    const inventory = await as({ PRODUCTS: 'ADMIN', SALES: 'USER', PURCHASE: 'USER', MANUFACTURING: 'USER' });
    expect((await inventory.post(`/api/operations/${op.body.id}/confirm`)).status).toBe(200);
  });

  it('user without SALES access cannot place a delivery → 403', async () => {
    const { so } = await confirmedSale(5, 5);
    expect((await deliver(await as({ PURCHASE: 'ADMIN' }), so, 1)).status).toBe(403);
  });

  it('PURCHASE USER places a receipt; PURCHASE ADMIN or inventory manager confirms; PURCHASE USER reject → 403', async () => {
    const vendor = await makeContact('VENDOR');
    const legs = await makeProduct({ onHand: 0 });
    const purchaseAdmin = await as({ PURCHASE: 'ADMIN' });
    const po = await purchaseAdmin.post('/api/purchase').send({ vendorId: vendor.id, lines: [{ productId: legs.id, quantity: 12 }] });
    await purchaseAdmin.post(`/api/purchase/${po.body.id}/confirm`);
    const purchaseUser = await as({ PURCHASE: 'USER' });
    const receipt = (q: number) =>
      purchaseUser.post('/api/operations').send({ type: 'RECEIPT', purchaseOrderId: po.body.id, lines: [{ purchaseOrderLineId: po.body.lines[0].id, quantity: q }] });
    const a = await receipt(5);
    expect(a.status).toBe(201);
    expect((await purchaseUser.post(`/api/operations/${a.body.id}/reject`).send({ reason: 'Damaged' })).status).toBe(403);
    expect((await purchaseAdmin.post(`/api/operations/${a.body.id}/confirm`)).status).toBe(200);
    expect(await onHand(legs.id)).toBe('5');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('PARTIALLY_RECEIVED');
    const b = await receipt(7);
    const inventory = await as({ PRODUCTS: 'ADMIN' });
    expect((await inventory.post(`/api/operations/${b.body.id}/confirm`)).status).toBe(200);
    expect(await onHand(legs.id)).toBe('12');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('FULLY_RECEIVED');
  });

  it('second placement cannot exceed remaining minus pending → 409 QTY_EXCEEDS_REMAINING', async () => {
    const { salesAdmin, so } = await confirmedSale(10, 10);
    expect((await deliver(salesAdmin, so, 6)).status).toBe(201);
    const res = await deliver(salesAdmin, so, 5);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QTY_EXCEEDS_REMAINING');
    expect((await deliver(salesAdmin, so, 4)).status).toBe(201);
  });

  it('partial delivery → PARTIALLY_DELIVERED, rest → FULLY_DELIVERED', async () => {
    const { salesAdmin, so } = await confirmedSale(10, 10);
    const a = await deliver(salesAdmin, so, 3);
    await salesAdmin.post(`/api/operations/${a.body.id}/confirm`);
    expect((await salesAdmin.get(`/api/sales/${so.id}`)).body.status).toBe('PARTIALLY_DELIVERED');
    const b = await deliver(salesAdmin, so, 7);
    await salesAdmin.post(`/api/operations/${b.body.id}/confirm`);
    const order = (await salesAdmin.get(`/api/sales/${so.id}`)).body;
    expect(order.status).toBe('FULLY_DELIVERED');
    expect(order.lines[0].deliveredQty).toBe(10);
    expect(order.operations.map((o: { status: string }) => o.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('ordered 2.5 delivered as 1.25 + 1.25 → FULLY_DELIVERED', async () => {
    const { salesAdmin, so } = await confirmedSale('5', '2.5');
    for (const q of ['1.25', '1.25']) {
      const op = await deliver(salesAdmin, so, q);
      expect(op.status).toBe(201);
      expect((await salesAdmin.post(`/api/operations/${op.body.id}/confirm`)).status).toBe(200);
    }
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe('FULLY_DELIVERED');
  });

  it('two placed deliveries of 5 each with onHand 5, confirmed at once → one 200, one 409, onHand 0', async () => {
    const salesAdmin = await as({ SALES: 'ADMIN' });
    const customer = await makeContact('CUSTOMER');
    const product = await makeProduct({ onHand: 5 });
    const ops: number[] = [];
    for (let i = 0; i < 2; i++) {
      const so = await salesAdmin.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: product.id, quantity: 5 }] });
      await salesAdmin.post(`/api/sales/${so.body.id}/confirm`);
      ops.push((await deliver(salesAdmin, so.body, 5)).body.id);
    }
    const results = await Promise.all(ops.map((id) => salesAdmin.post(`/api/operations/${id}/confirm`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(product.id)).toBe('0');
  });

  it('cancel order with placed op → op REJECTED "Order cancelled", confirming it → 409 OPERATION_CLOSED', async () => {
    const { salesAdmin, product, so } = await confirmedSale(10, 5);
    const op = await deliver(salesAdmin, so, 5);
    await salesAdmin.post(`/api/sales/${so.id}/cancel`);
    const row = await prisma.stockOperation.findUniqueOrThrow({ where: { id: op.body.id } });
    expect(row).toMatchObject({ status: 'REJECTED', rejectReason: 'Order cancelled' });
    const res = await salesAdmin.post(`/api/operations/${op.body.id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPERATION_CLOSED');
    expect(await onHand(product.id)).toBe('10');
  });

  it('production confirm consumes 40/10/120 and produces 10, MO DONE', async () => {
    const mfg = await makeUser({ access: { MANUFACTURING: 'ADMIN' } });
    const agent = await agentFor(mfg);
    const { table, legs, top, screws, bom } = await tableWithBom(mfg.id);
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 10, bomId: bom.id });
    await agent.post(`/api/manufacturing/${mo.body.id}/confirm`);
    const op = await agent.post('/api/operations').send({ type: 'PRODUCTION', manufacturingOrderId: mo.body.id });
    expect(op.status).toBe(201);
    expect(await onHand(table.id)).toBe('0');
    expect((await agent.post(`/api/operations/${op.body.id}/confirm`)).status).toBe(200);
    expect([await onHand(legs.id), await onHand(top.id), await onHand(screws.id), await onHand(table.id)]).toEqual(['60', '90', '880', '10']);
    const after = await agent.get(`/api/manufacturing/${mo.body.id}`);
    expect(after.body.status).toBe('DONE');
    expect(after.body.components.map((c: { consumed: number }) => c.consumed)).toEqual([40, 10, 120]);
  });

  it('production confirm with missing components → 409 INSUFFICIENT_STOCK, MO unchanged', async () => {
    const mfg = await makeUser({ access: { MANUFACTURING: 'ADMIN' } });
    const agent = await agentFor(mfg);
    const { table, bom } = await tableWithBom(mfg.id);
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 30, bomId: bom.id }); // needs 120 legs, have 100
    await agent.post(`/api/manufacturing/${mo.body.id}/confirm`);
    const op = await agent.post('/api/operations').send({ type: 'PRODUCTION', manufacturingOrderId: mo.body.id });
    const res = await agent.post(`/api/operations/${op.body.id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await agent.get(`/api/manufacturing/${mo.body.id}`)).body.status).toBe('CONFIRMED');
    expect(await onHand(table.id)).toBe('0');
  });

  it('adjustment target 50 from 42 posts +8; reject posts nothing', async () => {
    const product = await makeProduct({ onHand: 42 });
    const inventory = await as({ PRODUCTS: 'ADMIN' });
    const a = await inventory.post('/api/operations').send({ type: 'ADJUSTMENT', productId: product.id, targetQty: 50, reason: 'Stock count' });
    expect(a.status).toBe(201);
    expect(await onHand(product.id)).toBe('42');
    await inventory.post(`/api/operations/${a.body.id}/confirm`);
    expect(await onHand(product.id)).toBe('50');
    const move = await prisma.stockMove.findFirstOrThrow({ where: { productId: product.id, type: 'ADJUSTMENT', reference: 'OP-000001' } });
    expect(move.quantity.toString()).toBe('8');
    const b = await inventory.post('/api/operations').send({ type: 'ADJUSTMENT', productId: product.id, targetQty: 0, reason: 'Oops' });
    const rejected = await inventory.post(`/api/operations/${b.body.id}/reject`).send({ reason: 'Wrong count' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectReason: 'Wrong count' });
    expect(await onHand(product.id)).toBe('50');
  });

  it('PRODUCTS USER cannot place adjustment → 403', async () => {
    const product = await makeProduct({ onHand: 1 });
    const res = await (await as({ PRODUCTS: 'USER' })).post('/api/operations').send({ type: 'ADJUSTMENT', productId: product.id, targetQty: 5, reason: 'Count' });
    expect(res.status).toBe(403);
  });

  it('list filters by status and the ledger sum still equals onHand', async () => {
    const { salesAdmin, so } = await confirmedSale(10, 10);
    const a = await deliver(salesAdmin, so, 2);
    await deliver(salesAdmin, so, 3);
    await salesAdmin.post(`/api/operations/${a.body.id}/confirm`);
    const placed = await salesAdmin.get('/api/operations').query({ status: 'PLACED' });
    expect(placed.body.total).toBe(1);
    expect(placed.body.items[0].lines[0].quantity).toBe(3);
    expect(await ledgerSumMatchesOnHand(prisma)).toBe(true);
  });
});
