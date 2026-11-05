import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
process.env.JWT_SECRET ??= 'test-secret';

import { afterAll } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { closeServer } from '../helpers';

// Each test file gets a fresh module registry (and PrismaClient); close it so engines don't pile up.
afterAll(async () => {
  await closeServer();
  await prisma.$disconnect();
});
