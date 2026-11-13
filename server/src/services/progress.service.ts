import type { MoStatus, Prisma, PurchaseStatus, SalesStatus } from '@prisma/client';
import { ZERO } from '../lib/decimal';

/** Game-style "level-up" progress of an order: 4 levels, 25% each, the current level partly filled. */
export type Progress = {
  level: 0 | 1 | 2 | 3 | 4;
  percent: number;
  stage: string;
  stages: string[];
  cancelled: boolean;
  complete: boolean;
};

export const SALES_STAGES = ['Draft', 'Confirmed', 'Supplied', 'Delivered'];
export const PURCHASE_STAGES = ['Draft', 'Confirmed', 'Receiving', 'Received'];
export const MO_STAGES = ['Draft', 'Confirmed', 'In production', 'Done'];

const PROCUREMENT_DONE = ['DONE', 'FULLY_RECEIVED'];

function at(stages: string[], level: 1 | 2 | 3 | 4, fraction = 1): Progress {
  const f = Math.max(0, Math.min(1, fraction));
  // Only a finished level 4 is 100%: an unfinished fill never rounds up to "complete".
  const raw = Math.round(25 * (level - 1) + 25 * f);
  const percent = level === 4 && f === 1 ? 100 : Math.min(99, raw);
  return { level, percent, stage: stages[level - 1] ?? '', stages, cancelled: false, complete: percent === 100 };
}

function cancelled(stages: string[]): Progress {
  return { level: 0, percent: 0, stage: 'Cancelled', stages, cancelled: true, complete: false };
}

function ratio(done: Prisma.Decimal, total: Prisma.Decimal): number {
  return total.isZero() ? 0 : done.dividedBy(total).toNumber();
}

const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), ZERO);

export function salesProgress(o: {
  status: SalesStatus;
  lines: { quantity: Prisma.Decimal; deliveredQty: Prisma.Decimal; available: boolean }[];
  procurementStatuses: string[];
}): Progress {
  if (o.status === 'CANCELLED') return cancelled(SALES_STAGES);
  if (o.status === 'DRAFT') return at(SALES_STAGES, 1);
  if (o.status === 'FULLY_DELIVERED') return at(SALES_STAGES, 4);
  const delivered = sum(o.lines.map((l) => l.deliveredQty));
  if (o.status === 'PARTIALLY_DELIVERED' || delivered.greaterThan(0)) {
    return at(SALES_STAGES, 4, ratio(delivered, sum(o.lines.map((l) => l.quantity))));
  }
  const allAvailable = o.lines.length > 0 && o.lines.every((l) => l.available);
  const procuredAll = o.procurementStatuses.length > 0 && o.procurementStatuses.every((s) => PROCUREMENT_DONE.includes(s));
  return allAvailable || procuredAll ? at(SALES_STAGES, 3) : at(SALES_STAGES, 2);
}

export function purchaseProgress(o: {
  status: PurchaseStatus;
  lines: { quantity: Prisma.Decimal; receivedQty: Prisma.Decimal }[];
}): Progress {
  if (o.status === 'CANCELLED') return cancelled(PURCHASE_STAGES);
  if (o.status === 'DRAFT') return at(PURCHASE_STAGES, 1);
  if (o.status === 'FULLY_RECEIVED') return at(PURCHASE_STAGES, 4);
  const received = sum(o.lines.map((l) => l.receivedQty));
  if (o.status === 'PARTIALLY_RECEIVED' || received.greaterThan(0)) {
    return at(PURCHASE_STAGES, 3, ratio(received, sum(o.lines.map((l) => l.quantity))));
  }
  return at(PURCHASE_STAGES, 2);
}

export function moProgress(o: { status: MoStatus; workOrders: { status: 'PENDING' | 'DONE' }[] }): Progress {
  if (o.status === 'CANCELLED') return cancelled(MO_STAGES);
  if (o.status === 'DRAFT') return at(MO_STAGES, 1);
  if (o.status === 'DONE') return at(MO_STAGES, 4);
  if (o.status === 'CONFIRMED') return at(MO_STAGES, 2);
  const total = o.workOrders.length;
  const done = o.workOrders.filter((w) => w.status === 'DONE').length;
  return at(MO_STAGES, 3, total === 0 ? 0.5 : done / total);
}
