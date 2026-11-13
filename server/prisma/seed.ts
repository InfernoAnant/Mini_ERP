import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { seedDemo, truncateAll } from '../src/services/demo.service.js';
import '../src/services/procurement.service.js';

async function main(): Promise<void> {
  await truncateAll();
  await seedDemo();
  console.log('Seeded Shiv Furniture demo data.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
