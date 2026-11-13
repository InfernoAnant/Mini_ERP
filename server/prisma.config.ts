import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Read softly: `prisma generate` (npm postinstall, CI lint, Docker build) needs no database.
    // Commands that connect (migrate, seed) still fail clearly when it is missing.
    url: process.env.DATABASE_URL ?? '',
  },
});
