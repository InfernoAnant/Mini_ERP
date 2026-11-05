import type { AccessLevel, Module, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

export const TEST_PASSWORD = 'Test@1234';
const passwordHash = bcrypt.hashSync(TEST_PASSWORD, 4);
let userCounter = 0;

/** Empty every table and restart ids. */
export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export type MakeUserOpts = {
  loginId?: string;
  name?: string;
  isSystemAdmin?: boolean;
  readOnly?: boolean;
  isDemoLocked?: boolean;
  access?: Partial<Record<Module, AccessLevel>>;
};

export async function makeUser(opts: MakeUserOpts = {}): Promise<User> {
  userCounter += 1;
  const loginId = opts.loginId ?? `user${String(userCounter).padStart(4, '0')}`;
  return prisma.user.create({
    data: {
      loginId,
      email: `${loginId}@test.local`,
      passwordHash,
      name: opts.name ?? `Test ${loginId}`,
      isSystemAdmin: opts.isSystemAdmin ?? false,
      readOnly: opts.readOnly ?? false,
      isDemoLocked: opts.isDemoLocked ?? false,
      access: {
        create: Object.entries(opts.access ?? {}).map(([module, level]) => ({
          module: module as Module,
          level: level as AccessLevel,
        })),
      },
    },
  });
}
