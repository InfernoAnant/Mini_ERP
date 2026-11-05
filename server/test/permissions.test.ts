import type { AccessLevel, Module } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { assertCanEdit, can, canConfirmOperation } from '../src/config/permissions';
import type { AuthUser } from '../src/services/auth.service';

function user(access: Partial<Record<Module, AccessLevel>>, extra: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    loginId: 'tester1',
    name: 'Tester',
    email: 't@test.local',
    position: null,
    isSystemAdmin: false,
    readOnly: false,
    isDemoLocked: false,
    access: { SALES: 'NONE', PURCHASE: 'NONE', MANUFACTURING: 'NONE', BOM: 'NONE', PRODUCTS: 'NONE', ...access },
    ...extra,
  };
}

describe('permission matrix', () => {
  it('sales USER can create and operate but not confirm, cancel or delete', () => {
    const u = user({ SALES: 'USER' });
    expect(can(u, 'SALES', 'view')).toBe(true);
    expect(can(u, 'SALES', 'create')).toBe(true);
    expect(can(u, 'SALES', 'operate')).toBe(true);
    expect(can(u, 'SALES', 'confirm')).toBe(false);
    expect(can(u, 'SALES', 'cancel')).toBe(false);
    expect(can(u, 'SALES', 'delete')).toBe(false);
  });

  it('bom USER can view but not edit', () => {
    const u = user({ BOM: 'USER' });
    expect(can(u, 'BOM', 'view')).toBe(true);
    expect(can(u, 'BOM', 'edit')).toBe(false);
    expect(can(u, 'BOM', 'create')).toBe(false);
  });

  it('products adjust requires ADMIN', () => {
    expect(can(user({ PRODUCTS: 'USER' }), 'PRODUCTS', 'adjust')).toBe(false);
    expect(can(user({ PRODUCTS: 'ADMIN' }), 'PRODUCTS', 'adjust')).toBe(true);
  });

  it('readOnly ADMIN can only view', () => {
    const u = user({ SALES: 'ADMIN' }, { readOnly: true });
    expect(can(u, 'SALES', 'view')).toBe(true);
    expect(can(u, 'SALES', 'create')).toBe(false);
    expect(can(u, 'SALES', 'confirm')).toBe(false);
  });

  it('system admin can do everything in every module', () => {
    const u = user({}, { isSystemAdmin: true });
    for (const m of ['SALES', 'PURCHASE', 'MANUFACTURING', 'BOM', 'PRODUCTS'] as const) {
      for (const a of ['view', 'create', 'edit', 'delete', 'confirm', 'cancel', 'operate', 'adjust'] as const) {
        expect(can(u, m, a)).toBe(true);
      }
    }
  });

  it('NONE cannot view', () => {
    expect(can(user({}), 'SALES', 'view')).toBe(false);
  });

  it("USER may edit own DRAFT, not own CONFIRMED, not someone else's DRAFT", () => {
    const u = user({ SALES: 'USER' });
    expect(() => assertCanEdit(u, 'SALES', { status: 'DRAFT', createdById: 1 })).not.toThrow();
    expect(() => assertCanEdit(u, 'SALES', { status: 'CONFIRMED', createdById: 1 })).toThrow(/permission/);
    expect(() => assertCanEdit(u, 'SALES', { status: 'DRAFT', createdById: 2 })).toThrow(/permission/);
    expect(() => assertCanEdit(user({ SALES: 'ADMIN' }), 'SALES', { status: 'CONFIRMED', createdById: 2 })).not.toThrow();
  });

  it('canConfirmOperation: SALES USER false for DELIVERY, SALES ADMIN true, PRODUCTS ADMIN true for RECEIPT, PURCHASE ADMIN false for ADJUSTMENT, readOnly ADMIN false', () => {
    expect(canConfirmOperation(user({ SALES: 'USER' }), 'DELIVERY')).toBe(false);
    expect(canConfirmOperation(user({ SALES: 'ADMIN' }), 'DELIVERY')).toBe(true);
    expect(canConfirmOperation(user({ PRODUCTS: 'ADMIN' }), 'RECEIPT')).toBe(true);
    expect(canConfirmOperation(user({ PURCHASE: 'ADMIN' }), 'ADJUSTMENT')).toBe(false);
    expect(canConfirmOperation(user({ SALES: 'ADMIN' }, { readOnly: true }), 'DELIVERY')).toBe(false);
    expect(canConfirmOperation(user({ MANUFACTURING: 'ADMIN' }), 'PRODUCTION')).toBe(true);
  });
});
