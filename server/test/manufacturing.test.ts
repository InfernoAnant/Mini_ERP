import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { getLevels } from '../src/services/stock.service.js';
import { agentFor, makeProduct, makeUser, resetDb, tableWithBom } from './helpers.js';

async function setup() {
  const user = await makeUser({ access: { MANUFACTURING: 'ADMIN' } });
  const agent = await agentFor(user);
  const fx = await tableWithBom(user.id);
  return { user, agent, ...fx };
}

describe('manufacturing orders', () => {
  beforeEach(resetDb);

  it('MO for 10 Wooden Tables from BoM has toConsume 40/10/120 and expectedMinutes 600/300/200', async () => {
    const { agent, table, bom } = await setup();
    const res = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 10, bomId: bom.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reference: 'MO-000001', status: 'DRAFT', product: { name: 'Wooden Table' } });
    expect(res.body.components.map((c: { productName: string; toConsume: number }) => [c.productName, c.toConsume])).toEqual([
      ['Wooden Legs', 40],
      ['Wooden Top', 10],
      ['Screws', 120],
    ]);
    expect(res.body.workOrders.map((w: { name: string; expectedMinutes: number }) => [w.name, w.expectedMinutes])).toEqual([
      ['Assembly', 600],
      ['Painting', 300],
      ['Packing', 200],
    ]);
  });

  it('bom of another product → 400', async () => {
    const { agent, bom } = await setup();
    const chair = await makeProduct({ name: 'Chair' });
    const res = await agent.post('/api/manufacturing').send({ productId: chair.id, quantity: 1, bomId: bom.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BOM_PRODUCT_MISMATCH');
  });

  it('completing first work order → IN_PROGRESS, all → TO_CLOSE', async () => {
    const { agent, table, bom } = await setup();
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 1, bomId: bom.id });
    await agent.post(`/api/manufacturing/${mo.body.id}/confirm`);
    const [wo1, wo2, wo3] = mo.body.workOrders as { id: number }[];
    const r1 = await agent.post(`/api/manufacturing/${mo.body.id}/work-orders/${wo1!.id}/complete`).send({ realMinutes: 55 });
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('IN_PROGRESS');
    await agent.post(`/api/manufacturing/${mo.body.id}/work-orders/${wo2!.id}/complete`).send({ realMinutes: 30 });
    const r3 = await agent.post(`/api/manufacturing/${mo.body.id}/work-orders/${wo3!.id}/complete`).send({ realMinutes: 25 });
    expect(r3.body.status).toBe('TO_CLOSE');
    expect(r3.body.workOrders.map((w: { realMinutes: number }) => w.realMinutes)).toEqual([55, 30, 25]);
  });

  it('cannot complete work orders on a draft MO', async () => {
    const { agent, table, bom } = await setup();
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 1, bomId: bom.id });
    const res = await agent
      .post(`/api/manufacturing/${mo.body.id}/work-orders/${mo.body.workOrders[0].id}/complete`)
      .send({ realMinutes: 5 });
    expect(res.status).toBe(409);
  });

  it('confirmed MO reserves components', async () => {
    const { agent, table, bom, legs } = await setup();
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 10, bomId: bom.id });
    expect((await getLevels(prisma, [legs.id])).get(legs.id)?.reserved.toString()).toBe('0');
    await agent.post(`/api/manufacturing/${mo.body.id}/confirm`);
    expect((await getLevels(prisma, [legs.id])).get(legs.id)?.reserved.toString()).toBe('40');
  });

  it('editing the BoM after MO creation does not change the MO components or work orders', async () => {
    const { agent, table, bom, legs, user } = await setup();
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 2, bomId: bom.id });
    const bomAdmin = await agentFor(await makeUser({ access: { BOM: 'ADMIN' } }));
    const wc = await prisma.workCenter.findFirstOrThrow();
    const upd = await bomAdmin.patch(`/api/boms/${bom.id}`).send({
      productId: table.id,
      components: [{ productId: legs.id, quantity: 1 }],
      operations: [{ name: 'Quick', workCenterId: wc.id, durationMinutes: 5 }],
    });
    expect(upd.status).toBe(200);
    const after = await agent.get(`/api/manufacturing/${mo.body.id}`);
    expect(after.body.components).toHaveLength(3);
    expect(after.body.workOrders.map((w: { name: string }) => w.name)).toEqual(['Assembly', 'Painting', 'Packing']);
    expect(user.id).toBeGreaterThan(0);
  });

  it('confirmed MO quantity edit rescales components and expected minutes', async () => {
    const { agent, table, bom } = await setup();
    const mo = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 2, bomId: bom.id });
    await agent.post(`/api/manufacturing/${mo.body.id}/confirm`);
    const res = await agent.patch(`/api/manufacturing/${mo.body.id}`).send({ quantity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.components.map((c: { toConsume: number }) => c.toConsume)).toEqual([12, 3, 36]);
    expect(res.body.workOrders.map((w: { expectedMinutes: number }) => w.expectedMinutes)).toEqual([180, 90, 60]);
  });
});
