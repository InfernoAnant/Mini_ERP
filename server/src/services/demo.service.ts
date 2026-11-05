import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { seedDemo } from '../seed/demoData';

export { seedDemo };

const THROTTLE_MS = 15000;
let lastReset = 0;
let running = false;

/** Empty every application table and restart ids (keeps the migrations table). */
export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Restore the public demo to its seeded state. Ids restart from 1 in the same order, so existing
 * demo sessions (JWT with a user id) keep working. Throttled to one reset per 15 s.
 */
export async function resetDemo(): Promise<void> {
  const now = Date.now();
  if (running || now - lastReset < THROTTLE_MS) {
    throw new AppError(429, 'TOO_SOON', 'The demo was reset a moment ago — try again in a few seconds');
  }
  running = true;
  lastReset = now;
  try {
    await truncateAll();
    await seedDemo();
  } finally {
    running = false;
  }
}

export function __resetThrottleForTests(): void {
  lastReset = 0;
}
