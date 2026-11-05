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

import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';

let sharedApp: Express | null = null;
export function app(): Express {
  sharedApp ??= createApp();
  return sharedApp;
}

/** A supertest agent logged in as the given user (cookie kept between calls). */
export async function agentFor(user: User): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app());
  const res = await agent.post('/api/auth/login').send({ loginId: user.loginId, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${user.loginId}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

import type { Contact, ContactType, Product } from '@prisma/client';

let fixtureCounter = 0;

export async function makeContact(type: ContactType, name?: string): Promise<Contact> {
  fixtureCounter += 1;
  return prisma.contact.create({ data: { type, name: name ?? `${type} ${fixtureCounter}`, address: 'Somewhere 1' } });
}

/** Product with onHand set directly AND a matching ADJUSTMENT ledger row (keeps ledger == onHand). */
export async function makeProduct(opts: {
  name?: string;
  onHand?: number | string;
  salesPrice?: number;
  costPrice?: number;
  procureOnDemand?: boolean;
  procurementType?: 'PURCHASE' | 'MANUFACTURING';
  vendorId?: number;
  createdById?: number;
} = {}): Promise<Product> {
  fixtureCounter += 1;
  const onHand = String(opts.onHand ?? 0);
  const product = await prisma.product.create({
    data: {
      name: opts.name ?? `Product ${fixtureCounter}`,
      salesPrice: opts.salesPrice ?? 100,
      costPrice: opts.costPrice ?? 60,
      onHand,
      procureOnDemand: opts.procureOnDemand ?? false,
      procurementType: opts.procurementType ?? null,
      vendorId: opts.vendorId ?? null,
      createdById: opts.createdById ?? 0,
    },
  });
  if (Number(onHand) !== 0) {
    await prisma.stockMove.create({
      data: { productId: product.id, quantity: onHand, type: 'ADJUSTMENT', reference: 'FIXTURE', userId: 0 },
    });
  }
  return product;
}
