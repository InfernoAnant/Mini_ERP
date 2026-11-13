import { Prisma, type SalesStatus } from '../generated/prisma/client.js';
import { z } from 'zod';
import { assertCan, assertCanEdit } from '../config/permissions.js';
import { ZERO } from '../lib/decimal.js';
import { AppError, notFound } from '../lib/errors.js';
import { type ListQuery, type Paged, paging } from '../lib/listQuery.js';
import { type Db, type Tx, prisma, transaction } from '../lib/prisma.js';
import { userRefs } from '../lib/users.js';
import { type AuditBase, logAudit, logChanges, logStatus } from './audit.service.js';
import type { AuthUser } from './auth.service.js';
import { operationsForOrder, pendingQtyByLine, rejectPendingForOrder } from './operations.service.js';
import { lineInputSchema, planLineEdits, progressStatus } from './orderLines.js';
import { procureShortages } from './procurement.service.js';
import { salesProgress } from './progress.service.js';
import { invalidTransition } from './purchase.service.js';
import { nextRef } from './reference.service.js';
import { getLevels, lockProducts } from './stock.service.js';

export const salesInputSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  customerAddress: z.string().trim().max(300).nullable().optional(),
  salespersonId: z.coerce.number().int().positive().nullable().optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  lines: z.array(lineInputSchema).min(1, 'Add at least one product'),
});
export type SalesInput = z.infer<typeof salesInputSchema>;

/** Statuses in which a sales order reserves stock. */
export const SO_OPEN: SalesStatus[] = ['CONFIRMED', 'PARTIALLY_DELIVERED'];
const HEADER_FIELDS = ['customerId', 'customerAddress', 'salespersonId', 'scheduledDate'];

const include = {
  customer: { select: { id: true, name: true } },
  lines: { include: { product: { select: { name: true, unit: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.SalesOrderInclude;
type SoRow = Prisma.SalesOrderGetPayload<{ include: typeof include }>;

export function isSalesLate(so: { scheduledDate: Date | null; status: SalesStatus }): boolean {
  return !!so.scheduledDate && so.scheduledDate < new Date() && SO_OPEN.includes(so.status);
}

function base(user: AuthUser | null, so: { id: number; reference: string }): AuditBase {
  return { userId: user?.id ?? null, module: 'SALES', recordType: 'SalesOrder', recordId: so.id, reference: so.reference };
}

async function procurementsFor(db: Db, reference: string) {
  const [pos, mos] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { origin: reference },
      select: { id: true, reference: true, status: true },
      orderBy: { id: 'asc' },
    }),
    db.manufacturingOrder.findMany({
      where: { origin: reference },
      select: { id: true, reference: true, status: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  return [
    ...pos.map((p) => ({ id: p.id, reference: p.reference, type: 'PO' as const, status: p.status as string })),
    ...mos.map((m) => ({ id: m.id, reference: m.reference, type: 'MO' as const, status: m.status as string })),
  ];
}

async function toDto(db: Db, so: SoRow) {
  const [pending, levels, ref, procurements, operations] = await Promise.all([
    pendingQtyByLine(db, 'sales', so.id),
    getLevels(
      db,
      so.lines.map((l) => l.productId),
    ),
    userRefs(db, [so.salespersonId, so.createdById]),
    procurementsFor(db, so.reference),
    operationsForOrder(db, { salesOrderId: so.id }),
  ]);
  const reserving = SO_OPEN.includes(so.status);
  const lines = so.lines.map((l) => {
    const remaining = l.quantity.minus(l.deliveredQty);
    const free = levels.get(l.productId)?.free ?? ZERO;
    const usable = reserving ? free.plus(remaining) : free;
    return {
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      unit: l.product.unit,
      quantity: l.quantity,
      deliveredQty: l.deliveredQty,
      pendingQty: pending.get(l.id) ?? ZERO,
      unitPrice: l.unitPrice,
      total: (so.status === 'FULLY_DELIVERED' ? l.deliveredQty : l.quantity).times(l.unitPrice),
      available: usable.greaterThanOrEqualTo(remaining),
      freeToUse: free,
    };
  });
  return {
    id: so.id,
    reference: so.reference,
    customer: so.customer,
    customerAddress: so.customerAddress,
    salesperson: ref(so.salespersonId),
    createdBy: ref(so.createdById),
    createdById: so.createdById,
    scheduledDate: so.scheduledDate,
    status: so.status,
    createdAt: so.createdAt,
    confirmedAt: so.confirmedAt,
    lines,
    total: lines.reduce((sum, l) => sum.plus(l.total), ZERO),
    late: isSalesLate(so),
    procurements,
    operations,
    progress: salesProgress({
      status: so.status,
      lines: lines.map((l) => ({ quantity: l.quantity, deliveredQty: l.deliveredQty, available: l.available })),
      procurementStatuses: procurements.map((p) => p.status),
    }),
  };
}
export type SalesDTO = Awaited<ReturnType<typeof toDto>>;

async function load(db: Db, id: number): Promise<SoRow> {
  const so = await db.salesOrder.findUnique({ where: { id }, include });
  if (!so) throw notFound('Sales order');
  return so;
}

async function lock(tx: Tx, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id = ${id} FOR UPDATE`;
}

async function validateRefs(db: Db, input: SalesInput): Promise<void> {
  const customer = await db.contact.findUnique({ where: { id: input.customerId } });
  if (!customer || customer.type !== 'CUSTOMER') throw new AppError(400, 'VALIDATION_ERROR', 'customerId: Choose a customer');
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  if ((await db.product.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Unknown product on a line');
  }
  if (input.salespersonId && !(await db.user.findUnique({ where: { id: input.salespersonId } }))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'salespersonId: Unknown user');
  }
}

async function priceOf(db: Db, productIds: number[]): Promise<Map<number, Prisma.Decimal>> {
  const rows = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, salesPrice: true } });
  return new Map(rows.map((r) => [r.id, r.salesPrice]));
}

/** DTO without a permission check (journey, internal use). */
export async function salesDtoById(id: number, db: Db = prisma): Promise<SalesDTO> {
  return toDto(db, await load(db, id));
}

export async function getSales(user: AuthUser, id: number, db: Db = prisma): Promise<SalesDTO> {
  assertCan(user, 'SALES', 'view');
  return toDto(db, await load(db, id));
}

/** Creates a Draft SO (no permission check; used by createSales and seeding). */
export async function createDraftSalesTx(tx: Tx, user: AuthUser, input: SalesInput): Promise<{ id: number; reference: string }> {
  await validateRefs(tx, input);
  const prices = await priceOf(
    tx,
    input.lines.map((l) => l.productId),
  );
  const reference = await nextRef(tx, 'SO');
  const so = await tx.salesOrder.create({
    data: {
      reference,
      customerId: input.customerId,
      customerAddress: input.customerAddress ?? null,
      salespersonId: input.salespersonId ?? user.id,
      scheduledDate: input.scheduledDate ?? null,
      createdById: user.id,
      lines: {
        create: input.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.price ?? prices.get(l.productId) ?? 0,
        })),
      },
    },
  });
  await logAudit(tx, base(user, so), 'CREATE');
  return so;
}

export async function createSales(user: AuthUser, input: SalesInput): Promise<SalesDTO> {
  assertCan(user, 'SALES', 'create');
  return transaction(async (tx) => {
    const { id } = await createDraftSalesTx(tx, user, input);
    return toDto(tx, await load(tx, id));
  });
}

export async function updateSales(
  user: AuthUser,
  id: number,
  input: SalesInput,
): Promise<{ order: SalesDTO; procured: string[] }> {
  return transaction(async (tx) => {
    await lock(tx, id);
    const before = await load(tx, id);
    assertCanEdit(user, 'SALES', before);
    if (!['DRAFT', ...SO_OPEN].includes(before.status)) {
      throw new AppError(409, 'NOT_EDITABLE', `A ${before.status.toLowerCase().replace('_', ' ')} sales order can't be edited`);
    }
    await validateRefs(tx, input);
    const pending = await pendingQtyByLine(tx, 'sales', id);
    const plan = planLineEdits(
      before.lines.map((l) => ({ id: l.id, productId: l.productId, quantity: l.quantity, done: l.deliveredQty })),
      input.lines,
      pending,
      'delivered',
    );
    const open = SO_OPEN.includes(before.status);
    const increasedIds = plan.increases.map((i) => i.productId);
    if (open) await lockProducts(tx, increasedIds);
    const levelsBefore = open && increasedIds.length ? await getLevels(tx, increasedIds) : null;
    const prices = await priceOf(
      tx,
      input.lines.map((l) => l.productId),
    );
    if (plan.deletes.length) await tx.salesOrderLine.deleteMany({ where: { id: { in: plan.deletes } } });
    for (const u of plan.updates) {
      await tx.salesOrderLine.update({
        where: { id: u.id },
        data: { productId: u.productId, quantity: u.quantity, ...(u.price !== undefined ? { unitPrice: u.price } : {}) },
      });
    }
    if (plan.creates.length) {
      await tx.salesOrderLine.createMany({
        data: plan.creates.map((c) => ({
          orderId: id,
          productId: c.productId,
          quantity: c.quantity,
          unitPrice: c.price ?? prices.get(c.productId) ?? 0,
        })),
      });
    }
    const after = await tx.salesOrder.update({
      where: { id },
      data: {
        customerId: input.customerId,
        customerAddress: input.customerAddress ?? null,
        salespersonId: input.salespersonId !== undefined ? input.salespersonId : before.salespersonId,
        scheduledDate: input.scheduledDate ?? null,
      },
      include,
    });
    await logChanges(tx, base(user, before), before, after, HEADER_FIELDS);
    const summary = (rows: SoRow['lines']) =>
      rows.map((l) => `${l.quantity.toString()} × ${l.product.name} @ ${l.unitPrice.toString()}`).join(', ');
    await logChanges(tx, base(user, before), { lines: summary(before.lines) }, { lines: summary(after.lines) }, ['lines']);
    let procured: string[] = [];
    if (open) {
      const status = progressStatus(
        after.lines.map((l) => ({ quantity: l.quantity, done: l.deliveredQty })),
        'CONFIRMED' as SalesStatus,
        'PARTIALLY_DELIVERED' as SalesStatus,
        'FULLY_DELIVERED' as SalesStatus,
      );
      if (status !== before.status) {
        await tx.salesOrder.update({ where: { id }, data: { status } });
        await logStatus(tx, base(user, before), before.status, status, 'Quantities edited');
      }
      if (levelsBefore) {
        procured = await procureShortages(
          tx,
          user,
          before.reference,
          plan.increases.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            freeBefore: levelsBefore.get(i.productId)?.free ?? ZERO,
          })),
        );
      }
    }
    return { order: await toDto(tx, await load(tx, id)), procured };
  });
}

export async function confirmSales(user: AuthUser, id: number): Promise<{ order: SalesDTO; procured: string[] }> {
  assertCan(user, 'SALES', 'confirm');
  return transaction(async (tx) => {
    await lock(tx, id);
    const so = await load(tx, id);
    if (so.status !== 'DRAFT') throw invalidTransition('confirm', so.status);
    const productIds = so.lines.map((l) => l.productId);
    await lockProducts(tx, productIds);
    const levels = await getLevels(tx, productIds); // before this order reserves anything
    await tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await logStatus(tx, base(user, so), so.status, 'CONFIRMED');
    const procured = await procureShortages(
      tx,
      user,
      so.reference,
      so.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, freeBefore: levels.get(l.productId)?.free ?? ZERO })),
    );
    return { order: await toDto(tx, await load(tx, id)), procured };
  });
}

export async function cancelSales(user: AuthUser, id: number): Promise<SalesDTO> {
  assertCan(user, 'SALES', 'cancel');
  return transaction(async (tx) => {
    await lock(tx, id);
    const so = await load(tx, id);
    if (!['DRAFT', ...SO_OPEN].includes(so.status)) throw invalidTransition('cancel', so.status);
    await rejectPendingForOrder(tx, user, { salesOrderId: id });
    await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await logStatus(tx, base(user, so), so.status, 'CANCELLED');
    return toDto(tx, await load(tx, id));
  });
}

export async function deleteSales(user: AuthUser, id: number): Promise<void> {
  assertCan(user, 'SALES', 'delete');
  await transaction(async (tx) => {
    const so = await load(tx, id);
    if (so.status !== 'DRAFT') throw new AppError(409, 'NOT_EDITABLE', 'Only draft sales orders can be deleted');
    await tx.salesOrder.delete({ where: { id } });
    await logAudit(tx, base(user, so), 'DELETE');
  });
}

export const salesStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED', 'CANCELLED']);

export async function listSales(user: AuthUser, q: ListQuery): Promise<Paged<SalesDTO>> {
  assertCan(user, 'SALES', 'view');
  const status = q.status ? salesStatusSchema.parse(q.status) : undefined;
  const where: Prisma.SalesOrderWhereInput = {
    status: q.late ? { in: SO_OPEN } : status,
    scheduledDate: q.late ? { lt: new Date() } : undefined,
    OR: q.q
      ? [{ reference: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }]
      : undefined,
    AND: q.mine ? [{ OR: [{ salespersonId: user.id }, { createdById: user.id }] }] : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, include, orderBy: { id: 'desc' }, ...paging(q) }),
    prisma.salesOrder.count({ where }),
  ]);
  return { items: await Promise.all(rows.map((r) => toDto(prisma, r))), total, page: q.page, pageSize: q.pageSize };
}
