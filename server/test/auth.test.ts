import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { agentFor, app, makeUser, resetDb } from './helpers';

const valid = { loginId: 'newuser1', email: 'new@test.local', password: 'Strong@123', name: 'New User' };

describe('auth', () => {
  beforeEach(resetDb);

  it('signup creates user with no module access', async () => {
    const agent = request.agent(app());
    const res = await agent.post('/api/auth/signup').send(valid);
    expect(res.status).toBe(201);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.access.SALES).toBe('NONE');
    expect(me.body.user.loginId).toBe('newuser1');
  });

  it("signup rejects loginId 'abc'", async () => {
    const res = await request(app()).post('/api/auth/signup').send({ ...valid, loginId: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("signup rejects weak password 'password'", async () => {
    const res = await request(app()).post('/api/auth/signup').send({ ...valid, password: 'password' });
    expect(res.status).toBe(400);
  });

  it('signup rejects duplicate email', async () => {
    await request(app()).post('/api/auth/signup').send(valid);
    const res = await request(app()).post('/api/auth/signup').send({ ...valid, loginId: 'other123' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/email/i);
  });

  it('login sets httpOnly token cookie', async () => {
    const user = await makeUser();
    const res = await request(app()).post('/api/auth/login').send({ loginId: user.loginId, password: 'Test@1234' });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/token=.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('login with wrong password', async () => {
    const user = await makeUser();
    const res = await request(app()).post('/api/auth/login').send({ loginId: user.loginId, password: 'Wrong@123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('me without cookie', async () => {
    const res = await request(app()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('me with garbage cookie', async () => {
    const res = await request(app()).get('/api/auth/me').set('Cookie', 'token=garbage');
    expect(res.status).toBe(401);
  });

  it('demo-login works only for demo-locked users', async () => {
    const demo = await makeUser({ isDemoLocked: true });
    const normal = await makeUser();
    const ok = await request(app()).post('/api/auth/demo-login').send({ loginId: demo.loginId });
    expect(ok.status).toBe(200);
    const no = await request(app()).post('/api/auth/demo-login').send({ loginId: normal.loginId });
    expect(no.status).toBe(403);
  });

  it('logout clears cookie', async () => {
    const agent = await agentFor(await makeUser());
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('system admin gets ADMIN on every module', async () => {
    const agent = await agentFor(await makeUser({ isSystemAdmin: true }));
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.access).toEqual({ SALES: 'ADMIN', PURCHASE: 'ADMIN', MANUFACTURING: 'ADMIN', BOM: 'ADMIN', PRODUCTS: 'ADMIN' });
  });
});
