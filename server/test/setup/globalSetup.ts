import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

export default function setup(): void {
  const parsed = dotenv.config({ path: path.resolve(__dirname, '../../.env.test') }).parsed ?? {};
  if (!parsed.DATABASE_URL) throw new Error('server/.env.test must define DATABASE_URL');
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: parsed.DATABASE_URL },
    stdio: 'pipe',
  });
}
