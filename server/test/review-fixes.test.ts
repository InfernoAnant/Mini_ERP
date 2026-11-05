import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { __resetThrottleForTests, resetDemo } from '../src/services/demo.service';
import { agentFor, app, makeContact, makeProduct, makeUser, resetDb, tableWithBom } from './helpers';

const signupBody = (loginId: string) => ({ loginId, email: `${loginId}@example.test`, password: 'Strong@123', name: loginId });

describe('final review fixes', () => {
  beforeEach(resetDb);

  it('a session from before a demo reset cannot act as a newer account that reused the id', async () => {
    __resetThrottleForTests();
    await resetDemo();
    const old = request.agent(app());
    expect((await old.post('/api/auth/signup').send(signupBody('olduser1'))).status).toBe(201);
    await new Promise((r) => setTimeout(r, 1100)); // tokens have 1 s resolution
    __resetThrottleForTests();
    await resetDemo();
    expect((await request(app()).post('/api/auth/signup').send(signupBody('newuser1'))).status).toBe(201);
    const me = await old.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('demo accounts keep working across a reset', async () => {
    __resetThrottleForTests();
    await resetDemo();
    const demo = request.agent(app());
    await demo.post('/api/auth/demo-login').send({ loginId: 'salesuser' });
    await new Promise((r) => setTimeout(r, 1100));
    __resetThrottleForTests();
    await resetDemo();
    expect((await demo.get('/api/auth/me')).status).toBe(200);
  });

  it('two MO confirms at once still procure the full component shortage', async () => {
    const mfg = await makeUser({ access: { MANUFACTURING: 'ADMIN' } });
    const agent = await agentFor(mfg);
    const { table, legs, bom } = await tableWithBom(mfg.id);
    const vendor = await makeContact('VENDOR');
    await prisma.product.update({ where: { id: legs.id }, data: { procureOnDemand: true, procurementType: 'PURCHASE', vendorId: vendor.id } });
    // legs on hand 100; each MO of 20 tables needs 80 → total 160, shortage 60
    const a = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 20, bomId: bom.id });
    const b = await agent.post('/api/manufacturing').send({ productId: table.id, quantity: 20, bomId: bom.id });
    await Promise.all([agent.post(`/api/manufacturing/${a.body.id}/confirm`), agent.post(`/api/manufacturing/${b.body.id}/confirm`)]);
    const lines = await prisma.purchaseOrderLine.findMany({ where: { productId: legs.id } });
    expect(lines.reduce((s, l) => s + l.quantity.toNumber(), 0)).toBe(60);
  });

  it("changing the product of a BoM that is in use → 409 IN_USE", async () => {
    const admin = await makeUser({ access: { BOM: 'ADMIN' } });
    const { table, legs, bom } = await tableWithBom(admin.id);
    await prisma.product.update({ where: { id: table.id }, data: { procureOnDemand: true, procurementType: 'MANUFACTURING', defaultBomId: bom.id } });
    const chair = await makeProduct({ name: 'Chair' });
    const wc = await prisma.workCenter.findFirstOrThrow();
    const res = await (await agentFor(admin)).patch(`/api/boms/${bom.id}`).send({
      productId: chair.id,
      components: [{ productId: legs.id, quantity: 1 }],
      operations: [{ name: 'Assembly', workCenterId: wc.id, durationMinutes: 10 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('a new make-to-order manufactured product can be created before its BoM exists', async () => {
    const agent = await agentFor(await makeUser({ access: { PRODUCTS: 'ADMIN' } }));
    const res = await agent.post('/api/products').send({ name: 'Sofa', salesPrice: 1, costPrice: 1, procureOnDemand: true, procurementType: 'MANUFACTURING' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ procureOnDemand: true, procurementType: 'MANUFACTURING', defaultBom: null });
  });

  it('a user with no module access cannot read dropdown data', async () => {
    const none = await agentFor(await makeUser());
    for (const path of ['/api/products/options', '/api/contacts', '/api/boms/options', '/api/users/options', '/api/work-centers']) {
      expect((await none.get(path)).status, path).toBe(403);
    }
    const sales = await agentFor(await makeUser({ access: { SALES: 'USER' } }));
    expect((await sales.get('/api/products/options')).status).toBe(200);
  });

  it("the shared demo admin can't see real sign-ups' personal details", async () => {
    const demoAdmin = await agentFor(await makeUser({ isSystemAdmin: true, isDemoLocked: true }));
    const signup = await makeUser({ name: 'Real Person' });
    await prisma.user.update({ where: { id: signup.id }, data: { mobile: '+91 99999 00000', address: 'Home' } });
    const one = await demoAdmin.get(`/api/users/${signup.id}`);
    expect(one.body).toMatchObject({ name: 'Real Person', mobile: null, address: null });
    expect(one.body.email).not.toBe(signup.email);
    const list = await demoAdmin.get('/api/users');
    expect(JSON.stringify(list.body)).not.toContain(signup.email);
    const realAdmin = await agentFor(await makeUser({ isSystemAdmin: true }));
    expect((await realAdmin.get(`/api/users/${signup.id}`)).body.mobile).toBe('+91 99999 00000');
  });
});
