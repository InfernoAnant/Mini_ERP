import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { assertAnyModuleAccess, assertCan, assertCanEdit } from '../config/permissions';
import { dec } from '../lib/decimal';
import { AppError, notFound } from '../lib/errors';
import { type ListQuery, type Paged, paging } from '../lib/listQuery';
import { type Db, prisma, transaction } from '../lib/prisma';
import { logAudit, logChanges } from './audit.service';
import type { AuthUser } from './auth.service';
import { getLevels, postMoves } from './stock.service';

const money = z.coerce.number().min(0, 'Must be 0 or more').max(1e9);

const productFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  unit: z.string().trim().min(1).max(20).optional(),
  salesPrice: money,
  costPrice: money,
  procureOnDemand: z.boolean().optional(),
  procurementType: z.enum(['PURCHASE', 'MANUFACTURING']).nullable().optional(),
  vendorId: z.coerce.number().int().nullable().optional(),
  defaultBomId: z.coerce.number().int().nullable().optional(),
});

type ProcurementFields = {
  procureOnDemand?: boolean;
  procurementType?: 'PURCHASE' | 'MANUFACTURING' | null;
  vendorId?: number | null;
  defaultBomId?: number | null;
};

function procurementRefine(v: ProcurementFields, ctx: z.RefinementCtx): void {
  if (!v.procureOnDemand) return;
  if (!v.procurementType) {
    ctx.addIssue({ code: 'custom', path: ['procurementType'], message: 'Choose Purchase or Manufacturing' });
  } else if (v.procurementType === 'PURCHASE' && !v.vendorId) {
    ctx.addIssue({ code: 'custom', path: ['vendorId'], message: 'A vendor is required for Purchase procurement' });
  }
}

export const createProductSchema = productFields
  .extend({ initialStock: z.coerce.number().min(0).max(1e9).default(0) })
  .superRefine(procurementRefine);
export const updateProductSchema = productFields.partial();
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

const TRACKED = ['name', 'unit', 'salesPrice', 'costPrice', 'procureOnDemand', 'procurementType', 'vendorId', 'defaultBomId'];

const include = {
  vendor: { select: { id: true, name: true } },
  defaultBom: { select: { id: true, reference: true } },
} satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof include }>;

function toDto(p: ProductRow, reserved: Prisma.Decimal) {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    salesPrice: p.salesPrice,
    costPrice: p.costPrice,
    onHand: p.onHand,
    reserved,
    free: p.onHand.minus(reserved),
    procureOnDemand: p.procureOnDemand,
    procurementType: p.procurementType,
    vendor: p.vendor,
    defaultBom: p.defaultBom,
    createdById: p.createdById,
    updatedAt: p.updatedAt,
  };
}
export type ProductDTO = ReturnType<typeof toDto>;

async function validateProcurement(db: Db, productId: number | null, v: ProcurementFields): Promise<void> {
  if (v.vendorId) {
    const vendor = await db.contact.findUnique({ where: { id: v.vendorId } });
    if (!vendor || vendor.type !== 'VENDOR') throw new AppError(400, 'VALIDATION_ERROR', 'vendorId: Not a vendor');
  }
  // A brand-new product can't have a BoM yet; it may be set later (procurement skips it until then).
  if (productId === null) return;
  if (v.procureOnDemand && v.procurementType === 'MANUFACTURING') {
    if (!v.defaultBomId) throw new AppError(400, 'BOM_REQUIRED', 'A bill of materials is required for Manufacturing procurement');
    const bom = await db.bom.findUnique({ where: { id: v.defaultBomId } });
    if (!bom || bom.productId !== productId) {
      throw new AppError(400, 'BOM_PRODUCT_MISMATCH', 'The bill of materials must be for this product');
    }
  } else if (v.defaultBomId) {
    const bom = await db.bom.findUnique({ where: { id: v.defaultBomId } });
    if (!bom || bom.productId !== productId) {
      throw new AppError(400, 'BOM_PRODUCT_MISMATCH', 'The bill of materials must be for this product');
    }
  }
}

export async function getProduct(id: number, db: Db = prisma): Promise<ProductDTO> {
  const p = await db.product.findUnique({ where: { id }, include });
  if (!p) throw notFound('Product');
  const level = (await getLevels(db, [id])).get(id);
  return toDto(p, level?.reserved ?? dec(0));
}

export async function viewProduct(user: AuthUser, id: number): Promise<ProductDTO> {
  assertCan(user, 'PRODUCTS', 'view');
  return getProduct(id);
}

export async function createProduct(user: AuthUser, input: CreateProductInput): Promise<ProductDTO> {
  assertCan(user, 'PRODUCTS', 'create');
  return transaction(async (tx) => {
    await validateProcurement(tx, null, input);
    const p = await tx.product.create({
      data: {
        name: input.name,
        unit: input.unit,
        salesPrice: input.salesPrice,
        costPrice: input.costPrice,
        procureOnDemand: input.procureOnDemand ?? false,
        procurementType: input.procurementType ?? null,
        vendorId: input.vendorId ?? null,
        createdById: user.id,
      },
    });
    await logAudit(
      tx,
      { userId: user.id, module: 'PRODUCTS', recordType: 'Product', recordId: p.id, reference: p.name },
      'CREATE',
    );
    if (input.initialStock > 0) {
      await postMoves(tx, [
        { productId: p.id, quantity: dec(input.initialStock), type: 'ADJUSTMENT', reference: 'INITIAL', userId: user.id },
      ]);
    }
    return getProduct(p.id, tx);
  });
}

export async function updateProduct(user: AuthUser, id: number, input: UpdateProductInput): Promise<ProductDTO> {
  return transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw notFound('Product');
    assertCanEdit(user, 'PRODUCTS', { createdById: before.createdById });
    const merged = {
      procureOnDemand: input.procureOnDemand ?? before.procureOnDemand,
      procurementType: input.procurementType !== undefined ? input.procurementType : before.procurementType,
      vendorId: input.vendorId !== undefined ? input.vendorId : before.vendorId,
      defaultBomId: input.defaultBomId !== undefined ? input.defaultBomId : before.defaultBomId,
    };
    if (merged.procureOnDemand && !merged.procurementType) {
      throw new AppError(400, 'VALIDATION_ERROR', 'procurementType: Choose Purchase or Manufacturing');
    }
    if (merged.procureOnDemand && merged.procurementType === 'PURCHASE' && !merged.vendorId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'vendorId: A vendor is required for Purchase procurement');
    }
    await validateProcurement(tx, id, merged);
    const after = await tx.product.update({ where: { id }, data: { ...input } });
    await logChanges(
      tx,
      { userId: user.id, module: 'PRODUCTS', recordType: 'Product', recordId: id, reference: after.name },
      before,
      after,
      TRACKED,
    );
    return getProduct(id, tx);
  });
}

export async function listProducts(
  user: AuthUser,
  q: ListQuery & { procurementType?: 'PURCHASE' | 'MANUFACTURING' },
): Promise<Paged<ProductDTO>> {
  assertCan(user, 'PRODUCTS', 'view');
  const where: Prisma.ProductWhereInput = {
    name: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
    procurementType: q.procurementType,
  };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, include, orderBy: { name: 'asc' }, ...paging(q) }),
    prisma.product.count({ where }),
  ]);
  const levels = await getLevels(
    prisma,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => toDto(r, levels.get(r.id)?.reserved ?? dec(0))),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Lightweight options for dropdowns (any logged-in user who can view something). */
export async function productOptions(user: AuthUser) {
  assertAnyModuleAccess(user);
  const rows = await prisma.product.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, unit: true, salesPrice: true, costPrice: true, onHand: true, defaultBomId: true },
  });
  const levels = await getLevels(
    prisma,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, free: levels.get(r.id)?.free ?? r.onHand }));
}

export async function getLedger(user: AuthUser, productId: number, page: number) {
  assertCan(user, 'PRODUCTS', 'view');
  const pageSize = 20;
  const [items, total] = await Promise.all([
    prisma.stockMove.findMany({
      where: { productId },
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMove.count({ where: { productId } }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.userId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: items.map((m) => ({ ...m, userName: nameOf.get(m.userId) ?? 'System' })),
    total,
    page,
    pageSize,
  };
}
