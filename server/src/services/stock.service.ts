import { Prisma, type StockMoveType } from '../generated/prisma/client.js';
import { AppError } from '../lib/errors.js';
import { ZERO } from '../lib/decimal.js';
import { type Db, type Tx } from '../lib/prisma.js';
import { logAudit } from './audit.service.js';

export type MoveInput = {
  productId: number;
  /** Signed: positive adds stock, negative removes it. */
  quantity: Prisma.Decimal;
  type: StockMoveType;
  reference: string;
  operationId?: number;
  userId: number;
};

export type StockLevel = { onHand: Prisma.Decimal; reserved: Prisma.Decimal; free: Prisma.Decimal };

/** Row-lock products in id order (deadlock-safe) for the rest of the transaction. */
export async function lockProducts(tx: Tx, productIds: number[]): Promise<void> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ANY(${ids}::int[]) ORDER BY id FOR UPDATE`;
}

/** The only way stock changes: ledger rows + cached onHand, inside the caller's transaction. */
export async function postMoves(tx: Tx, moves: MoveInput[]): Promise<void> {
  const active = moves.filter((m) => !m.quantity.isZero());
  if (active.length === 0) return;
  await lockProducts(
    tx,
    active.map((m) => m.productId),
  );
  for (const move of active) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: move.productId } });
    const next = product.onHand.plus(move.quantity);
    if (next.isNegative()) {
      throw new AppError(
        409,
        'INSUFFICIENT_STOCK',
        `Not enough ${product.name} in stock (on hand ${product.onHand.toString()}, needed ${move.quantity.negated().toString()})`,
      );
    }
    await tx.stockMove.create({
      data: {
        productId: move.productId,
        quantity: move.quantity,
        type: move.type,
        reference: move.reference,
        operationId: move.operationId ?? null,
        userId: move.userId,
      },
    });
    await tx.product.update({ where: { id: move.productId }, data: { onHand: next } });
    await logAudit(
      tx,
      { userId: move.userId, module: 'STOCK', recordType: 'Product', recordId: product.id, reference: product.name },
      'UPDATE',
      { field: 'onHand', oldValue: product.onHand, newValue: next, note: `${move.type} ${move.reference}` },
    );
  }
}

/** On hand, reserved (open sales lines + open MO components) and free-to-use, per product. */
export async function getLevels(db: Db, productIds?: number[]): Promise<Map<number, StockLevel>> {
  const products = await db.product.findMany({
    where: productIds ? { id: { in: productIds } } : undefined,
    select: { id: true, onHand: true },
  });
  const ids = products.map((p) => p.id);
  const reservedRows =
    ids.length === 0
      ? []
      : await db.$queryRaw<{ productId: number; reserved: Prisma.Decimal }[]>`
    SELECT r."productId", SUM(r.qty) AS reserved FROM (
      SELECT l."productId", (l.quantity - l."deliveredQty") AS qty
      FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
      WHERE o.status IN ('CONFIRMED', 'PARTIALLY_DELIVERED') AND l."productId" = ANY(${ids}::int[])
      UNION ALL
      SELECT c."productId", (c."toConsume" - c.consumed) AS qty
      FROM "MoComponent" c JOIN "ManufacturingOrder" m ON m.id = c."moId"
      WHERE m.status IN ('CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE') AND c."productId" = ANY(${ids}::int[])
    ) r GROUP BY r."productId"`;
  const reservedBy = new Map(reservedRows.map((r) => [r.productId, new Prisma.Decimal(r.reserved)]));
  const result = new Map<number, StockLevel>();
  for (const p of products) {
    const reserved = reservedBy.get(p.id) ?? ZERO;
    result.set(p.id, { onHand: p.onHand, reserved, free: p.onHand.minus(reserved) });
  }
  return result;
}

export async function levelOf(db: Db, productId: number): Promise<StockLevel> {
  const level = (await getLevels(db, [productId])).get(productId);
  if (!level) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return level;
}

export async function ledgerSumMatchesOnHand(db: Db): Promise<boolean> {
  const rows = await db.$queryRaw<{ mismatches: bigint }[]>`
    SELECT COUNT(*) AS mismatches FROM "Product" p
    LEFT JOIN (SELECT "productId", SUM(quantity) AS total FROM "StockMove" GROUP BY "productId") s ON s."productId" = p.id
    WHERE p."onHand" <> COALESCE(s.total, 0)`;
  return Number(rows[0]?.mismatches ?? 1) === 0;
}
