import type { Module } from '@prisma/client';
import { assertCan, can } from '../config/permissions';
import { qtyText, ZERO } from '../lib/decimal';
import { prisma } from '../lib/prisma';
import type { AuthUser } from './auth.service';
import { moDtoById } from './manufacturing.service';
import type { Progress } from './progress.service';
import { purchaseDtoById } from './purchase.service';
import { salesDtoById } from './sales.service';

export type JourneyKind = 'SO' | 'PO' | 'MO';
export type JourneyNode = {
  kind: JourneyKind;
  id: number;
  reference: string;
  title: string;
  status: string;
  progress: Progress;
  canOpen: boolean;
  children: JourneyNode[];
};

const MODULE: Record<JourneyKind, Module> = { SO: 'SALES', PO: 'PURCHASE', MO: 'MANUFACTURING' };
const MAX_DEPTH = 3;
const GENERIC_TITLE: Record<JourneyKind, string> = { SO: 'Sales order', PO: 'Purchase order', MO: 'Manufacturing order' };

async function node(user: AuthUser, kind: JourneyKind, id: number, depth: number): Promise<JourneyNode> {
  let base: Omit<JourneyNode, 'canOpen' | 'children'>;
  if (kind === 'SO') {
    const d = await salesDtoById(id);
    const units = d.lines.reduce((s, l) => s.plus(l.quantity), ZERO);
    base = { kind, id, reference: d.reference, status: d.status, progress: d.progress, title: `${d.customer.name} · ${qtyText(units)} items` };
  } else if (kind === 'PO') {
    const d = await purchaseDtoById(id);
    const summary = d.lines.map((l) => `${qtyText(l.quantity)} ${l.productName}`).join(', ');
    base = { kind, id, reference: d.reference, status: d.status, progress: d.progress, title: `${d.vendor.name} · ${summary}` };
  } else {
    const d = await moDtoById(id);
    base = { kind, id, reference: d.reference, status: d.status, progress: d.progress, title: `${qtyText(d.quantity)} × ${d.product.name}` };
  }
  let children: JourneyNode[] = [];
  if (depth < MAX_DEPTH && kind !== 'PO') {
    const [pos, mos] = await Promise.all([
      prisma.purchaseOrder.findMany({ where: { origin: base.reference }, select: { id: true }, orderBy: { id: 'asc' } }),
      prisma.manufacturingOrder.findMany({ where: { origin: base.reference }, select: { id: true }, orderBy: { id: 'asc' } }),
    ]);
    children = [
      ...(await Promise.all(pos.map((p) => node(user, 'PO', p.id, depth + 1)))),
      ...(await Promise.all(mos.map((m) => node(user, 'MO', m.id, depth + 1)))),
    ];
  }
  const canOpen = can(user, MODULE[kind], 'view');
  // Without access to that module, show reference/status/progress only — no vendor, product or quantities.
  const title = canOpen ? base.title : GENERIC_TITLE[kind];
  return { ...base, title, canOpen, children };
}

/** The order plus the POs/MOs it auto-procured (via `origin`), recursively. */
export async function getJourney(user: AuthUser, kind: JourneyKind, id: number): Promise<JourneyNode> {
  assertCan(user, MODULE[kind], 'view');
  return node(user, kind, id, 0);
}
