import { beforeEach, describe, expect, it } from 'vitest';
import { dec } from '../src/lib/decimal.js';
import { prisma } from '../src/lib/prisma.js';
import { logAudit, logChanges, logStatus } from '../src/services/audit.service.js';
import { nextRef } from '../src/services/reference.service.js';
import { agentFor, makeUser, resetDb } from './helpers.js';

const base = { userId: null, module: 'PRODUCTS' as const, recordType: 'Product', recordId: 7, reference: 'Table' };

describe('audit and references', () => {
  beforeEach(resetDb);

  it('logChanges writes one row per changed field and ignores 2.50 vs 2.5', async () => {
    const written = await prisma.$transaction((tx) =>
      logChanges(
        tx,
        base,
        { salesPrice: dec('2.50'), costPrice: dec(1), name: 'Table' },
        { salesPrice: dec('2.5'), costPrice: dec(3), name: 'Big Table' },
        ['salesPrice', 'costPrice', 'name'],
      ),
    );
    expect(written).toBe(2);
    const rows = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue, r.action])).toEqual([
      ['costPrice', '1', '3', 'UPDATE'],
      ['name', 'Table', 'Big Table', 'UPDATE'],
    ]);
  });

  it('nextRef returns SO-000001 then SO-000002 and PO-000001 independently', async () => {
    const refs = await prisma.$transaction(async (tx) => [
      await nextRef(tx, 'SO'),
      await nextRef(tx, 'SO'),
      await nextRef(tx, 'PO'),
    ]);
    expect(refs).toEqual(['SO-000001', 'SO-000002', 'PO-000001']);
  });

  it('nextRef is unique under 20 concurrent calls', async () => {
    const refs = await Promise.all(Array.from({ length: 20 }, () => prisma.$transaction((tx) => nextRef(tx, 'MO'))));
    expect(new Set(refs).size).toBe(20);
  });

  it('GET /audit as non-admin → 403', async () => {
    const agent = await agentFor(await makeUser({ access: { SALES: 'ADMIN' } }));
    const res = await agent.get('/api/audit');
    expect(res.status).toBe(403);
  });

  it('GET /audit?module=SALES returns only sales rows and summary counts', async () => {
    await prisma.$transaction(async (tx) => {
      await logAudit(tx, { ...base, module: 'SALES', recordType: 'SalesOrder' }, 'CREATE');
      await logStatus(tx, { ...base, module: 'SALES', recordType: 'SalesOrder' }, 'DRAFT', 'CONFIRMED');
      await logAudit(tx, base, 'DELETE');
    });
    const admin = await makeUser({ isSystemAdmin: true, name: 'Boss' });
    const agent = await agentFor(admin);
    const res = await agent.get('/api/audit').query({ module: 'SALES' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((i: { module: string }) => i.module === 'SALES')).toBe(true);
    expect(res.body.summary).toEqual({ total: 2, created: 1, updated: 1, deleted: 0 });
    const status = res.body.items.find((i: { action: string }) => i.action === 'STATUS_CHANGE');
    expect(status).toMatchObject({ field: 'status', oldValue: 'DRAFT', newValue: 'CONFIRMED' });
  });
});
