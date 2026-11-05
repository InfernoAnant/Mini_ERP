import type { AccessLevel, Module } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { type AuthUser, loadAuthUser } from '../services/auth.service';
import { createBom } from '../services/bom.service';
import { completeWorkOrder, confirmMo, createMo } from '../services/manufacturing.service';
import { confirmOperation, placeOperation } from '../services/operations.service';
import { createProduct, updateProduct } from '../services/products.service';
import { cancelPurchase, confirmPurchase, createPurchase } from '../services/purchase.service';
import { cancelSales, confirmSales, createSales } from '../services/sales.service';

/** Shared demo password (demo accounts log in with one click; this is only for manual login). */
export const DEMO_PASSWORD = 'Demo@1234';

type DemoUser = {
  loginId: string;
  name: string;
  position: string;
  isSystemAdmin?: boolean;
  readOnly?: boolean;
  access: Partial<Record<Module, AccessLevel>>;
};

export const DEMO_USERS: DemoUser[] = [
  { loginId: 'sysadmin', name: 'Admin', position: 'System Administrator', isSystemAdmin: true, access: {} },
  { loginId: 'salesuser', name: 'Amit Sharma', position: 'Sales Manager', access: { SALES: 'ADMIN', PRODUCTS: 'USER' } },
  { loginId: 'purchaser', name: 'Neha Verma', position: 'Purchase Manager', access: { PURCHASE: 'ADMIN', PRODUCTS: 'USER' } },
  { loginId: 'mfguser', name: 'Meera Singh', position: 'Production Head', access: { MANUFACTURING: 'ADMIN', BOM: 'ADMIN', PRODUCTS: 'USER' } },
  {
    loginId: 'invmanager',
    name: 'Ravi Patel',
    position: 'Inventory Manager',
    access: { PRODUCTS: 'ADMIN', SALES: 'USER', PURCHASE: 'USER', MANUFACTURING: 'USER', BOM: 'USER' },
  },
  {
    loginId: 'bizowner',
    name: 'Shiv Kumar',
    position: 'Owner',
    readOnly: true,
    access: { SALES: 'ADMIN', PURCHASE: 'ADMIN', MANUFACTURING: 'ADMIN', BOM: 'ADMIN', PRODUCTS: 'ADMIN' },
  },
];

const DAY = 86400000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

async function asUser(loginId: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { loginId } });
  const auth = await loadAuthUser(u.id);
  if (!auth) throw new Error(`demo user ${loginId} missing`);
  return auth;
}

/**
 * Fills an EMPTY database with the Shiv Furniture demo. Goes through the real services so the
 * ledger, reservations and audit log are genuine. Nothing here touches Wooden Legs, Wooden Top or
 * Wooden Table stock, so the README demo script always produces the same numbers.
 */
export async function seedDemo(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of DEMO_USERS) {
    await prisma.user.create({
      data: {
        loginId: u.loginId,
        email: `${u.loginId}@shivfurniture.demo`,
        passwordHash,
        name: u.name,
        position: u.position,
        isSystemAdmin: u.isSystemAdmin ?? false,
        readOnly: u.readOnly ?? false,
        isDemoLocked: true,
        address: 'Shiv Furniture Works, Ahmedabad',
        access: { create: Object.entries(u.access).map(([module, level]) => ({ module: module as Module, level: level as AccessLevel })) },
      },
    });
  }
  const admin = await asUser('sysadmin');
  const sales = await asUser('salesuser');
  const purchaser = await asUser('purchaser');
  const mfg = await asUser('mfguser');
  const inventory = await asUser('invmanager');

  const [assembly, paint, pack] = await Promise.all(
    ['Assembly Line', 'Paint Floor', 'Packaging Unit'].map((name) => prisma.workCenter.create({ data: { name } })),
  );
  const contact = (name: string, type: 'CUSTOMER' | 'VENDOR', address: string) => prisma.contact.create({ data: { name, type, address } });
  const timber = await contact('Timber Traders', 'VENDOR', 'Plot 12, GIDC Naroda, Ahmedabad');
  const hardware = await contact('Hardware Hub', 'VENDOR', '45 Lohar Chawl, Mumbai');
  const seating = await contact('Comfort Seating Co.', 'VENDOR', 'Sector 63, Noida');
  const suzuki = await contact('Suzuki India', 'CUSTOMER', 'Hansalpur, Gujarat');
  const mrf = await contact('MRF Ltd.', 'CUSTOMER', 'Greams Road, Chennai');
  const taj = await contact('Taj Hotels', 'CUSTOMER', 'Apollo Bunder, Mumbai');
  const infosys = await contact('Infosys Pune', 'CUSTOMER', 'Hinjawadi Phase 1, Pune');

  const raw = (name: string, cost: number, stock: number, vendorId: number) =>
    createProduct(admin, {
      name,
      salesPrice: Math.round(cost * 1.4),
      costPrice: cost,
      initialStock: stock,
      procureOnDemand: true,
      procurementType: 'PURCHASE',
      vendorId,
    });
  const legs = await raw('Wooden Legs', 150, 20, timber.id);
  const top = await raw('Wooden Top', 900, 3, timber.id);
  const diningTop = await raw('Dining Table Top', 2500, 2, timber.id);
  const panel = await raw('Wooden Panel', 400, 10, timber.id);
  const screws = await raw('Screws', 2, 500, hardware.id);

  const finished = (name: string, salesPrice: number, costPrice: number, stock: number) =>
    createProduct(admin, { name, salesPrice, costPrice, initialStock: stock });
  const table = await finished('Wooden Table', 4500, 2500, 2);
  const dining = await finished('Dining Table', 12000, 7000, 5);
  const shelf = await finished('Bookshelf', 6000, 3500, 4);
  const officeChair = await createProduct(admin, {
    name: 'Office Chair',
    salesPrice: 3500,
    costPrice: 2000,
    initialStock: 3,
    procureOnDemand: true,
    procurementType: 'PURCHASE',
    vendorId: seating.id,
  });
  const woodenChair = await finished('Wooden Chair', 2000, 1100, 100);

  const ops = (assemblyMin: number, withPaint: boolean, packMin: number) => [
    { name: 'Assembly', workCenterId: assembly!.id, durationMinutes: assemblyMin },
    ...(withPaint ? [{ name: 'Painting', workCenterId: paint!.id, durationMinutes: 30 }] : []),
    { name: 'Packing', workCenterId: pack!.id, durationMinutes: packMin },
  ];
  const tableBom = await createBom(mfg, {
    productId: table.id,
    outputQty: 1,
    components: [
      { productId: legs.id, quantity: 4 },
      { productId: top.id, quantity: 1 },
      { productId: screws.id, quantity: 12 },
    ],
    operations: ops(60, true, 20),
  });
  const diningBom = await createBom(mfg, {
    productId: dining.id,
    outputQty: 1,
    components: [
      { productId: legs.id, quantity: 4 },
      { productId: diningTop.id, quantity: 1 },
      { productId: screws.id, quantity: 16 },
    ],
    operations: ops(90, true, 30),
  });
  const shelfBom = await createBom(mfg, {
    productId: shelf.id,
    outputQty: 1,
    components: [
      { productId: panel.id, quantity: 5 },
      { productId: screws.id, quantity: 20 },
    ],
    operations: ops(45, false, 15),
  });
  for (const [product, bom] of [
    [table, tableBom],
    [dining, diningBom],
    [shelf, shelfBom],
  ] as const) {
    await updateProduct(admin, product.id, { procureOnDemand: true, procurementType: 'MANUFACTURING', defaultBomId: bom.id });
  }

  // ---------- history ----------
  const backdate = async (model: 'salesOrder' | 'purchaseOrder' | 'manufacturingOrder', id: number, days: number) => {
    const createdAt = daysFromNow(-days);
    if (model === 'salesOrder') await prisma.salesOrder.update({ where: { id }, data: { createdAt, confirmedAt: createdAt } });
    if (model === 'purchaseOrder') await prisma.purchaseOrder.update({ where: { id }, data: { createdAt } });
    if (model === 'manufacturingOrder') await prisma.manufacturingOrder.update({ where: { id }, data: { createdAt } });
  };
  const confirmAll = async (placed: { id: number }, by: AuthUser) => confirmOperation(by, placed.id);

  // Sales: fully delivered, partially delivered, late, draft, cancelled.
  const so1 = await createSales(sales, { customerId: taj.id, scheduledDate: daysFromNow(-8), lines: [{ productId: woodenChair.id, quantity: 20 }] });
  await confirmSales(sales, so1.id);
  await confirmAll(await placeOperation(sales, { type: 'DELIVERY', salesOrderId: so1.id, lines: [{ salesOrderLineId: so1.lines[0]!.id, quantity: 20 }] }), sales);
  await backdate('salesOrder', so1.id, 12);

  const so2 = await createSales(sales, { customerId: infosys.id, scheduledDate: daysFromNow(4), lines: [{ productId: woodenChair.id, quantity: 30 }] });
  await confirmSales(sales, so2.id);
  await confirmAll(await placeOperation(sales, { type: 'DELIVERY', salesOrderId: so2.id, lines: [{ salesOrderLineId: so2.lines[0]!.id, quantity: 10 }] }), inventory);
  await backdate('salesOrder', so2.id, 5);

  const so3 = await createSales(sales, { customerId: mrf.id, scheduledDate: daysFromNow(-3), lines: [{ productId: shelf.id, quantity: 2 }] });
  await confirmSales(sales, so3.id);
  await backdate('salesOrder', so3.id, 7);

  await createSales(sales, { customerId: suzuki.id, scheduledDate: daysFromNow(10), lines: [{ productId: woodenChair.id, quantity: 5 }] });
  const so5 = await createSales(sales, { customerId: taj.id, lines: [{ productId: officeChair.id, quantity: 1 }] });
  await cancelSales(sales, so5.id);

  // Purchase: fully received, partially received, confirmed with a receipt awaiting confirmation, draft, cancelled.
  const po1 = await createPurchase(purchaser, { vendorId: hardware.id, expectedDate: daysFromNow(-6), lines: [{ productId: screws.id, quantity: 200 }] });
  await confirmPurchase(purchaser, po1.id);
  await confirmAll(await placeOperation(purchaser, { type: 'RECEIPT', purchaseOrderId: po1.id, lines: [{ purchaseOrderLineId: po1.lines[0]!.id, quantity: 200 }] }), inventory);
  await backdate('purchaseOrder', po1.id, 9);

  const po2 = await createPurchase(purchaser, { vendorId: timber.id, expectedDate: daysFromNow(-1), lines: [{ productId: panel.id, quantity: 20 }] });
  await confirmPurchase(purchaser, po2.id);
  await confirmAll(await placeOperation(purchaser, { type: 'RECEIPT', purchaseOrderId: po2.id, lines: [{ purchaseOrderLineId: po2.lines[0]!.id, quantity: 10 }] }), purchaser);
  await backdate('purchaseOrder', po2.id, 6);

  const po3 = await createPurchase(purchaser, { vendorId: seating.id, expectedDate: daysFromNow(2), lines: [{ productId: officeChair.id, quantity: 5 }] });
  await confirmPurchase(purchaser, po3.id);
  await placeOperation(purchaser, { type: 'RECEIPT', purchaseOrderId: po3.id, lines: [{ purchaseOrderLineId: po3.lines[0]!.id, quantity: 5 }] });
  await backdate('purchaseOrder', po3.id, 3);

  await createPurchase(purchaser, { vendorId: hardware.id, expectedDate: daysFromNow(7), lines: [{ productId: screws.id, quantity: 100 }] });
  const po5 = await createPurchase(purchaser, { vendorId: timber.id, lines: [{ productId: diningTop.id, quantity: 2 }] });
  await cancelPurchase(purchaser, po5.id);

  // Manufacturing: one done, one in progress.
  const mo1 = await createMo(mfg, { productId: shelf.id, quantity: 2, bomId: shelfBom.id, assigneeId: mfg.id, deadline: daysFromNow(-2) });
  const mo1c = await confirmMo(mfg, mo1.id);
  for (const wo of mo1c.order.workOrders) await completeWorkOrder(mfg, mo1.id, wo.id, wo.expectedMinutes + 5);
  await confirmAll(await placeOperation(mfg, { type: 'PRODUCTION', manufacturingOrderId: mo1.id }), mfg);
  await backdate('manufacturingOrder', mo1.id, 4);

  const mo2 = await createMo(mfg, { productId: shelf.id, quantity: 3, bomId: shelfBom.id, assigneeId: mfg.id, deadline: daysFromNow(3) });
  const mo2c = await confirmMo(mfg, mo2.id);
  const firstWo = mo2c.order.workOrders[0];
  if (firstWo) await completeWorkOrder(mfg, mo2.id, firstWo.id, firstWo.expectedMinutes - 10);
  await backdate('manufacturingOrder', mo2.id, 1);
}
