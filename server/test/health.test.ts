import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers';

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('unknown route returns NOT_FOUND error shape', async () => {
    const res = await request(app()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
