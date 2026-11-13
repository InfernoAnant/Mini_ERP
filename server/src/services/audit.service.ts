import { type AuditAction, type AuditModule, Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { paging } from '../lib/listQuery.js';
import { type Db, type Tx, prisma } from '../lib/prisma.js';

export type AuditBase = {
  userId: number | null;
  module: AuditModule;
  recordType: string;
  recordId: number;
  reference?: string | null;
};

export function auditValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

type DecimalInput = string | number | Prisma.Decimal;

function sameValue(a: unknown, b: unknown): boolean {
  if (Prisma.Decimal.isDecimal(a) || Prisma.Decimal.isDecimal(b)) {
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    return new Prisma.Decimal(a as DecimalInput).equals(new Prisma.Decimal(b as DecimalInput));
  }
  return auditValue(a) === auditValue(b);
}

export async function logAudit(
  tx: Tx,
  base: AuditBase,
  action: AuditAction,
  extra: { field?: string; oldValue?: unknown; newValue?: unknown; note?: string } = {},
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: base.userId,
      module: base.module,
      recordType: base.recordType,
      recordId: base.recordId,
      reference: base.reference ?? null,
      action,
      field: extra.field ?? null,
      oldValue: auditValue(extra.oldValue),
      newValue: auditValue(extra.newValue),
      note: extra.note ?? null,
    },
  });
}

/** One UPDATE row per changed field. Decimals compare by value. */
export async function logChanges(
  tx: Tx,
  base: AuditBase,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Promise<number> {
  const changed = fields.filter((f) => f in after && !sameValue(before[f], after[f]));
  if (changed.length === 0) return 0;
  await tx.auditLog.createMany({
    data: changed.map((f) => ({
      userId: base.userId,
      module: base.module,
      recordType: base.recordType,
      recordId: base.recordId,
      reference: base.reference ?? null,
      action: 'UPDATE' as const,
      field: f,
      oldValue: auditValue(before[f]),
      newValue: auditValue(after[f]),
    })),
  });
  return changed.length;
}

export async function logStatus(tx: Tx, base: AuditBase, from: string, to: string, note?: string): Promise<void> {
  await logAudit(tx, base, 'STATUS_CHANGE', { field: 'status', oldValue: from, newValue: to, note });
}

export const auditQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.coerce.number().int().optional(),
  module: z.enum(['SALES', 'PURCHASE', 'MANUFACTURING', 'BOM', 'PRODUCTS', 'STOCK', 'USERS']).optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE']).optional(),
  recordId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export async function listAudit(q: AuditQuery, db: Db = prisma) {
  const where: Prisma.AuditLogWhereInput = {
    module: q.module,
    userId: q.userId,
    recordId: q.recordId,
    createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
  };
  const [rows, total, grouped] = await Promise.all([
    db.auditLog.findMany({ where: { ...where, action: q.action }, orderBy: { id: 'desc' }, ...paging(q) }),
    db.auditLog.count({ where: { ...where, action: q.action } }),
    db.auditLog.groupBy({ by: ['action'], where, _count: { _all: true } }),
  ]);
  const count = (a: AuditAction) => grouped.find((g) => g.action === a)?._count._all ?? 0;
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r) => ({ ...r, user: r.userId ? { id: r.userId, name: nameOf.get(r.userId) ?? 'Unknown' } : null })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    summary: {
      total: count('CREATE') + count('UPDATE') + count('STATUS_CHANGE') + count('DELETE'),
      created: count('CREATE'),
      updated: count('UPDATE') + count('STATUS_CHANGE'),
      deleted: count('DELETE'),
    },
  };
}
