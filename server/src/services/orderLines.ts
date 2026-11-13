import { Prisma } from '../generated/prisma/client.js';
import { z } from 'zod';
import { dec, ZERO } from '../lib/decimal.js';
import { AppError } from '../lib/errors.js';

/** Shared line shape for sales and purchase order inputs. */
export const lineInputSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(1e7),
  price: z.coerce.number().min(0).max(1e9).optional(),
});
export type LineInput = z.infer<typeof lineInputSchema>;

export type ExistingLine = { id: number; productId: number; quantity: Prisma.Decimal; done: Prisma.Decimal };

export type LinePlan = {
  creates: { productId: number; quantity: Prisma.Decimal; price?: number }[];
  updates: { id: number; productId: number; quantity: Prisma.Decimal; price?: number }[];
  deletes: number[];
  /** Per product: how much the ordered quantity went up (for re-procurement). */
  increases: { productId: number; quantity: Prisma.Decimal }[];
};

/**
 * Validate an edit of order lines. After confirmation, a line can never drop below what is
 * already done (delivered/received) plus what is pending in placed stock operations.
 */
export function planLineEdits(
  existing: ExistingLine[],
  input: LineInput[],
  pending: Map<number, Prisma.Decimal>,
  doneWord: 'delivered' | 'received',
): LinePlan {
  const byId = new Map(existing.map((l) => [l.id, l]));
  const plan: LinePlan = { creates: [], updates: [], deletes: [], increases: [] };
  const kept = new Set<number>();
  for (const line of input) {
    const qty = dec(line.quantity);
    if (line.id === undefined) {
      plan.creates.push({ productId: line.productId, quantity: qty, price: line.price });
      plan.increases.push({ productId: line.productId, quantity: qty });
      continue;
    }
    const old = byId.get(line.id);
    if (!old) throw new AppError(400, 'VALIDATION_ERROR', `Line ${line.id} does not belong to this order`);
    kept.add(old.id);
    const committed = old.done.plus(pending.get(old.id) ?? ZERO);
    if (old.productId !== line.productId && committed.greaterThan(0)) {
      throw new AppError(409, 'QTY_BELOW_COMMITTED', `Can't change the product on a line that is already ${doneWord} or pending`);
    }
    if (qty.lessThan(committed)) {
      throw new AppError(
        409,
        'QTY_BELOW_COMMITTED',
        `Quantity can't be less than what is already ${doneWord} or pending (${committed.toString()})`,
      );
    }
    plan.updates.push({ id: old.id, productId: line.productId, quantity: qty, price: line.price });
    if (old.productId !== line.productId) {
      plan.increases.push({ productId: line.productId, quantity: qty });
    } else if (qty.greaterThan(old.quantity)) {
      plan.increases.push({ productId: line.productId, quantity: qty.minus(old.quantity) });
    }
  }
  for (const old of existing) {
    if (kept.has(old.id)) continue;
    const committed = old.done.plus(pending.get(old.id) ?? ZERO);
    if (committed.greaterThan(0)) {
      throw new AppError(409, 'QTY_BELOW_COMMITTED', `Can't remove a line that is already ${doneWord} or pending`);
    }
    plan.deletes.push(old.id);
  }
  return plan;
}

/** After lines change on an in-flight order: none done → base, all done → full, else partial. */
export function progressStatus<S extends string>(
  lines: { quantity: Prisma.Decimal; done: Prisma.Decimal }[],
  base: S,
  partial: S,
  full: S,
): S {
  const anyDone = lines.some((l) => l.done.greaterThan(0));
  const allDone = lines.length > 0 && lines.every((l) => l.done.greaterThanOrEqualTo(l.quantity));
  if (allDone) return full;
  return anyDone ? partial : base;
}

export function lineTotal(qty: Prisma.Decimal, price: Prisma.Decimal): Prisma.Decimal {
  return qty.times(price);
}
