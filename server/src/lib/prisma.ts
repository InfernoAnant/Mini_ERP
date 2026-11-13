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
