import { beforeEach, describe, expect, it } from 'vitest';
import { dec } from '../src/lib/decimal';
import { prisma } from '../src/lib/prisma';
import { getLevels, ledgerSumMatchesOnHand, postMoves } from '../src/services/stock.service';
import { makeContact, makeProduct, makeUser, resetDb } from './helpers';

async function onHand(id: number): Promise<string> {
  return (await prisma.product.findUniqueOrThrow({ where: { id } })).onHand.toString();
}

describe('stock core', () => {
  beforeEach(resetDb);

  it('receipt of 10 then delivery of 4 leaves onHand 6 and two ledger rows', async () => {
    const p = await makeProduct();
    await prisma.$transaction((tx) =>
      postMoves(tx, [{ productId: p.id, quantity: dec(10), type: 'RECEIPT', reference: 'PO-1', userId: 1 }]),
    );
    await prisma.$transaction((tx) =>
      postMoves(tx, [{ productId: p.id, quantity: dec(-4), type: 'DELIVERY', reference: 'SO-1', userId: 1 }]),
    );
    expect(await onHand(p.id)).toBe('6');
    expect(await prisma.stockMove.count({ where: { productId: p.id } })).toBe(2);
  });

  it('delivery beyond onHand throws INSUFFICIENT_STOCK and writes nothing', async () => {
    const p = await makeProduct({ onHand: 3, name: 'Screws' });
    await expect(
      prisma.$transaction((tx) =>
        postMoves(tx, [{ productId: p.id, quantity: dec(-5), type: 'DELIVERY', reference: 'SO-1', userId: 1 }]),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409, message: expect.stringContaining('Screws') });
    expect(await onHand(p.id)).toBe('3');
    expect(await prisma.stockMove.count({ where: { productId: p.id, reference: 'SO-1' } })).toBe(0);
  });

  it('ledger sum equals onHand after mixed moves', async () => {
    const a = await makeProduct({ onHand: 5 });
    const b = await makeProduct({ onHand: '2.5' });
    await prisma.$transaction((tx) =>
      postMoves(tx, [
        { productId: a.id, quantity: dec(-1), type: 'DELIVERY', reference: 'X', userId: 1 },
        { productId: b.id, quantity: dec('0.25'), type: 'RECEIPT', reference: 'X', userId: 1 },
        { productId: a.id, quantity: dec(7), type: 'MO_PRODUCE', reference: 'X', userId: 1 },
      ]),
    );
    expect(await onHand(a.id)).toBe('11');
    expect(await onHand(b.id)).toBe('2.75');
    expect(await ledgerSumMatchesOnHand(prisma)).toBe(true);
  });

  it('reserved counts confirmed sales remaining qty and open MO components but not DRAFT or CANCELLED', async () => {
    const user = await makeUser();
    const customer = await makeContact('CUSTOMER');
    const p = await makeProduct({ onHand: 10 });
    const fg = await makeProduct();
    const bom = await prisma.bom.create({ data: { reference: 'BOM-1', productId: fg.id, createdById: user.id } });
    const so = (
      status: 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'CANCELLED',
      qty: number,
      delivered: number,
      ref: string,
    ) =>
      prisma.salesOrder.create({
        data: {
          reference: ref,
          customerId: customer.id,
          status,
          createdById: user.id,
          lines: { create: [{ productId: p.id, quantity: qty, deliveredQty: delivered, unitPrice: 1 }] },
        },
      });
    await so('CONFIRMED', 4, 0, 'SO-1');
    await so('PARTIALLY_DELIVERED', 5, 2, 'SO-2');
    await so('DRAFT', 100, 0, 'SO-3');
    await so('CANCELLED', 100, 0, 'SO-4');
    const mo = (status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE', ref: string) =>
      prisma.manufacturingOrder.create({
        data: {
          reference: ref,
          productId: fg.id,
          quantity: 1,
          bomId: bom.id,
          status,
          createdById: user.id,
          components: { create: [{ productId: p.id, toConsume: 2 }] },
        },
      });
    await mo('CONFIRMED', 'MO-1');
    await mo('IN_PROGRESS', 'MO-2');
    await mo('DRAFT', 'MO-3');
    await mo('DONE', 'MO-4');
    const level = (await getLevels(prisma, [p.id])).get(p.id);
    expect(level?.onHand.toString()).toBe('10');
    expect(level?.reserved.toString()).toBe('11'); // 4 + 3 + 2 + 2
    expect(level?.free.toString()).toBe('-1');
  });

  it('free can be negative and products without reservations get zero reserved', async () => {
    const p = await makeProduct({ onHand: 2 });
    const levels = await getLevels(prisma);
    expect(levels.get(p.id)?.reserved.toString()).toBe('0');
    expect(levels.get(p.id)?.free.toString()).toBe('2');
  });
});
