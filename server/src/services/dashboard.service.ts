import type { Prisma } from '../generated/prisma/client.js';
import { can } from '../config/permissions.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from './auth.service.js';
import { MO_RESERVING } from './manufacturing.service.js';
import { countAwaiting } from './operations.service.js';
import { SO_OPEN } from './sales.service.js';
import { getLevels } from './stock.service.js';

type Counts = Record<string, number>;
type Section = { all: Counts; my: Counts; late: number; myLate: number };

const SALES_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED', 'CANCELLED'];
const PURCHASE_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'];
const MO_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED'];

function toCounts(statuses: string[], rows: { status: string; _count: { _all: number } }[]): Counts {
  const out: Counts = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

async function salesSection(user: AuthUser): Promise<Section> {
  const mine: Prisma.SalesOrderWhereInput = { OR: [{ salespersonId: user.id }, { createdById: user.id }] };
  const late: Prisma.SalesOrderWhereInput = { status: { in: SO_OPEN }, scheduledDate: { lt: new Date() } };
  const [all, my, lateAll, lateMine] = await Promise.all([
    prisma.salesOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.salesOrder.groupBy({ by: ['status'], where: mine, _count: { _all: true } }),
    prisma.salesOrder.count({ where: late }),
    prisma.salesOrder.count({ where: { AND: [late, mine] } }),
  ]);
  return { all: toCounts(SALES_STATUSES, all), my: toCounts(SALES_STATUSES, my), late: lateAll, myLate: lateMine };
}

async function purchaseSection(user: AuthUser): Promise<Section> {
  const mine: Prisma.PurchaseOrderWhereInput = { OR: [{ responsibleId: user.id }, { createdById: user.id }] };
  const late: Prisma.PurchaseOrderWhereInput = {
    status: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] },
    expectedDate: { lt: new Date() },
  };
  const [all, my, lateAll, lateMine] = await Promise.all([
    prisma.purchaseOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.purchaseOrder.groupBy({ by: ['status'], where: mine, _count: { _all: true } }),
    prisma.purchaseOrder.count({ where: late }),
    prisma.purchaseOrder.count({ where: { AND: [late, mine] } }),
  ]);
  return { all: toCounts(PURCHASE_STATUSES, all), my: toCounts(PURCHASE_STATUSES, my), late: lateAll, myLate: lateMine };
}

async function moSection(user: AuthUser): Promise<Section> {
  const mine: Prisma.ManufacturingOrderWhereInput = { assigneeId: user.id };
  const late: Prisma.ManufacturingOrderWhereInput = { status: { in: MO_RESERVING }, deadline: { lt: new Date() } };
  const [all, my, lateAll, lateMine] = await Promise.all([
    prisma.manufacturingOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.manufacturingOrder.groupBy({ by: ['status'], where: mine, _count: { _all: true } }),
    prisma.manufacturingOrder.count({ where: late }),
    prisma.manufacturingOrder.count({ where: { AND: [late, mine] } }),
  ]);
  return { all: toCounts(MO_STATUSES, all), my: toCounts(MO_STATUSES, my), late: lateAll, myLate: lateMine };
}

export async function getDashboard(user: AuthUser) {
  const [sales, purchase, manufacturing, awaitingConfirmation, shortages] = await Promise.all([
    can(user, 'SALES', 'view') ? salesSection(user) : null,
    can(user, 'PURCHASE', 'view') ? purchaseSection(user) : null,
    can(user, 'MANUFACTURING', 'view') ? moSection(user) : null,
    countAwaiting(user),
    can(user, 'PRODUCTS', 'view') ? shortageList() : [],
  ]);
  return { sales, purchase, manufacturing, awaitingConfirmation, shortages };
}

/** Products whose free-to-use is negative, most short first (max 10). */
async function shortageList() {
  const levels = await getLevels(prisma);
  const short = [...levels.entries()]
    .filter(([, l]) => l.free.isNegative())
    .sort((a, b) => a[1].free.comparedTo(b[1].free))
    .slice(0, 10);
  const products = await prisma.product.findMany({
    where: { id: { in: short.map(([id]) => id) } },
    select: { id: true, name: true },
  });
  return short.map(([id, l]) => ({
    productId: id,
    name: products.find((p) => p.id === id)?.name ?? '',
    onHand: l.onHand,
    reserved: l.reserved,
    free: l.free,
  }));
}
