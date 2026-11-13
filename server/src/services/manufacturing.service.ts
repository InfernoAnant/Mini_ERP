import { type MoStatus, Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { assertCan, assertCanEdit } from '../config/permissions.js';
import { dec, ZERO } from '../lib/decimal.js';
import { AppError, notFound } from '../lib/errors.js';
import { type ListQuery, type Paged, paging } from '../lib/listQuery.js';
import { type Db, type Tx, prisma, transaction, sequential } from '../lib/prisma.js';
import { userRefs } from '../lib/users.js';
import { type AuditBase, logAudit, logChanges, logStatus } from './audit.service.js';
import type { AuthUser } from './auth.service.js';
import { hasPendingOperation, operationsForOrder, rejectPendingForOrder } from './operations.service.js';
import { moProgress } from './progress.service.js';
import { invalidTransition } from './purchase.service.js';
import { nextRef } from './reference.service.js';
import { getLevels, lockProducts } from './stock.service.js';

export const moInputSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(1e7),
  bomId: z.coerce.number().int().positive(),
  assigneeId: z.coerce.number().int().positive().nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
});
export type MoInput = z.infer<typeof moInputSchema>;
export const moUpdateSchema = moInputSchema.partial();
export type MoUpdate = z.infer<typeof moUpdateSchema>;

/** Statuses in which an MO's components are reserved. */
export const MO_RESERVING: MoStatus[] = ['CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'];
const HEADER_FIELDS = ['productId', 'quantity', 'bomId', 'assigneeId', 'deadline'];

const include = {
  product: { select: { id: true, name: true, unit: true } },
  bom: { select: { id: true, reference: true } },
  components: { include: { product: { select: { name: true, unit: true } } }, orderBy: { id: 'asc' } },
  workOrders: { include: { workCenter: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
} satisfies Prisma.ManufacturingOrderInclude;
type MoRow = Prisma.ManufacturingOrderGetPayload<{ include: typeof include }>;

export function isMoLate(mo: { deadline: Date | null; status: MoStatus }): boolean {
  return !!mo.deadline && mo.deadline < new Date() && MO_RESERVING.includes(mo.status);
}

function base(user: AuthUser | null, mo: { id: number; reference: string }): AuditBase {
  return {
    userId: user?.id ?? null,
    module: 'MANUFACTURING',
    recordType: 'ManufacturingOrder',
    recordId: mo.id,
    reference: mo.reference,
  };
}

async function toDto(db: Db, mo: MoRow) {
  const [levels, ref, operations] = await sequential(
    () =>
      getLevels(
        db,
        mo.components.map((c) => c.productId),
      ),
    () => userRefs(db, [mo.assigneeId, mo.createdById]),
    () => operationsForOrder(db, { manufacturingOrderId: mo.id }),
  );
  const reserving = MO_RESERVING.includes(mo.status);
  return {
    id: mo.id,
    reference: mo.reference,
    product: mo.product,
    quantity: mo.quantity,
    bom: mo.bom,
    assignee: ref(mo.assigneeId),
    createdBy: ref(mo.createdById),
    createdById: mo.createdById,
    deadline: mo.deadline,
    status: mo.status,
    origin: mo.origin,
    createdAt: mo.createdAt,
    late: isMoLate(mo),
    components: mo.components.map((c) => {
      const remaining = c.toConsume.minus(c.consumed);
      const free = levels.get(c.productId)?.free ?? ZERO;
      // An MO's own reservation shouldn't make its components look unavailable.
      const usable = reserving ? free.plus(remaining) : free;
      return {
        id: c.id,
        productId: c.productId,
        productName: c.product.name,
        unit: c.product.unit,
        toConsume: c.toConsume,
        consumed: c.consumed,
        available: usable.greaterThanOrEqualTo(remaining),
      };
    }),
    workOrders: mo.workOrders.map((w) => ({
      id: w.id,
      sequence: w.sequence,
      name: w.name,
      workCenter: w.workCenter,
      expectedMinutes: w.expectedMinutes,
      realMinutes: w.realMinutes,
      status: w.status,
    })),
    operations,
    progress: moProgress({ status: mo.status, workOrders: mo.workOrders }),
  };
}
export type MoDTO = Awaited<ReturnType<typeof toDto>>;

async function load(db: Db, id: number): Promise<MoRow> {
  const mo = await db.manufacturingOrder.findUnique({ where: { id }, include });
  if (!mo) throw notFound('Manufacturing order');
  return mo;
}

async function lock(tx: Tx, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ManufacturingOrder" WHERE id = ${id} FOR UPDATE`;
}

/** Components and work orders copied (snapshot) from the BoM, scaled to the MO quantity. */
async function linesFromBom(db: Db, productId: number, bomId: number, quantity: Prisma.Decimal) {
  const bom = await db.bom.findUnique({ where: { id: bomId }, include: { components: true, operations: true } });
  if (!bom) throw new AppError(400, 'VALIDATION_ERROR', 'bomId: Unknown bill of materials');
  if (bom.productId !== productId) {
    throw new AppError(400, 'BOM_PRODUCT_MISMATCH', 'The bill of materials is for a different product');
  }
  const factor = quantity.dividedBy(bom.outputQty);
  return {
    components: bom.components.map((c) => ({ productId: c.productId, toConsume: c.quantity.times(factor).toDecimalPlaces(3) })),
    workOrders: [...bom.operations]
      .sort((a, b) => a.sequence - b.sequence)
      .map((o) => ({
        sequence: o.sequence,
        name: o.name,
        workCenterId: o.workCenterId,
        expectedMinutes: dec(o.durationMinutes).times(factor).toDecimalPlaces(0).toNumber(),
      })),
  };
}

/** Creates a Draft MO without permission checks (used by procurement and seeding). */
export async function createDraftMoTx(
  tx: Tx,
  user: AuthUser,
  input: MoInput & { origin?: string },
): Promise<{ id: number; reference: string }> {
  const qty = dec(input.quantity);
  const lines = await linesFromBom(tx, input.productId, input.bomId, qty);
  const reference = await nextRef(tx, 'MO');
  const mo = await tx.manufacturingOrder.create({
    data: {
      reference,
      productId: input.productId,
      quantity: qty,
      bomId: input.bomId,
      assigneeId: input.assigneeId ?? null,
      deadline: input.deadline ?? null,
      origin: input.origin ?? null,
      createdById: user.id,
      components: { create: lines.components },
      workOrders: { create: lines.workOrders },
    },
  });
  await logAudit(tx, base(user, mo), 'CREATE', { note: input.origin ? `Auto-procurement from ${input.origin}` : undefined });
  return mo;
}

/** DTO without a permission check (journey, internal use). */
export async function moDtoById(id: number, db: Db = prisma): Promise<MoDTO> {
  return toDto(db, await load(db, id));
}

export async function getMo(user: AuthUser, id: number, db: Db = prisma): Promise<MoDTO> {
  assertCan(user, 'MANUFACTURING', 'view');
  return toDto(db, await load(db, id));
}

export async function createMo(user: AuthUser, input: MoInput): Promise<MoDTO> {
  assertCan(user, 'MANUFACTURING', 'create');
  return transaction(async (tx) => {
    const { id } = await createDraftMoTx(tx, user, input);
    return toDto(tx, await load(tx, id));
  });
}

/**
 * Procurement hook for component shortages, installed by procurement.service (Task 9) to avoid a
 * circular import. Returns created references.
 */
export type ComponentProcurer = (
  tx: Tx,
  user: AuthUser,
  origin: string,
  demands: { productId: number; quantity: Prisma.Decimal; freeBefore: Prisma.Decimal }[],
) => Promise<string[]>;
let procureComponents: ComponentProcurer = async () => [];
export function setComponentProcurer(fn: ComponentProcurer): void {
  procureComponents = fn;
}

export async function updateMo(user: AuthUser, id: number, input: MoUpdate): Promise<{ order: MoDTO; procured: string[] }> {
  return transaction(async (tx) => {
    await lock(tx, id);
    const before = await load(tx, id);
    assertCanEdit(user, 'MANUFACTURING', before);
    let procured: string[] = [];
    if (before.status === 'DRAFT') {
      const productId = input.productId ?? before.productId;
      const bomId = input.bomId ?? before.bomId;
      const qty = input.quantity !== undefined ? dec(input.quantity) : before.quantity;
      const relink = productId !== before.productId || bomId !== before.bomId || !qty.equals(before.quantity);
      if (relink) {
        const lines = await linesFromBom(tx, productId, bomId, qty);
        await tx.moComponent.deleteMany({ where: { moId: id } });
        await tx.workOrder.deleteMany({ where: { moId: id } });
        await tx.manufacturingOrder.update({
          where: { id },
          data: {
            productId,
            bomId,
            quantity: qty,
            components: { create: lines.components },
            workOrders: { create: lines.workOrders },
          },
        });
      }
    } else if (MO_RESERVING.includes(before.status)) {
      if (input.productId !== undefined && input.productId !== before.productId) {
        throw new AppError(409, 'NOT_EDITABLE', "The product can't be changed after confirmation");
      }
      if (input.bomId !== undefined && input.bomId !== before.bomId) {
        throw new AppError(409, 'NOT_EDITABLE', "The bill of materials can't be changed after confirmation");
      }
      if (input.quantity !== undefined && !dec(input.quantity).equals(before.quantity)) {
        if (await hasPendingOperation(tx, { manufacturingOrderId: id })) {
          throw new AppError(409, 'QTY_BELOW_COMMITTED', "Quantity can't change while production is awaiting confirmation");
        }
        const newQty = dec(input.quantity);
        const ratio = newQty.dividedBy(before.quantity);
        const demands: { productId: number; quantity: Prisma.Decimal; freeBefore: Prisma.Decimal }[] = [];
        const increasing = newQty.greaterThan(before.quantity);
        if (increasing)
          await lockProducts(
            tx,
            before.components.map((c) => c.productId),
          );
        const levels = increasing
          ? await getLevels(
              tx,
              before.components.map((c) => c.productId),
            )
          : null;
        for (const c of before.components) {
          const toConsume = c.toConsume.times(ratio).toDecimalPlaces(3);
          await tx.moComponent.update({ where: { id: c.id }, data: { toConsume } });
          if (levels && toConsume.greaterThan(c.toConsume)) {
            demands.push({
              productId: c.productId,
              quantity: toConsume.minus(c.toConsume),
              freeBefore: levels.get(c.productId)?.free ?? ZERO,
            });
          }
        }
        for (const w of before.workOrders) {
          await tx.workOrder.update({
            where: { id: w.id },
            data: { expectedMinutes: dec(w.expectedMinutes).times(ratio).toDecimalPlaces(0).toNumber() },
          });
        }
        await tx.manufacturingOrder.update({ where: { id }, data: { quantity: newQty } });
        if (demands.length) procured = await procureComponents(tx, user, before.reference, demands);
      }
    } else {
      throw new AppError(
        409,
        'NOT_EDITABLE',
        `A ${before.status.toLowerCase().replace('_', ' ')} manufacturing order can't be edited`,
      );
    }
    const after = await tx.manufacturingOrder.update({
      where: { id },
      data: {
        assigneeId: input.assigneeId !== undefined ? input.assigneeId : before.assigneeId,
        deadline: input.deadline !== undefined ? input.deadline : before.deadline,
      },
    });
    await logChanges(tx, base(user, before), before, after, HEADER_FIELDS);
    return { order: await toDto(tx, await load(tx, id)), procured };
  });
}

export async function confirmMo(user: AuthUser, id: number): Promise<{ order: MoDTO; procured: string[] }> {
  assertCan(user, 'MANUFACTURING', 'confirm');
  return transaction(async (tx) => {
    await lock(tx, id);
    const mo = await load(tx, id);
    if (mo.status !== 'DRAFT') throw invalidTransition('confirm', mo.status);
    // Free-to-use before this MO's own reservation takes effect (locked, so concurrent confirms can't both read it).
    await lockProducts(
      tx,
      mo.components.map((c) => c.productId),
    );
    const levels = await getLevels(
      tx,
      mo.components.map((c) => c.productId),
    );
    await tx.manufacturingOrder.update({ where: { id }, data: { status: 'CONFIRMED' } });
    await logStatus(tx, base(user, mo), mo.status, 'CONFIRMED');
    const procured = await procureComponents(
      tx,
      user,
      mo.reference,
      mo.components.map((c) => ({
        productId: c.productId,
        quantity: c.toConsume,
        freeBefore: levels.get(c.productId)?.free ?? ZERO,
      })),
    );
    return { order: await toDto(tx, await load(tx, id)), procured };
  });
}

export async function cancelMo(user: AuthUser, id: number): Promise<MoDTO> {
  assertCan(user, 'MANUFACTURING', 'cancel');
  return transaction(async (tx) => {
    await lock(tx, id);
    const mo = await load(tx, id);
    if (mo.status === 'DONE' || mo.status === 'CANCELLED') throw invalidTransition('cancel', mo.status);
    await rejectPendingForOrder(tx, user, { manufacturingOrderId: id });
    await tx.manufacturingOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await logStatus(tx, base(user, mo), mo.status, 'CANCELLED');
    return toDto(tx, await load(tx, id));
  });
}

export async function deleteMo(user: AuthUser, id: number): Promise<void> {
  assertCan(user, 'MANUFACTURING', 'delete');
  await transaction(async (tx) => {
    const mo = await load(tx, id);
    if (mo.status !== 'DRAFT') throw new AppError(409, 'NOT_EDITABLE', 'Only draft manufacturing orders can be deleted');
    await tx.manufacturingOrder.delete({ where: { id } });
    await logAudit(tx, base(user, mo), 'DELETE');
  });
}

export async function completeWorkOrder(user: AuthUser, moId: number, woId: number, realMinutes: number): Promise<MoDTO> {
  assertCan(user, 'MANUFACTURING', 'operate');
  return transaction(async (tx) => {
    await lock(tx, moId);
    const mo = await load(tx, moId);
    if (mo.status !== 'CONFIRMED' && mo.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'INVALID_TRANSITION', 'Work orders can be completed only on a confirmed or in-progress order');
    }
    const wo = mo.workOrders.find((w) => w.id === woId);
    if (!wo) throw notFound('Work order');
    if (wo.status === 'DONE') throw new AppError(409, 'INVALID_TRANSITION', 'This work order is already done');
    await tx.workOrder.update({ where: { id: woId }, data: { status: 'DONE', realMinutes } });
    await logAudit(tx, base(user, mo), 'UPDATE', {
      field: `workOrder:${wo.name}`,
      oldValue: 'PENDING',
      newValue: `DONE (${realMinutes} min)`,
    });
    const remaining = mo.workOrders.filter((w) => w.id !== woId && w.status !== 'DONE').length;
    const next: MoStatus = remaining === 0 ? 'TO_CLOSE' : 'IN_PROGRESS';
    if (next !== mo.status) {
      await tx.manufacturingOrder.update({ where: { id: moId }, data: { status: next } });
      await logStatus(tx, base(user, mo), mo.status, next);
    }
    return toDto(tx, await load(tx, moId));
  });
}

export const moStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED']);

export async function listMos(user: AuthUser, q: ListQuery): Promise<Paged<MoDTO>> {
  assertCan(user, 'MANUFACTURING', 'view');
  const status = q.status ? moStatusSchema.parse(q.status) : undefined;
  const where: Prisma.ManufacturingOrderWhereInput = {
    status: q.late ? { in: MO_RESERVING } : status,
    deadline: q.late ? { lt: new Date() } : undefined,
    assigneeId: q.mine ? user.id : undefined,
    OR: q.q
      ? [{ reference: { contains: q.q, mode: 'insensitive' } }, { product: { name: { contains: q.q, mode: 'insensitive' } } }]
      : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.manufacturingOrder.findMany({ where, include, orderBy: { id: 'desc' }, ...paging(q) }),
    prisma.manufacturingOrder.count({ where }),
  ]);
  return { items: await Promise.all(rows.map((r) => toDto(prisma, r))), total, page: q.page, pageSize: q.pageSize };
}
