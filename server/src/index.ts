import 'dotenv/config';
import { createApp } from './app';
import { maybeAutoSeed } from './services/demo.service';

const port = Number(process.env.PORT ?? 5000);
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

async function main(): Promise<void> {
  if (await maybeAutoSeed()) console.log('AUTO_SEED: loaded the Shiv Furniture demo data');
  const server = createApp().listen(port, () => {
    console.log(`Mini ERP API listening on http://localhost:${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
