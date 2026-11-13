import { type OperationStatus, type OperationType, Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { can, canConfirmOperation, canPlaceOperation, operationModule } from '../config/permissions.js';
import { dec, ZERO } from '../lib/decimal.js';
import { AppError, notFound } from '../lib/errors.js';
import { paging } from '../lib/listQuery.js';
import { type Db, type Tx, prisma, transaction, sequential } from '../lib/prisma.js';
import { userRefs } from '../lib/users.js';
import { type AuditBase, logAudit, logStatus } from './audit.service.js';
import type { AuthUser } from './auth.service.js';
import { progressStatus } from './orderLines.js';
import { nextRef } from './reference.service.js';
import { postMoves } from './stock.service.js';

export type OrderRef = { salesOrderId?: number; purchaseOrderId?: number; manufacturingOrderId?: number };

const qty = z.coerce.number().positive('Quantity must be more than 0').max(1e7);
export const placeOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DELIVERY'),
    salesOrderId: z.coerce.number().int().positive(),
    lines: z.array(z.object({ salesOrderLineId: z.coerce.number().int().positive(), quantity: qty })).min(1),
  }),
  z.object({
    type: z.literal('RECEIPT'),
    purchaseOrderId: z.coerce.number().int().positive(),
    lines: z.array(z.object({ purchaseOrderLineId: z.coerce.number().int().positive(), quantity: qty })).min(1),
  }),
  z.object({ type: z.literal('PRODUCTION'), manufacturingOrderId: z.coerce.number().int().positive() }),
  z.object({
    type: z.literal('ADJUSTMENT'),
    productId: z.coerce.number().int().positive(),
    targetQty: z.coerce.number().min(0).max(1e9),
    reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(300),
  }),
]);
export type PlaceOperationInput = z.infer<typeof placeOperationSchema>;

const include = {
  lines: { include: { product: { select: { name: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.StockOperationInclude;
type OpRow = Prisma.StockOperationGetPayload<{ include: typeof include }>;

// ---------- DTO ----------

async function toDtos(db: Db, ops: OpRow[]) {
  const ids = (key: 'salesOrderId' | 'purchaseOrderId' | 'manufacturingOrderId' | 'productId') => [
    ...new Set(ops.map((o) => o[key]).filter((v): v is number => v !== null)),
  ];
  const [sos, pos, mos, products, ref] = await sequential(
    () => db.salesOrder.findMany({ where: { id: { in: ids('salesOrderId') } }, select: { id: true, reference: true } }),
    () => db.purchaseOrder.findMany({ where: { id: { in: ids('purchaseOrderId') } }, select: { id: true, reference: true } }),
    () =>
      db.manufacturingOrder.findMany({
        where: { id: { in: ids('manufacturingOrderId') } },
        select: { id: true, reference: true },
      }),
    () => db.product.findMany({ where: { id: { in: ids('productId') } }, select: { id: true, name: true, onHand: true } }),
    () =>
      userRefs(
        db,
        ops.flatMap((o) => [o.placedById, o.decidedById]),
      ),
  );
  const refOf = (list: { id: number; reference: string }[], id: number | null) => list.find((x) => x.id === id)?.reference ?? '';
  return ops.map((o) => {
    const product = products.find((p) => p.id === o.productId);
    const source =
      o.salesOrderId !== null
        ? { kind: 'SO' as const, id: o.salesOrderId, reference: refOf(sos, o.salesOrderId) }
        : o.purchaseOrderId !== null
          ? { kind: 'PO' as const, id: o.purchaseOrderId, reference: refOf(pos, o.purchaseOrderId) }
          : o.manufacturingOrderId !== null
            ? { kind: 'MO' as const, id: o.manufacturingOrderId, reference: refOf(mos, o.manufacturingOrderId) }
            : { kind: 'PRODUCT' as const, id: o.productId ?? 0, reference: product?.name ?? '' };
    return {
      id: o.id,
      reference: o.reference,
      type: o.type,
      status: o.status,
      source,
      lines:
        o.type === 'ADJUSTMENT'
          ? [{ productId: o.productId ?? 0, productName: product?.name ?? '', quantity: o.targetQty ?? ZERO }]
          : o.lines.map((l) => ({ productId: l.productId, productName: l.product.name, quantity: l.quantity })),
      targetQty: o.targetQty,
      reason: o.reason,
      placedBy: ref(o.placedById),
      placedAt: o.placedAt,
      decidedBy: ref(o.decidedById),
      decidedAt: o.decidedAt,
      rejectReason: o.rejectReason,
    };
  });
}
export type OperationDTO = Awaited<ReturnType<typeof toDtos>>[number];

async function loadDto(db: Db, id: number): Promise<OperationDTO> {
  const op = await db.stockOperation.findUnique({ where: { id }, include });
  if (!op) throw notFound('Stock operation');
  const [dto] = await toDtos(db, [op]);
  return dto!;
}

// ---------- queries used by order services ----------

export async function pendingQtyByLine(
  db: Db,
  kind: 'sales' | 'purchase',
  orderId: number,
): Promise<Map<number, Prisma.Decimal>> {
  const lines = await db.stockOperationLine.findMany({
    where: {
      operation: { status: 'PLACED', ...(kind === 'sales' ? { salesOrderId: orderId } : { purchaseOrderId: orderId }) },
    },
  });
  const result = new Map<number, Prisma.Decimal>();
  for (const l of lines) {
    const lineId = kind === 'sales' ? l.salesOrderLineId : l.purchaseOrderLineId;
    if (lineId !== null) result.set(lineId, (result.get(lineId) ?? ZERO).plus(l.quantity));
  }
  return result;
}

export async function hasPendingOperation(db: Db, ref: OrderRef): Promise<boolean> {
  return (await db.stockOperation.count({ where: { ...ref, status: 'PLACED' } })) > 0;
}

export async function operationsForOrder(db: Db, ref: OrderRef): Promise<OperationDTO[]> {
  const ops = await db.stockOperation.findMany({ where: ref, include, orderBy: { id: 'asc' } });
  return toDtos(db, ops);
}

// ---------- locking helpers (order → operation → products) ----------

async function lockOrder(tx: Tx, ref: OrderRef): Promise<void> {
  if (ref.salesOrderId) await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id = ${ref.salesOrderId} FOR UPDATE`;
  if (ref.purchaseOrderId) await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${ref.purchaseOrderId} FOR UPDATE`;
  if (ref.manufacturingOrderId)
    await tx.$queryRaw`SELECT id FROM "ManufacturingOrder" WHERE id = ${ref.manufacturingOrderId} FOR UPDATE`;
}

function refOfOp(op: {
  salesOrderId: number | null;
  purchaseOrderId: number | null;
  manufacturingOrderId: number | null;
}): OrderRef {
  return {
    salesOrderId: op.salesOrderId ?? undefined,
    purchaseOrderId: op.purchaseOrderId ?? undefined,
    manufacturingOrderId: op.manufacturingOrderId ?? undefined,
  };
}

function opBase(user: AuthUser, op: { id: number; reference: string }): AuditBase {
  return { userId: user.id, module: 'STOCK', recordType: 'StockOperation', recordId: op.id, reference: op.reference };
}

const orderBase = {
  sales: (user: AuthUser, o: { id: number; reference: string }): AuditBase => ({
    userId: user.id,
    module: 'SALES',
    recordType: 'SalesOrder',
    recordId: o.id,
    reference: o.reference,
  }),
  purchase: (user: AuthUser, o: { id: number; reference: string }): AuditBase => ({
    userId: user.id,
    module: 'PURCHASE',
    recordType: 'PurchaseOrder',
    recordId: o.id,
    reference: o.reference,
  }),
  mo: (user: AuthUser, o: { id: number; reference: string }): AuditBase => ({
    userId: user.id,
    module: 'MANUFACTURING',
    recordType: 'ManufacturingOrder',
    recordId: o.id,
    reference: o.reference,
  }),
};

function notOpen(what: string, status: string): AppError {
  return new AppError(
    409,
    'INVALID_TRANSITION',
    `Can't do that on a ${what} in status ${status.toLowerCase().replace(/_/g, ' ')}`,
  );
}

// ---------- place ----------

export async function placeOperation(user: AuthUser, input: PlaceOperationInput): Promise<OperationDTO> {
  if (!canPlaceOperation(user, input.type)) {
    throw new AppError(403, 'FORBIDDEN', `You don't have permission to place a ${input.type.toLowerCase()} operation`);
  }
  return transaction(async (tx) => {
    const base = { type: input.type, placedById: user.id } as const;
    let data: Prisma.StockOperationUncheckedCreateInput;
    let orderAudit: AuditBase | null = null;

    if (input.type === 'DELIVERY' || input.type === 'RECEIPT') {
      const isSale = input.type === 'DELIVERY';
      const orderId = isSale ? input.salesOrderId : input.purchaseOrderId;
      await lockOrder(tx, isSale ? { salesOrderId: orderId } : { purchaseOrderId: orderId });
      const order = isSale
        ? await tx.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } })
        : await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
      if (!order) throw notFound(isSale ? 'Sales order' : 'Purchase order');
      const open = isSale ? ['CONFIRMED', 'PARTIALLY_DELIVERED'] : ['CONFIRMED', 'PARTIALLY_RECEIVED'];
      if (!open.includes(order.status)) throw notOpen(isSale ? 'sales order' : 'purchase order', order.status);
      const pending = await pendingQtyByLine(tx, isSale ? 'sales' : 'purchase', orderId);
      const requested = new Map<number, Prisma.Decimal>();
      for (const l of input.type === 'DELIVERY'
        ? input.lines.map((x) => ({ id: x.salesOrderLineId, q: x.quantity }))
        : input.lines.map((x) => ({ id: x.purchaseOrderLineId, q: x.quantity }))) {
        requested.set(l.id, (requested.get(l.id) ?? ZERO).plus(dec(l.q)));
      }
      const opLines: Prisma.StockOperationLineCreateWithoutOperationInput[] = [];
      for (const [lineId, q] of requested) {
        const line = order.lines.find((l) => l.id === lineId);
        if (!line) throw new AppError(400, 'VALIDATION_ERROR', `Line ${lineId} does not belong to ${order.reference}`);
        const done = 'deliveredQty' in line ? line.deliveredQty : line.receivedQty;
        const remaining = line.quantity.minus(done).minus(pending.get(lineId) ?? ZERO);
        if (q.greaterThan(remaining)) {
          throw new AppError(
            409,
            'QTY_EXCEEDS_REMAINING',
            `Only ${remaining.toString()} left to ${isSale ? 'deliver' : 'receive'} on that line (including pending operations)`,
          );
        }
        opLines.push({
          product: { connect: { id: line.productId } },
          quantity: q,
          ...(isSale ? { salesOrderLineId: lineId } : { purchaseOrderLineId: lineId }),
        });
      }
      data = {
        ...base,
        reference: await nextRef(tx, 'OP'),
        ...(isSale ? { salesOrderId: orderId } : { purchaseOrderId: orderId }),
        lines: { create: opLines },
      };
      orderAudit = isSale ? orderBase.sales(user, order) : orderBase.purchase(user, order);
    } else if (input.type === 'PRODUCTION') {
      await lockOrder(tx, { manufacturingOrderId: input.manufacturingOrderId });
      const mo = await tx.manufacturingOrder.findUnique({ where: { id: input.manufacturingOrderId } });
      if (!mo) throw notFound('Manufacturing order');
      if (!['CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'].includes(mo.status)) throw notOpen('manufacturing order', mo.status);
      if (await hasPendingOperation(tx, { manufacturingOrderId: mo.id })) {
        throw new AppError(409, 'QTY_EXCEEDS_REMAINING', 'Production for this order is already awaiting confirmation');
      }
      data = {
        ...base,
        reference: await nextRef(tx, 'OP'),
        manufacturingOrderId: mo.id,
        lines: { create: [{ product: { connect: { id: mo.productId } }, quantity: mo.quantity }] },
      };
      orderAudit = orderBase.mo(user, mo);
    } else {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) throw notFound('Product');
      data = {
        ...base,
        reference: await nextRef(tx, 'OP'),
        productId: product.id,
        targetQty: input.targetQty,
        reason: input.reason,
      };
    }

    const op = await tx.stockOperation.create({ data });
    await logAudit(tx, opBase(user, op), 'CREATE', { note: `${op.type} placed` });
    if (orderAudit) {
      await logAudit(tx, orderAudit, 'UPDATE', {
        field: 'stockOperation',
        newValue: `${op.reference} placed (${op.type.toLowerCase()})`,
      });
    }
    return loadDto(tx, op.id);
  });
}

// ---------- confirm / reject ----------

/** Lock order → operation; returns the operation if still PLACED and the caller may decide it. */
async function lockForDecision(tx: Tx, user: AuthUser, id: number): Promise<OpRow> {
  const peek = await tx.stockOperation.findUnique({ where: { id } });
  if (!peek) throw notFound('Stock operation');
  if (!canConfirmOperation(user, peek.type)) {
    throw new AppError(403, 'FORBIDDEN', 'Only a supervisor or manager can confirm or reject this operation');
  }
  await lockOrder(tx, refOfOp(peek));
  await tx.$queryRaw`SELECT id FROM "StockOperation" WHERE id = ${id} FOR UPDATE`;
  const op = await tx.stockOperation.findUniqueOrThrow({ where: { id }, include });
  if (op.status !== 'PLACED') {
    throw new AppError(409, 'OPERATION_CLOSED', `${op.reference} is already ${op.status.toLowerCase()}`);
  }
  return op;
}

export async function confirmOperation(user: AuthUser, id: number): Promise<OperationDTO> {
  return transaction(async (tx) => {
    const op = await lockForDecision(tx, user, id);
    const mv = { reference: op.reference, operationId: op.id, userId: user.id };

    if (op.type === 'DELIVERY' && op.salesOrderId) {
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: op.salesOrderId } });
      if (so.status === 'CANCELLED') throw new AppError(409, 'OPERATION_CLOSED', `${so.reference} was cancelled`);
      await postMoves(
        tx,
        op.lines.map((l) => ({ ...mv, productId: l.productId, quantity: l.quantity.negated(), type: 'DELIVERY' as const })),
      );
      for (const l of op.lines) {
        if (l.salesOrderLineId)
          await tx.salesOrderLine.update({
            where: { id: l.salesOrderLineId },
            data: { deliveredQty: { increment: l.quantity } },
          });
      }
      const lines = await tx.salesOrderLine.findMany({ where: { orderId: so.id } });
      const next = progressStatus(
        lines.map((l) => ({ quantity: l.quantity, done: l.deliveredQty })),
        so.status,
        'PARTIALLY_DELIVERED',
        'FULLY_DELIVERED',
      );
      if (next !== so.status) {
        await tx.salesOrder.update({ where: { id: so.id }, data: { status: next } });
        await logStatus(tx, orderBase.sales(user, so), so.status, next, `${op.reference} confirmed`);
      }
    } else if (op.type === 'RECEIPT' && op.purchaseOrderId) {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: op.purchaseOrderId } });
      if (po.status === 'CANCELLED') throw new AppError(409, 'OPERATION_CLOSED', `${po.reference} was cancelled`);
      await postMoves(
        tx,
        op.lines.map((l) => ({ ...mv, productId: l.productId, quantity: l.quantity, type: 'RECEIPT' as const })),
      );
      for (const l of op.lines) {
        if (l.purchaseOrderLineId)
          await tx.purchaseOrderLine.update({
            where: { id: l.purchaseOrderLineId },
            data: { receivedQty: { increment: l.quantity } },
          });
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id } });
      const next = progressStatus(
        lines.map((l) => ({ quantity: l.quantity, done: l.receivedQty })),
        po.status,
        'PARTIALLY_RECEIVED',
        'FULLY_RECEIVED',
      );
      if (next !== po.status) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: next } });
        await logStatus(tx, orderBase.purchase(user, po), po.status, next, `${op.reference} confirmed`);
      }
    } else if (op.type === 'PRODUCTION' && op.manufacturingOrderId) {
      const mo = await tx.manufacturingOrder.findUniqueOrThrow({
        where: { id: op.manufacturingOrderId },
        include: { components: true },
      });
      if (mo.status === 'CANCELLED' || mo.status === 'DONE')
        throw new AppError(409, 'OPERATION_CLOSED', `${mo.reference} is ${mo.status.toLowerCase()}`);
      await postMoves(tx, [
        ...mo.components.map((c) => ({
          ...mv,
          productId: c.productId,
          quantity: c.toConsume.minus(c.consumed).negated(),
          type: 'MO_CONSUME' as const,
        })),
        { ...mv, productId: mo.productId, quantity: mo.quantity, type: 'MO_PRODUCE' as const },
      ]);
      for (const c of mo.components) await tx.moComponent.update({ where: { id: c.id }, data: { consumed: c.toConsume } });
      await tx.manufacturingOrder.update({ where: { id: mo.id }, data: { status: 'DONE' } });
      await logStatus(tx, orderBase.mo(user, mo), mo.status, 'DONE', `${op.reference} confirmed`);
    } else if (op.type === 'ADJUSTMENT' && op.productId !== null && op.targetQty !== null) {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${op.productId} FOR UPDATE`;
      const product = await tx.product.findUniqueOrThrow({ where: { id: op.productId } });
      const delta = op.targetQty.minus(product.onHand);
      await postMoves(tx, [{ ...mv, productId: product.id, quantity: delta, type: 'ADJUSTMENT' }]);
    }

    await tx.stockOperation.update({ where: { id }, data: { status: 'CONFIRMED', decidedById: user.id, decidedAt: new Date() } });
    await logStatus(tx, opBase(user, op), 'PLACED', 'CONFIRMED');
    return loadDto(tx, id);
  });
}

export async function rejectOperation(user: AuthUser, id: number, reason: string): Promise<OperationDTO> {
  return transaction(async (tx) => {
    const op = await lockForDecision(tx, user, id);
    await tx.stockOperation.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason, decidedById: user.id, decidedAt: new Date() },
    });
    await logStatus(tx, opBase(user, op), 'PLACED', 'REJECTED', reason);
    return loadDto(tx, id);
  });
}

/** Called by order cancellation (the order row is already locked by the caller). */
export async function rejectPendingForOrder(tx: Tx, user: AuthUser, ref: OrderRef): Promise<void> {
  const ops = await tx.stockOperation.findMany({ where: { ...ref, status: 'PLACED' } });
  for (const op of ops) {
    await tx.stockOperation.update({
      where: { id: op.id },
      data: { status: 'REJECTED', rejectReason: 'Order cancelled', decidedById: user.id, decidedAt: new Date() },
    });
    await logStatus(tx, opBase(user, op), 'PLACED', 'REJECTED', 'Order cancelled');
  }
}

// ---------- list ----------

export const operationQuerySchema = z.object({
  status: z.enum(['PLACED', 'CONFIRMED', 'REJECTED']).optional(),
  type: z.enum(['DELIVERY', 'RECEIPT', 'PRODUCTION', 'ADJUSTMENT']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Types whose module the user can view (adjustments: Products). */
export function visibleTypes(user: AuthUser): OperationType[] {
  return (['DELIVERY', 'RECEIPT', 'PRODUCTION', 'ADJUSTMENT'] as OperationType[]).filter((t) =>
    can(user, operationModule(t), 'view'),
  );
}

export async function listOperations(user: AuthUser, q: z.infer<typeof operationQuerySchema>) {
  const types = visibleTypes(user).filter((t) => !q.type || t === q.type);
  const where: Prisma.StockOperationWhereInput = { status: q.status as OperationStatus | undefined, type: { in: types } };
  const [rows, total] = await Promise.all([
    prisma.stockOperation.findMany({ where, include, orderBy: { id: 'desc' }, ...paging(q) }),
    prisma.stockOperation.count({ where }),
  ]);
  return { items: await toDtos(prisma, rows), total, page: q.page, pageSize: q.pageSize };
}

export async function countAwaiting(user: AuthUser, db: Db = prisma): Promise<number> {
  return db.stockOperation.count({ where: { status: 'PLACED', type: { in: visibleTypes(user) } } });
}
