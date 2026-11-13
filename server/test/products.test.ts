import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { agentFor, makeContact, makeUser, resetDb } from './helpers.js';

describe('products', () => {
  beforeEach(resetDb);

  it('create with initialStock 5 gives onHand 5 and one ADJUSTMENT move', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const res = await agent
      .post('/api/products')
      .send({ name: 'Wooden Chair', salesPrice: 2000, costPrice: 1100, initialStock: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Wooden Chair', onHand: 5, reserved: 0, free: 5, salesPrice: 2000 });
    const moves = await prisma.stockMove.findMany({ where: { productId: res.body.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: 'ADJUSTMENT', reference: 'INITIAL' });
    expect(await prisma.auditLog.count({ where: { recordType: 'Product', action: 'CREATE' } })).toBe(1);
  });

  it('procureOnDemand PURCHASE without vendor → 400', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const res = await agent
      .post('/api/products')
      .send({ name: 'Legs', salesPrice: 1, costPrice: 1, procureOnDemand: true, procurementType: 'PURCHASE' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/vendor/i);
  });

  it('procureOnDemand PURCHASE with vendor is accepted', async () => {
    const vendor = await makeContact('VENDOR', 'Timber Traders');
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const res = await agent.post('/api/products').send({
      name: 'Legs',
      salesPrice: 1,
      costPrice: 1,
      procureOnDemand: true,
      procurementType: 'PURCHASE',
      vendorId: vendor.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.vendor).toEqual({ id: vendor.id, name: 'Timber Traders' });
  });

  it('price change writes UPDATE audit with old and new value', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const created = await agent.post('/api/products').send({ name: 'Table', salesPrice: 120, costPrice: 80 });
    const res = await agent.patch(`/api/products/${created.body.id}`).send({ salesPrice: 135 });
    expect(res.status).toBe(200);
    expect(res.body.salesPrice).toBe(135);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { field: 'salesPrice' } });
    expect(row).toMatchObject({ action: 'UPDATE', oldValue: '120', newValue: '135', module: 'PRODUCTS' });
  });

  it("PRODUCTS USER can create but cannot edit another user's product → 403", async () => {
    const owner = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const created = await owner.post('/api/products').send({ name: 'Shelf', salesPrice: 1, costPrice: 1 });
    const user = await agentFor(await makeUser({ access: { PRODUCTS: 'USER' } }));
    const own = await user.post('/api/products').send({ name: 'Mine', salesPrice: 1, costPrice: 1 });
    expect(own.status).toBe(201);
    expect((await user.patch(`/api/products/${own.body.id}`).send({ salesPrice: 2 })).status).toBe(200);
    expect((await user.patch(`/api/products/${created.body.id}`).send({ salesPrice: 2 })).status).toBe(403);
  });

  it('GET /products/:id returns reserved and free; NONE access → 403', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const created = await agent.post('/api/products').send({ name: 'Desk', salesPrice: 1, costPrice: 1, initialStock: 3 });
    const res = await agent.get(`/api/products/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onHand: 3, reserved: 0, free: 3 });
    const none = await agentFor(await makeUser());
    expect((await none.get(`/api/products/${created.body.id}`)).status).toBe(403);
  });

  it('list supports search and paging; ledger lists moves', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    await agent.post('/api/products').send({ name: 'Oak Table', salesPrice: 1, costPrice: 1, initialStock: 1 });
    await agent.post('/api/products').send({ name: 'Pine Chair', salesPrice: 1, costPrice: 1 });
    const list = await agent.get('/api/products').query({ q: 'oak' });
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe('Oak Table');
    const ledger = await agent.get(`/api/products/${list.body.items[0].id}/ledger`);
    expect(ledger.body.items[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: 1, reference: 'INITIAL' });
  });

  it('contacts: list by type and create', async () => {
    await makeContact('VENDOR', 'Hardware Hub');
    const agent = await agentFor(await makeUser({ access: { SALES: 'USER' } }));
    const created = await agent.post('/api/contacts').send({ name: 'Taj Hotels', type: 'CUSTOMER', address: 'Mumbai' });
    expect(created.status).toBe(201);
    const customers = await agent.get('/api/contacts').query({ type: 'CUSTOMER' });
    expect(customers.body.map((c: { name: string }) => c.name)).toEqual(['Taj Hotels']);
  });
});
