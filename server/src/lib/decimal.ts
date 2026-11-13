import { Prisma } from '../generated/prisma/client.js';

export type Dec = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);

export function dec(v: number | string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

export function decMax(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.greaterThan(b) ? a : b;
}

/** Deep-convert Decimal → number and Date → ISO string for JSON responses. */
export function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out;
  }
  return value;
}

/** Plain number text for titles: 8, 2.5 (no trailing zeros). */
export function qtyText(v: Prisma.Decimal | number): string {
  return new Prisma.Decimal(v).toDecimalPlaces(3).toString();
}
