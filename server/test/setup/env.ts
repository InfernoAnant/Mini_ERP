import path from 'node:path';
import dotenv from 'dotenv';
import { afterAll } from 'vitest';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env.test'), override: true, quiet: true });
process.env.JWT_SECRET ??= 'test-secret';
if (!/test/i.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a test database (name containing "test").');
}

// Imported lazily so the client is created with the test DATABASE_URL loaded above.
afterAll(async () => {
  const { closeServer } = await import('../helpers.js');
  const { prisma } = await import('../../src/lib/prisma.js');
  await closeServer();
  await prisma.$disconnect();
});
