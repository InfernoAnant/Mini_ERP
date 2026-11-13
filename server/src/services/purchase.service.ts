import { Prisma, type PurchaseStatus } from '../generated/prisma/client.js';
import { z } from 'zod';
import { assertCan, assertCanEdit } from '../config/permissions.js';
import { ZERO } from '../lib/decimal.js';
import { AppError, notFound } from '../lib/errors.js';
import { type ListQuery, type Paged, paging } from '../lib/listQuery.js';
import { type Db, type Tx, prisma, transaction, sequential } from '../lib/prisma.js';
import { userRefs } from '../lib/users.js';
import { type AuditBase, logAudit, logChanges, logStatus } from './audit.service.js';
import type { AuthUser } from './auth.service.js';
import { operationsForOrder, pendingQtyByLine, rejectPendingForOrder } from './operations.service.js';
import { lineInputSchema, planLineEdits, progressStatus } from './orderLines.js';
import { purchaseProgress } from './progress.service.js';
import { nextRef } from './reference.service.js';

export const purchaseInputSchema = z.object({
  vendorId: z.coerce.number().int().positive(),
  vendorAddress: z.string().trim().max(300).nullable().optional(),
  responsibleId: z.coerce.number().int().positive().nullable().optional(),
  expectedDate: z.coerce.date().nullable().optional(),
  lines: z.array(lineInputSchema).min(1, 'Add at least one product'),
});
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

const OPEN: PurchaseStatus[] = ['CONFIRMED', 'PARTIALLY_RECEIVED'];
const HEADER_FIELDS = ['vendorId', 'vendorAddress', 'responsibleId', 'expectedDate'];

const include = {
  vendor: { select: { id: true, name: true } },
  lines: { include: { product: { select: { name: true, unit: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.PurchaseOrderInclude;
type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;

export function isPurchaseLate(po: { expectedDate: Date | null; status: PurchaseStatus }): boolean {
  return !!po.expectedDate && po.expectedDate < new Date() && OPEN.includes(po.status);
}

function base(user: AuthUser | null, po: { id: number; reference: string }): AuditBase {
  return { userId: user?.id ?? null, module: 'PURCHASE', recordType: 'PurchaseOrder', recordId: po.id, reference: po.reference };
}

async function toDto(db: Db, po: PoRow) {
  const [pending, ref, operations] = await sequential(
    () => pendingQtyByLine(db, 'purchase', po.id),
    () => userRefs(db, [po.responsibleId, po.createdById]),
    () => operationsForOrder(db, { purchaseOrderId: po.id }),
  );
  const lines = po.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    productName: l.product.name,
    unit: l.product.unit,
    quantity: l.quantity,
    receivedQty: l.receivedQty,
    pendingQty: pending.get(l.id) ?? ZERO,
    unitCost: l.unitCost,
    total: (po.status === 'FULLY_RECEIVED' ? l.receivedQty : l.quantity).times(l.unitCost),
  }));
  return {
    id: po.id,
    reference: po.reference,
    vendor: po.vendor,
    vendorAddress: po.vendorAddress,
    responsible: ref(po.responsibleId),
    createdBy: ref(po.createdById),
    createdById: po.createdById,
    expectedDate: po.expectedDate,
    status: po.status,
    origin: po.origin,
    createdAt: po.createdAt,
    lines,
    total: lines.reduce((sum, l) => sum.plus(l.total), ZERO),
    late: isPurchaseLate(po),
    operations,
    progress: purchaseProgress({ status: po.status, lines: po.lines }),
  };
}
export type PurchaseDTO = Awaited<ReturnType<typeof toDto>>;

async function load(db: Db, id: number): Promise<PoRow> {
  const po = await db.purchaseOrder.findUnique({ where: { id }, include });
  if (!po) throw notFound('Purchase order');
  return po;
}

async function lock(tx: Tx, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;
}

async function validateRefs(db: Db, input: PurchaseInput): Promise<void> {
  const vendor = await db.contact.findUnique({ where: { id: input.vendorId } });
  if (!vendor || vendor.type !== 'VENDOR') throw new AppError(400, 'VALIDATION_ERROR', 'vendorId: Choose a vendor');
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  if ((await db.product.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Unknown product on a line');
  }
}

async function costOf(db: Db, productIds: number[]): Promise<Map<number, Prisma.Decimal>> {
  const rows = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, costPrice: true } });
  return new Map(rows.map((r) => [r.id, r.costPrice]));
}

/** Creates a Draft PO without permission checks (used by procurement and seeding). */
export async function createDraftPurchaseTx(
  tx: Tx,
  user: AuthUser,
  input: PurchaseInput & { origin?: string },
): Promise<{ id: number; reference: string }> {
  await validateRefs(tx, input);
  const costs = await costOf(
    tx,
    input.lines.map((l) => l.productId),
  );
  const reference = await nextRef(tx, 'PO');
  const po = await tx.purchaseOrder.create({
    data: {
      reference,
      vendorId: input.vendorId,
      vendorAddress: input.vendorAddress ?? null,
      responsibleId: input.responsibleId ?? null,
      expectedDate: input.expectedDate ?? null,
      origin: input.origin ?? null,
      createdById: user.id,
      lines: {
        create: input.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.price ?? costs.get(l.productId) ?? 0,
        })),
      },
    },
  });
  await logAudit(tx, base(user, po), 'CREATE', { note: input.origin ? `Auto-procurement from ${input.origin}` : undefined });
  return po;
}

/** DTO without a permission check (journey, internal use). */
export async function purchaseDtoById(id: number, db: Db = prisma): Promise<PurchaseDTO> {
  return toDto(db, await load(db, id));
}

export async function getPurchase(user: AuthUser, id: number, db: Db = prisma): Promise<PurchaseDTO> {
  assertCan(user, 'PURCHASE', 'view');
  return toDto(db, await load(db, id));
}

export async function createPurchase(user: AuthUser, input: PurchaseInput): Promise<PurchaseDTO> {
  assertCan(user, 'PURCHASE', 'create');
  return transaction(async (tx) => {
    const { id } = await createDraftPurchaseTx(tx, user, input);
    return toDto(tx, await load(tx, id));
  });
}

export async function updatePurchase(user: AuthUser, id: number, input: PurchaseInput): Promise<PurchaseDTO> {
  return transaction(async (tx) => {
    await lock(tx, id);
    const before = await load(tx, id);
    assertCanEdit(user, 'PURCHASE', before);
    if (!['DRAFT', ...OPEN].includes(before.status)) {
      throw new AppError(
        409,
        'NOT_EDITABLE',
        `A ${before.status.toLowerCase().replace('_', ' ')} purchase order can't be edited`,
      );
    }
    await validateRefs(tx, input);
    const pending = await pendingQtyByLine(tx, 'purchase', id);
    const plan = planLineEdits(
      before.lines.map((l) => ({ id: l.id, productId: l.productId, quantity: l.quantity, done: l.receivedQty })),
      input.lines,
      pending,
      'received',
    );
    const costs = await costOf(
      tx,
      input.lines.map((l) => l.productId),
    );
    if (plan.deletes.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: plan.deletes } } });
    for (const u of plan.updates) {
      await tx.purchaseOrderLine.update({
        where: { id: u.id },
        data: { productId: u.productId, quantity: u.quantity, ...(u.price !== undefined ? { unitCost: u.price } : {}) },
      });
    }
    if (plan.creates.length) {
      await tx.purchaseOrderLine.createMany({
        data: plan.creates.map((c) => ({
          orderId: id,
          productId: c.productId,
          quantity: c.quantity,
          unitCost: c.price ?? costs.get(c.productId) ?? 0,
        })),
      });
    }
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: {
        vendorId: input.vendorId,
        vendorAddress: input.vendorAddress ?? null,
        responsibleId: input.responsibleId ?? null,
        expectedDate: input.expectedDate ?? null,
      },
      include,
    });
    await logChanges(tx, base(user, before), before, after, HEADER_FIELDS);
    const summary = (rows: PoRow['lines']) =>
      rows.map((l) => `${l.quantity.toString()} × ${l.product.name} @ ${l.unitCost.toString()}`).join(', ');
    await logChanges(tx, base(user, before), { lines: summary(before.lines) }, { lines: summary(after.lines) }, ['lines']);
    if (OPEN.includes(before.status)) {
      const status = progressStatus(
        after.lines.map((l) => ({ quantity: l.quantity, done: l.receivedQty })),
        'CONFIRMED' as PurchaseStatus,
        'PARTIALLY_RECEIVED' as PurchaseStatus,
        'FULLY_RECEIVED' as PurchaseStatus,
      );
      if (status !== before.status) {
        await tx.purchaseOrder.update({ where: { id }, data: { status } });
        await logStatus(tx, base(user, before), before.status, status, 'Quantities edited');
      }
    }
    return toDto(tx, await load(tx, id));
  });
}

export async function confirmPurchase(user: AuthUser, id: number): Promise<{ order: PurchaseDTO; procured: string[] }> {
  assertCan(user, 'PURCHASE', 'confirm');
  return transaction(async (tx) => {
    await lock(tx, id);
    const po = await load(tx, id);
    if (po.status !== 'DRAFT') throw invalidTransition('confirm', po.status);
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CONFIRMED' } });
    await logStatus(tx, base(user, po), po.status, 'CONFIRMED');
    return { order: await toDto(tx, await load(tx, id)), procured: [] };
  });
}

export async function cancelPurchase(user: AuthUser, id: number): Promise<PurchaseDTO> {
  assertCan(user, 'PURCHASE', 'cancel');
  return transaction(async (tx) => {
    await lock(tx, id);
    const po = await load(tx, id);
    if (!['DRAFT', ...OPEN].includes(po.status)) throw invalidTransition('cancel', po.status);
    await rejectPendingForOrder(tx, user, { purchaseOrderId: id });
    await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await logStatus(tx, base(user, po), po.status, 'CANCELLED');
    return toDto(tx, await load(tx, id));
  });
}

export async function deletePurchase(user: AuthUser, id: number): Promise<void> {
  assertCan(user, 'PURCHASE', 'delete');
  await transaction(async (tx) => {
    const po = await load(tx, id);
    if (po.status !== 'DRAFT') throw new AppError(409, 'NOT_EDITABLE', 'Only draft purchase orders can be deleted');
    await tx.purchaseOrder.delete({ where: { id } });
    await logAudit(tx, base(user, po), 'DELETE');
  });
}

export function invalidTransition(action: string, status: string): AppError {
  return new AppError(
    409,
    'INVALID_TRANSITION',
    `Cannot ${action} an order in status ${status.toLowerCase().replace(/_/g, ' ')}`,
  );
}

export const purchaseStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED']);

export async function listPurchases(user: AuthUser, q: ListQuery): Promise<Paged<PurchaseDTO>> {
  assertCan(user, 'PURCHASE', 'view');
  const status = q.status ? purchaseStatusSchema.parse(q.status) : undefined;
  const where: Prisma.PurchaseOrderWhereInput = {
    status: q.late ? { in: OPEN } : status,
    expectedDate: q.late ? { lt: new Date() } : undefined,
    OR: q.q
      ? [{ reference: { contains: q.q, mode: 'insensitive' } }, { vendor: { name: { contains: q.q, mode: 'insensitive' } } }]
      : undefined,
    AND: q.mine ? [{ OR: [{ responsibleId: user.id }, { createdById: user.id }] }] : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include, orderBy: { id: 'desc' }, ...paging(q) }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { items: await Promise.all(rows.map((r) => toDto(prisma, r))), total, page: q.page, pageSize: q.pageSize };
}
