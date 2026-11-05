import type { AccessLevel, Module, OperationType } from '@prisma/client';
import { AppError } from '../lib/errors';
import type { AuthUser } from '../services/auth.service';

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'confirm' | 'cancel' | 'operate' | 'adjust';

const ALL: Action[] = ['view', 'create', 'edit', 'delete', 'confirm', 'cancel', 'operate', 'adjust'];
/** USER level (spec §3, from the mockup's User Management matrix). "edit" is limited, see assertCanEdit. */
const USER_DEFAULT: Action[] = ['view', 'create', 'edit', 'operate'];

/** What each access level allows, per module. */
const MATRIX: Record<Module, Record<Exclude<AccessLevel, 'NONE'>, Action[]>> = {
  SALES: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  PURCHASE: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  MANUFACTURING: { ADMIN: ALL.filter((a) => a !== 'adjust'), USER: USER_DEFAULT },
  BOM: { ADMIN: ['view', 'create', 'edit', 'delete'], USER: ['view'] },
  PRODUCTS: { ADMIN: ['view', 'create', 'edit', 'delete', 'adjust'], USER: ['view', 'create', 'edit'] },
};

export function can(user: AuthUser, module: Module, action: Action): boolean {
  if (user.readOnly) return action === 'view' && (user.isSystemAdmin || user.access[module] !== 'NONE');
  if (user.isSystemAdmin) return true;
  const level = user.access[module];
  if (level === 'NONE') return false;
  return MATRIX[module][level].includes(action);
}

export function assertCan(user: AuthUser, module: Module, action: Action): void {
  if (!can(user, module, action)) {
    throw new AppError(403, 'FORBIDDEN', `You don't have permission to ${action} in ${module.toLowerCase()}`);
  }
}

/** Shared lookup data (product/contact/user/BoM dropdowns) needs access to at least one module (spec §3: NONE → 403). */
export function assertAnyModuleAccess(user: AuthUser): void {
  const any = user.isSystemAdmin || Object.values(user.access).some((level) => level !== 'NONE');
  if (!any) throw new AppError(403, 'FORBIDDEN', "You don't have access to any module yet");
}

/** ADMIN may edit anything; USER only their own DRAFT (or status-less) records. */
export function assertCanEdit(user: AuthUser, module: Module, record: { status?: string; createdById: number }): void {
  assertCan(user, module, 'edit');
  if (user.isSystemAdmin || user.access[module] === 'ADMIN') return;
  const ownDraft = record.createdById === user.id && (record.status === undefined || record.status === 'DRAFT');
  if (!ownDraft) {
    throw new AppError(403, 'FORBIDDEN', `You don't have permission to edit this record in ${module.toLowerCase()}`);
  }
}

const OPERATION_MODULE: Record<OperationType, Module> = {
  DELIVERY: 'SALES',
  RECEIPT: 'PURCHASE',
  PRODUCTION: 'MANUFACTURING',
  ADJUSTMENT: 'PRODUCTS',
};

export function operationModule(type: OperationType): Module {
  return OPERATION_MODULE[type];
}

/** Spec §5a: only a supervisor or manager confirms/rejects stock operations. */
export function canConfirmOperation(user: AuthUser, type: OperationType): boolean {
  if (user.readOnly) return false;
  if (user.isSystemAdmin) return true;
  if (user.access.PRODUCTS === 'ADMIN') return true; // inventory manager supervises all stock
  if (type === 'ADJUSTMENT') return false;
  return user.access[OPERATION_MODULE[type]] === 'ADMIN';
}

/** Placing an operation: USER level on the related module ("operate"), adjustments need Products ADMIN. */
export function canPlaceOperation(user: AuthUser, type: OperationType): boolean {
  if (type === 'ADJUSTMENT') return can(user, 'PRODUCTS', 'adjust');
  return can(user, OPERATION_MODULE[type], 'operate');
}
