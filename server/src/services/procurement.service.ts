import type { Prisma } from '@prisma/client';
import { decMax, ZERO } from '../lib/decimal';
import type { Tx } from '../lib/prisma';
import type { AuthUser } from './auth.service';
import { createDraftMoTx, setComponentProcurer } from './manufacturing.service';
import { createDraftPurchaseTx } from './purchase.service';

export type Demand = { productId: number; quantity: Prisma.Decimal; freeBefore: Prisma.Decimal };

/**
 * MTO procurement (spec §7). For each product with "procure on demand":
 *   shortage = demanded − max(freeBefore, 0)
 * so an order only ever procures its own shortfall. Creates Draft POs (one per vendor) and Draft MOs,
 * without permission checks (procurement runs as the system on behalf of `user`).
 * `freeBefore` must be computed before the demanding order's own reservation takes effect.
 */
export async function procureShortages(tx: Tx, user: AuthUser, origin: string, demands: Demand[]): Promise<string[]> {
  const merged = new Map<number, Demand>();
  for (const d of demands) {
    const prev = merged.get(d.productId);
    merged.set(d.productId, prev ? { ...prev, quantity: prev.quantity.plus(d.quantity) } : { ...d });
  }
  if (merged.size === 0) return [];
  const products = await tx.product.findMany({ where: { id: { in: [...merged.keys()] }, procureOnDemand: true } });
  const byVendor = new Map<number, { productId: number; quantity: Prisma.Decimal }[]>();
  const toManufacture: { productId: number; bomId: number; quantity: Prisma.Decimal }[] = [];
  for (const id of merged.keys()) {
    const product = products.find((p) => p.id === id);
    const demand = merged.get(id);
    if (!product || !demand) continue;
    const shortage = demand.quantity.minus(decMax(demand.freeBefore, ZERO));
    if (!shortage.greaterThan(0)) continue;
    if (product.procurementType === 'PURCHASE' && product.vendorId) {
      const list = byVendor.get(product.vendorId) ?? [];
      list.push({ productId: id, quantity: shortage });
      byVendor.set(product.vendorId, list);
    } else if (product.procurementType === 'MANUFACTURING' && product.defaultBomId) {
      toManufacture.push({ productId: id, bomId: product.defaultBomId, quantity: shortage });
    }
  }
  const created: string[] = [];
  for (const [vendorId, lines] of byVendor) {
    const po = await createDraftPurchaseTx(tx, user, {
      vendorId,
      origin,
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber() })),
    });
    created.push(po.reference);
  }
  for (const m of toManufacture) {
    const mo = await createDraftMoTx(tx, user, { productId: m.productId, bomId: m.bomId, quantity: m.quantity.toNumber(), origin });
    created.push(mo.reference);
  }
  return created;
}

setComponentProcurer(procureShortages);
