import type { Db } from './prisma';

export type UserRef = { id: number; name: string } | null;

/** id → {id, name} for the given user ids (unknown ids map to null). */
export async function userRefs(db: Db, ids: (number | null | undefined)[]): Promise<(id: number | null | undefined) => UserRef> {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
  const users = unique.length
    ? await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return (id) => (typeof id === 'number' ? byId.get(id) ?? null : null);
}
