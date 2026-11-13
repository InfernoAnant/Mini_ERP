import { beforeEach, describe, expect, it } from 'vitest';
import { dec } from '../src/lib/decimal';
import { moProgress, purchaseProgress, salesProgress } from '../src/services/progress.service';
import { agentFor, makeContact, makeProduct, makeUser, resetDb } from './helpers';

const line = (q: number | string, delivered: number | string, available = true) => ({
  quantity: dec(q),
  deliveredQty: dec(delivered),
  available,
});

describe('progress rules', () => {
  it('sales draft → level 1, 25%, stage Draft', () => {
    expect(salesProgress({ status: 'DRAFT', lines: [line(10, 0)], procurementStatuses: [] })).toMatchObject({
      level: 1,
      percent: 25,
      stage: 'Draft',
      complete: false,
      cancelled: false,
    });
  });
  it('sales confirmed with a short line → level 2, 50%', () => {
    expect(salesProgress({ status: 'CONFIRMED', lines: [line(10, 0, false)], procurementStatuses: [] })).toMatchObject({
      level: 2,
      percent: 50,
      stage: 'Confirmed',
    });
  });
  it('sales confirmed, all lines available → level 3, 75%, stage Supplied', () => {
    expect(salesProgress({ status: 'CONFIRMED', lines: [line(10, 0)], procurementStatuses: [] })).toMatchObject({
      level: 3,
      percent: 75,
      stage: 'Supplied',
    });
  });
  it('sales confirmed, short but all procurements done → level 3', () => {
    expect(
      salesProgress({ status: 'CONFIRMED', lines: [line(10, 0, false)], procurementStatuses: ['DONE', 'FULLY_RECEIVED'] }),
    ).toMatchObject({ level: 3, percent: 75 });
    expect(
      salesProgress({ status: 'CONFIRMED', lines: [line(10, 0, false)], procurementStatuses: ['DONE', 'CONFIRMED'] }),
    ).toMatchObject({ level: 2 });
  });
  it('sales partially delivered 6 of 10 → level 4, 90%', () => {
    expect(salesProgress({ status: 'PARTIALLY_DELIVERED', lines: [line(10, 6)], procurementStatuses: [] })).toMatchObject({
      level: 4,
      percent: 90,
      stage: 'Delivered',
      complete: false,
    });
  });
  it('sales delivered 6.5 of 10 → 91% (integer)', () => {
    expect(salesProgress({ status: 'PARTIALLY_DELIVERED', lines: [line(10, '6.5')], procurementStatuses: [] }).percent).toBe(91);
  });
  it('sales delivered 199 of 200 → 99%, not complete', () => {
    expect(salesProgress({ status: 'PARTIALLY_DELIVERED', lines: [line(200, 199)], procurementStatuses: [] })).toMatchObject({
      percent: 99,
      complete: false,
    });
  });
  it('sales fully delivered → 100%, complete', () => {
    expect(salesProgress({ status: 'FULLY_DELIVERED', lines: [line(10, 10)], procurementStatuses: [] })).toMatchObject({
      level: 4,
      percent: 100,
      complete: true,
    });
  });
  it('sales cancelled → level 0, cancelled, stage Cancelled', () => {
    expect(salesProgress({ status: 'CANCELLED', lines: [line(10, 0)], procurementStatuses: [] })).toMatchObject({
      level: 0,
      percent: 0,
      stage: 'Cancelled',
      cancelled: true,
    });
  });
  it('purchase partially received 5 of 12 → level 3, 60%; fully received → 100 complete', () => {
    const l = (r: number) => [{ quantity: dec(12), receivedQty: dec(r) }];
    expect(purchaseProgress({ status: 'PARTIALLY_RECEIVED', lines: l(5) })).toMatchObject({
      level: 3,
      percent: 60,
      stage: 'Receiving',
    });
    expect(purchaseProgress({ status: 'FULLY_RECEIVED', lines: l(12) })).toMatchObject({
      level: 4,
      percent: 100,
      complete: true,
      stage: 'Received',
    });
    expect(purchaseProgress({ status: 'CONFIRMED', lines: l(0) })).toMatchObject({ level: 2, percent: 50 });
  });
  it('mo work-order fill, to close, done', () => {
    const wo = (done: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({ status: (i < done ? 'DONE' : 'PENDING') as 'DONE' | 'PENDING' }));
    expect(moProgress({ status: 'IN_PROGRESS', workOrders: wo(2, 3) })).toMatchObject({
      level: 3,
      percent: 67,
      stage: 'In production',
    });
    expect(moProgress({ status: 'TO_CLOSE', workOrders: wo(3, 3) })).toMatchObject({ level: 3, percent: 75 });
    expect(moProgress({ status: 'DONE', workOrders: wo(3, 3) })).toMatchObject({
      level: 4,
      percent: 100,
      complete: true,
      stage: 'Done',
    });
  });
  it('mo in progress with zero work orders → 63%', () => {
    expect(moProgress({ status: 'IN_PROGRESS', workOrders: [] }).percent).toBe(63);
  });
});

describe('progress on order DTOs', () => {
  beforeEach(resetDb);

  it('GET /api/sales/:id returns progress; list items include progress', async () => {
    const agent = await agentFor(await makeUser({ access: { SALES: 'ADMIN' } }));
    const customer = await makeContact('CUSTOMER');
    const chair = await makeProduct({ onHand: 50 });
    const so = await agent.post('/api/sales').send({ customerId: customer.id, lines: [{ productId: chair.id, quantity: 5 }] });
    expect(so.body.progress).toMatchObject({ level: 1, percent: 25 });
    await agent.post(`/api/sales/${so.body.id}/confirm`);
    expect((await agent.get(`/api/sales/${so.body.id}`)).body.progress).toMatchObject({ level: 3, percent: 75 });
    expect((await agent.get('/api/sales')).body.items[0].progress.level).toBe(3);
  });
});
