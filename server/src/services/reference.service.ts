import type { Tx } from '../lib/prisma.js';

export type RefPrefix = 'SO' | 'PO' | 'MO' | 'BOM' | 'OP';

/** Atomic per-prefix counter → e.g. "SO-000001". */
export async function nextRef(tx: Tx, prefix: RefPrefix): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("prefix", "value") VALUES (${prefix}, 1)
    ON CONFLICT ("prefix") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Sequence update returned no row');
  return `${prefix}-${String(value).padStart(6, '0')}`;
}
