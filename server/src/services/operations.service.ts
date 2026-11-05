// Stub (Task 8). Task 11 replaces these bodies with the real place/confirm/reject logic.
import type { Prisma } from '@prisma/client';
import type { Db, Tx } from '../lib/prisma';
import type { AuthUser } from './auth.service';

export type OrderRef = { salesOrderId?: number; purchaseOrderId?: number; manufacturingOrderId?: number };

export async function rejectPendingForOrder(_tx: Tx, _user: AuthUser, _ref: OrderRef): Promise<void> {
  // no-op until Task 11
}

export async function pendingQtyByLine(_db: Db, _kind: 'sales' | 'purchase', _orderId: number): Promise<Map<number, Prisma.Decimal>> {
  return new Map();
}

export async function hasPendingOperation(_db: Db, _ref: OrderRef): Promise<boolean> {
  return false;
}

export async function operationsForOrder(_db: Db, _ref: OrderRef): Promise<unknown[]> {
  return [];
}
