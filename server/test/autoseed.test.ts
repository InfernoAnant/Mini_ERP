import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { maybeAutoSeed } from '../src/services/demo.service.js';
import { makeUser, resetDb } from './helpers.js';

describe('AUTO_SEED on start', () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.AUTO_SEED;
  });

  it('seeds an empty database when AUTO_SEED=true', async () => {
    process.env.AUTO_SEED = 'true';
    expect(await maybeAutoSeed()).toBe(true);
    expect(await prisma.user.count()).toBe(6);
    expect(await prisma.product.count()).toBeGreaterThan(0);
  });

  it('does nothing when users already exist', async () => {
    process.env.AUTO_SEED = 'true';
    await makeUser();
    expect(await maybeAutoSeed()).toBe(false);
    expect(await prisma.user.count()).toBe(1);
  });

  it('does nothing when AUTO_SEED is not set', async () => {
    expect(await maybeAutoSeed()).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });
});
