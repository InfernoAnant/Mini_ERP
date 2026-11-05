import type { AccessLevel, Module, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, notFound } from '../lib/errors';
import { paging } from '../lib/listQuery';
import { type Tx, prisma, transaction } from '../lib/prisma';
import { type AuditBase, logChanges } from './audit.service';
import { type AuthUser, MODULES, toAuthUser } from './auth.service';

const level = z.enum(['ADMIN', 'USER', 'NONE']);

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  mobile: z.string().trim().max(30).nullable().optional(),
  photoUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
});
export const adminUserSchema = profileSchema.extend({
  position: z.string().trim().max(80).nullable().optional(),
  readOnly: z.boolean().optional(),
});
export const accessSchema = z
  .object({ SALES: level, PURCHASE: level, MANUFACTURING: level, BOM: level, PRODUCTS: level })
  .partial();

const PROFILE_FIELDS = ['name', 'address', 'mobile', 'photoUrl'];
const ADMIN_FIELDS = [...PROFILE_FIELDS, 'position', 'readOnly'];

function publicUser(u: Prisma.UserGetPayload<{ include: { access: true } }>) {
  return { ...toAuthUser(u), address: u.address, mobile: u.mobile, photoUrl: u.photoUrl, createdAt: u.createdAt };
}
export type UserDTO = ReturnType<typeof publicUser>;

function base(actor: AuthUser, target: { id: number; loginId: string }): AuditBase {
  return { userId: actor.id, module: 'USERS', recordType: 'User', recordId: target.id, reference: target.loginId };
}

function assertSystemAdmin(user: AuthUser): void {
  if (!user.isSystemAdmin) throw new AppError(403, 'FORBIDDEN', 'Only the system administrator can manage users');
}

async function loadUser(db: Tx | typeof prisma, id: number) {
  const u = await db.user.findUnique({ where: { id }, include: { access: true } });
  if (!u) throw notFound('User');
  return u;
}

export async function listUsers(actor: AuthUser, q: { q?: string; page: number; pageSize: number }) {
  assertSystemAdmin(actor);
  const where: Prisma.UserWhereInput = q.q
    ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { loginId: { contains: q.q, mode: 'insensitive' } }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, include: { access: true }, orderBy: { id: 'asc' }, ...paging(q) }),
    prisma.user.count({ where }),
  ]);
  return { items: rows.map(publicUser), total, page: q.page, pageSize: q.pageSize };
}

export async function getUser(actor: AuthUser, id: number): Promise<UserDTO> {
  assertSystemAdmin(actor);
  return publicUser(await loadUser(prisma, id));
}

/** id + name of every user, for assignee/salesperson dropdowns. */
export function userOptions() {
  return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export async function getProfile(actor: AuthUser): Promise<UserDTO> {
  return publicUser(await loadUser(prisma, actor.id));
}

export async function updateProfile(actor: AuthUser, input: z.infer<typeof profileSchema>): Promise<UserDTO> {
  return transaction(async (tx) => {
    const before = await loadUser(tx, actor.id);
    const after = await tx.user.update({ where: { id: actor.id }, data: input, include: { access: true } });
    await logChanges(tx, base(actor, before), before, after, PROFILE_FIELDS);
    return publicUser(after);
  });
}

export async function adminUpdateUser(actor: AuthUser, id: number, input: z.infer<typeof adminUserSchema>): Promise<UserDTO> {
  assertSystemAdmin(actor);
  return transaction(async (tx) => {
    const before = await loadUser(tx, id);
    const changesLockedField =
      (input.readOnly !== undefined && input.readOnly !== before.readOnly) ||
      (input.position !== undefined && input.position !== before.position);
    if (before.isDemoLocked && changesLockedField) throw demoLocked();
    const after = await tx.user.update({ where: { id }, data: input, include: { access: true } });
    await logChanges(tx, base(actor, before), before, after, ADMIN_FIELDS);
    return publicUser(after);
  });
}

export async function setAccess(actor: AuthUser, id: number, access: Partial<Record<Module, AccessLevel>>): Promise<UserDTO> {
  assertSystemAdmin(actor);
  return transaction(async (tx) => {
    const before = await loadUser(tx, id);
    if (before.isDemoLocked) throw demoLocked();
    const current = toAuthUser({ ...before, isSystemAdmin: false }).access;
    const beforeMap: Record<string, string> = {};
    const afterMap: Record<string, string> = {};
    for (const m of MODULES) {
      const next = access[m];
      if (next === undefined) continue;
      await tx.userAccess.upsert({
        where: { userId_module: { userId: id, module: m } },
        create: { userId: id, module: m, level: next },
        update: { level: next },
      });
      beforeMap[`access.${m}`] = current[m];
      afterMap[`access.${m}`] = next;
    }
    const order = Object.keys(access).map((m) => `access.${m}`);
    await logChanges(tx, base(actor, before), beforeMap, afterMap, order);
    return publicUser(await loadUser(tx, id));
  });
}

function demoLocked(): AppError {
  return new AppError(409, 'DEMO_LOCKED', "Demo accounts can't be changed. Sign up to try this.");
}
