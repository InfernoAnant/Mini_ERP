import type { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { assertAnyModuleAccess, assertCan } from '../config/permissions.js';
import { AppError, notFound } from '../lib/errors.js';
import { type ListQuery, type Paged, paging } from '../lib/listQuery.js';
import { type Db, prisma, transaction } from '../lib/prisma.js';
import { logAudit, logChanges } from './audit.service.js';
import type { AuthUser } from './auth.service.js';
import { nextRef } from './reference.service.js';

export const bomInputSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    outputQty: z.coerce.number().positive().max(1e6).default(1),
    components: z
      .array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive().max(1e6) }))
      .min(1, 'Add at least one component'),
    operations: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Operation name is required').max(80),
          workCenterId: z.coerce.number().int().positive(),
          durationMinutes: z.coerce.number().int().positive().max(100000),
        }),
      )
      .default([]),
  })
  .superRefine((v, ctx) => {
    const ids = v.components.map((c) => c.productId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['components'], message: 'Each component may appear only once' });
    }
    if (ids.includes(v.productId)) {
      ctx.addIssue({ code: 'custom', path: ['components'], message: 'A product cannot be a component of itself' });
    }
  });
export type BomInput = z.infer<typeof bomInputSchema>;

const include = {
  product: { select: { id: true, name: true } },
  components: { include: { product: { select: { name: true } } }, orderBy: { id: 'asc' } },
  operations: { include: { workCenter: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
} satisfies Prisma.BomInclude;
type BomRow = Prisma.BomGetPayload<{ include: typeof include }>;

function toDto(b: BomRow) {
  return {
    id: b.id,
    reference: b.reference,
    product: b.product,
    outputQty: b.outputQty,
    components: b.components.map((c) => ({ productId: c.productId, productName: c.product.name, quantity: c.quantity })),
    operations: b.operations.map((o) => ({
      sequence: o.sequence,
      name: o.name,
      workCenter: o.workCenter,
      durationMinutes: o.durationMinutes,
    })),
    createdAt: b.createdAt,
  };
}
export type BomDTO = ReturnType<typeof toDto>;

function summarize(lines: { name: string; qty: string }[]): string {
  return lines.map((l) => `${l.qty} × ${l.name}`).join(', ');
}

async function linesSummary(db: Db, bomId: number): Promise<{ components: string; operations: string }> {
  const b = await db.bom.findUniqueOrThrow({ where: { id: bomId }, include });
  return {
    components: summarize(b.components.map((c) => ({ name: c.product.name, qty: c.quantity.toString() }))),
    operations: b.operations.map((o) => `${o.name} ${o.durationMinutes}m @ ${o.workCenter.name}`).join(', '),
  };
}

async function validateRefs(db: Db, input: BomInput): Promise<void> {
  const productIds = [input.productId, ...input.components.map((c) => c.productId)];
  const found = await db.product.count({ where: { id: { in: productIds } } });
  if (found !== new Set(productIds).size) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown product in bill of materials');
  const wcIds = [...new Set(input.operations.map((o) => o.workCenterId))];
  if (wcIds.length && (await db.workCenter.count({ where: { id: { in: wcIds } } })) !== wcIds.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Unknown work center');
  }
}

function lineData(input: BomInput) {
  return {
    components: { create: input.components.map((c) => ({ productId: c.productId, quantity: c.quantity })) },
    operations: {
      create: input.operations.map((o, i) => ({
        sequence: i + 1,
        name: o.name,
        workCenterId: o.workCenterId,
        durationMinutes: o.durationMinutes,
      })),
    },
  };
}

export async function getBom(user: AuthUser, id: number, db: Db = prisma): Promise<BomDTO> {
  assertCan(user, 'BOM', 'view');
  const b = await db.bom.findUnique({ where: { id }, include });
  if (!b) throw notFound('Bill of materials');
  return toDto(b);
}

export async function createBom(user: AuthUser, input: BomInput): Promise<BomDTO> {
  assertCan(user, 'BOM', 'create');
  return transaction(async (tx) => {
    await validateRefs(tx, input);
    const reference = await nextRef(tx, 'BOM');
    const b = await tx.bom.create({
      data: { reference, productId: input.productId, outputQty: input.outputQty, createdById: user.id, ...lineData(input) },
      include,
    });
    await logAudit(tx, { userId: user.id, module: 'BOM', recordType: 'Bom', recordId: b.id, reference }, 'CREATE');
    return toDto(b);
  });
}

export async function updateBom(user: AuthUser, id: number, input: BomInput): Promise<BomDTO> {
  assertCan(user, 'BOM', 'edit');
  return transaction(async (tx) => {
    const before = await tx.bom.findUnique({ where: { id }, include: { defaultFor: true } });
    if (!before) throw notFound('Bill of materials');
    if (input.productId !== before.productId) {
      const usedByMo = await tx.manufacturingOrder.count({ where: { bomId: id } });
      if (usedByMo > 0 || before.defaultFor) {
        throw new AppError(
          409,
          'IN_USE',
          "This bill of materials is in use, so its finished product can't change. Create a new BoM instead.",
        );
      }
    }
    await validateRefs(tx, input);
    const beforeLines = await linesSummary(tx, id);
    await tx.bomComponent.deleteMany({ where: { bomId: id } });
    await tx.bomOperation.deleteMany({ where: { bomId: id } });
    const after = await tx.bom.update({
      where: { id },
      data: { productId: input.productId, outputQty: input.outputQty, ...lineData(input) },
      include,
    });
    const afterLines = await linesSummary(tx, id);
    await logChanges(
      tx,
      { userId: user.id, module: 'BOM', recordType: 'Bom', recordId: id, reference: before.reference },
      { productId: before.productId, outputQty: before.outputQty, ...beforeLines },
      { productId: after.productId, outputQty: after.outputQty, ...afterLines },
      ['productId', 'outputQty', 'components', 'operations'],
    );
    return toDto(after);
  });
}

export async function deleteBom(user: AuthUser, id: number): Promise<void> {
  assertCan(user, 'BOM', 'delete');
  await transaction(async (tx) => {
    const b = await tx.bom.findUnique({ where: { id }, include: { defaultFor: true } });
    if (!b) throw notFound('Bill of materials');
    const usedByMo = await tx.manufacturingOrder.count({ where: { bomId: id } });
    if (usedByMo > 0 || b.defaultFor) {
      throw new AppError(409, 'IN_USE', 'This bill of materials is used by a manufacturing order or as a product default');
    }
    await tx.bom.delete({ where: { id } });
    await logAudit(tx, { userId: user.id, module: 'BOM', recordType: 'Bom', recordId: id, reference: b.reference }, 'DELETE');
  });
}

export async function listBoms(user: AuthUser, q: ListQuery & { productId?: number }): Promise<Paged<BomDTO>> {
  assertCan(user, 'BOM', 'view');
  const where: Prisma.BomWhereInput = {
    productId: q.productId,
    OR: q.q
      ? [{ reference: { contains: q.q, mode: 'insensitive' } }, { product: { name: { contains: q.q, mode: 'insensitive' } } }]
      : undefined,
  };
  const [rows, total] = await Promise.all([
    prisma.bom.findMany({ where, include, orderBy: { id: 'desc' }, ...paging(q) }),
    prisma.bom.count({ where }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

/** BoMs for a product, for dropdowns (MO form, product form). No module permission needed beyond login. */
export async function bomOptions(user: AuthUser, productId?: number) {
  assertAnyModuleAccess(user);
  return prisma.bom.findMany({
    where: { productId },
    select: { id: true, reference: true, productId: true, outputQty: true },
    orderBy: { id: 'asc' },
  });
}
