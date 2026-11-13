// Runs Vitest. On Windows + Node 24, a Vitest worker process occasionally aborts natively
// (exit 0xC0000409) while Prisma is active — never in plain Node. When that happens and no test
// actually failed, re-run (max 2 retries) and say so. Real test failures are never retried.
import { spawnSync } from 'node:child_process';

const args = ['vitest', 'run', ...process.argv.slice(2)];
const MAX_ATTEMPTS = 3;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const res = spawnSync('npx', args, { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stdout.write(out);
  if (res.status === 0) process.exit(0);
  // eslint-disable-next-line no-control-regex -- stripping ANSI colour codes from Vitest output
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  const workerCrash = plain.includes('Worker exited unexpectedly');
  const realFailure = /\bfailed\b/.test(plain.split('\n').filter((l) => /^\s+Tests\s/.test(l)).join('\n')) || /FAIL\s/.test(plain);
  if (!workerCrash || realFailure || attempt === MAX_ATTEMPTS) process.exit(res.status ?? 1);
  console.log(`\n[run-tests] Vitest worker crashed (known Windows/Node 24 issue, no test failed) — retrying (${attempt}/${MAX_ATTEMPTS - 1})\n`);
}
