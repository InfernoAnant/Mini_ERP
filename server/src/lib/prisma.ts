import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaClient;

/** Interactive transaction with generous limits (row locks can wait). */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 20000, maxWait: 10000 });
}
