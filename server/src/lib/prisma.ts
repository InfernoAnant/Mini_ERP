import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // Prisma 7: queries run through the node-postgres driver adapter (no native query engine).
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }) });
}

export const prisma = createClient();

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaClient;

/** Interactive transaction with generous limits (row locks can wait). */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 20000, maxWait: 10000 });
}

/**
 * Run reads one after another. A transaction is a single node-postgres connection, and overlapping
 * queries on one client are deprecated (pg 8) and removed in pg 9 — so DTO builders that may receive
 * a transaction use this instead of Promise.all.
 */
export async function sequential<T extends readonly unknown[]>(...tasks: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as T;
}
