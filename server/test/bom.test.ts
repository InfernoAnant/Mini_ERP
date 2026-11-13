import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { agentFor, makeProduct, makeUser, resetDb } from './helpers.js';

async function setup() {
  const table = await makeProduct({ name: 'Wooden Table' });
  const legs = await makeProduct({ name: 'Wooden Legs' });
  const top = await makeProduct({ name: 'Wooden Top' });
  const screws = await makeProduct({ name: 'Screws' });
  const [assembly, paint, pack] = await Promise.all(
    ['Assembly Line', 'Paint Floor', 'Packaging Unit'].map((name) => prisma.workCenter.create({ data: { name } })),
  );
  const input = {
    productId: table.id,
    components: [
      { productId: legs.id, quantity: 4 },
      { productId: top.id, quantity: 1 },
      { productId: screws.id, quantity: 12 },
    ],
    operations: [
      { name: 'Assembly', workCenterId: assembly!.id, durationMinutes: 60 },
      { name: 'Painting', workCenterId: paint!.id, durationMinutes: 30 },
      { name: 'Packing', workCenterId: pack!.id, durationMinutes: 20 },
    ],
  };
  return { table, legs, input };
}

describe('bills of materials', () => {
  beforeEach(resetDb);

  it('creates BOM-000001 with 3 components and 3 operations', async () => {
    const { input } = await setup();
    const agent = await agentFor(await makeUser({ access: { BOM: 'ADMIN' } }));
    const res = await agent.post('/api/boms').send(input);
    expect(res.status).toBe(201);
    expect(res.body.reference).toBe('BOM-000001');
    expect(res.body.outputQty).toBe(1);
    expect(res.body.product.name).toBe('Wooden Table');
    expect(res.body.components.map((c: { productName: string; quantity: number }) => [c.productName, c.quantity])).toEqual([
      ['Wooden Legs', 4],
      ['Wooden Top', 1],
      ['Screws', 12],
    ]);
    expect(
      res.body.operations.map((o: { name: string; durationMinutes: number; workCenter: { name: string } }) => [
        o.name,
        o.durationMinutes,
        o.workCenter.name,
      ]),
    ).toEqual([
      ['Assembly', 60, 'Assembly Line'],
      ['Painting', 30, 'Paint Floor'],
      ['Packing', 20, 'Packaging Unit'],
    ]);
  });

  it('component equal to finished product → 400', async () => {
    const { table, input } = await setup();
    const agent = await agentFor(await makeUser({ access: { BOM: 'ADMIN' } }));
    const res = await agent.post('/api/boms').send({ ...input, components: [{ productId: table.id, quantity: 1 }] });
    expect(res.status).toBe(400);
  });

  it('BOM USER cannot create → 403', async () => {
    const { input } = await setup();
    const agent = await agentFor(await makeUser({ access: { BOM: 'USER' } }));
    expect((await agent.post('/api/boms').send(input)).status).toBe(403);
  });

  it('update replaces lines and audits the change', async () => {
    const { legs, input } = await setup();
    const agent = await agentFor(await makeUser({ access: { BOM: 'ADMIN' } }));
    const created = await agent.post('/api/boms').send(input);
    const res = await agent
      .patch(`/api/boms/${created.body.id}`)
      .send({ ...input, components: [{ productId: legs.id, quantity: 3 }] });
    expect(res.status).toBe(200);
    expect(res.body.components).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { module: 'BOM', field: 'components' } })).toBe(1);
  });

  it('delete BoM used by an MO → 409 IN_USE', async () => {
    const { table, input } = await setup();
    const user = await makeUser({ access: { BOM: 'ADMIN' } });
    const agent = await agentFor(user);
    const created = await agent.post('/api/boms').send(input);
    await prisma.manufacturingOrder.create({
      data: { reference: 'MO-X', productId: table.id, quantity: 1, bomId: created.body.id, createdById: user.id },
    });
    const res = await agent.delete(`/api/boms/${created.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('unused BoM can be deleted', async () => {
    const { input } = await setup();
    const agent = await agentFor(await makeUser({ access: { BOM: 'ADMIN' } }));
    const created = await agent.post('/api/boms').send(input);
    expect((await agent.delete(`/api/boms/${created.body.id}`)).status).toBe(200);
    expect(await prisma.bom.count()).toBe(0);
  });
});
