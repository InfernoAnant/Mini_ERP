import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { agentFor, makeContact, makeProduct, makeUser, resetDb } from './helpers';

describe('users administration', () => {
  beforeEach(resetDb);

  it('admin sets SALES to ADMIN and the user can then confirm', async () => {
    const admin = await agentFor(await makeUser({ isSystemAdmin: true }));
    const target = await makeUser({ access: { SALES: 'USER' } });
    const res = await admin.put(`/api/users/${target.id}/access`).send({ SALES: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.access.SALES).toBe('ADMIN');
    const agent = await agentFor(target);
    const customer = await makeContact('CUSTOMER');
    const chair = await makeProduct({ onHand: 5 });
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 1 }] });
    expect((await agent.post(`/api/sales/${so.body.id}/confirm`)).status).toBe(200);
  });

  it('non-admin GET /users → 403', async () => {
    const agent = await agentFor(await makeUser({ access: { SALES: 'ADMIN' } }));
    expect((await agent.get('/api/users')).status).toBe(403);
  });

  it('user can edit own profile but not position or email', async () => {
    const user = await makeUser({ access: { SALES: 'USER' } });
    const agent = await agentFor(user);
    const res = await agent
      .patch('/api/users/me')
      .send({ name: 'Amit Sharma', mobile: '+91 98000 00000', position: 'CEO', email: 'x@y.z' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Amit Sharma', mobile: '+91 98000 00000', position: null, email: user.email });
  });

  it('admin can change position; demo-locked access change → 409 DEMO_LOCKED', async () => {
    const admin = await agentFor(await makeUser({ isSystemAdmin: true }));
    const user = await makeUser();
    const pos = await admin.patch(`/api/users/${user.id}`).send({ position: 'Sales Manager' });
    expect(pos.body.position).toBe('Sales Manager');
    const demo = await makeUser({ isDemoLocked: true });
    const res = await admin.put(`/api/users/${demo.id}/access`).send({ SALES: 'NONE' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEMO_LOCKED');
    expect((await admin.patch(`/api/users/${demo.id}`).send({ readOnly: true })).status).toBe(409);
  });

  it('access change writes audit row with old and new level', async () => {
    const admin = await agentFor(await makeUser({ isSystemAdmin: true }));
    const user = await makeUser({ access: { PURCHASE: 'USER' } });
    await admin.put(`/api/users/${user.id}/access`).send({ PURCHASE: 'ADMIN', BOM: 'USER' });
    const rows = await prisma.auditLog.findMany({ where: { module: 'USERS', recordId: user.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue])).toEqual([
      ['access.PURCHASE', 'USER', 'ADMIN'],
      ['access.BOM', 'NONE', 'USER'],
    ]);
  });

  it('list and get users with access', async () => {
    const admin = await agentFor(await makeUser({ isSystemAdmin: true, name: 'Admin' }));
    const user = await makeUser({ name: 'Neha Verma', access: { PURCHASE: 'ADMIN' } });
    const list = await admin.get('/api/users');
    expect(list.body.items.map((u: { name: string }) => u.name)).toEqual(['Admin', 'Neha Verma']);
    const one = await admin.get(`/api/users/${user.id}`);
    expect(one.body.access.PURCHASE).toBe('ADMIN');
    expect(one.body.passwordHash).toBeUndefined();
  });

  it('user options list is available to any logged-in user (for assignee dropdowns)', async () => {
    const agent = await agentFor(await makeUser({ access: { SALES: 'USER' } }));
    const res = await agent.get('/api/users/options');
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ id: expect.any(Number), name: expect.any(String) });
  });
});
