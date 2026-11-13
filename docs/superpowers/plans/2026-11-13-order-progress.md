# Order Level-Up Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4-level progress bars to sales, purchase and manufacturing orders, a supply-chain "journey" under the bar, mini bars in lists and kanban, and a confetti burst confined to the end of the bar when the user's action completes an order.

**Architecture:** A pure `progress.service.ts` computes `Progress` from order data. Order DTOs gain a `progress` field, and a new `GET /:id/journey` endpoint per order router returns the order plus its auto-procured children (found through `origin`). The client draws `LevelBar`, `JourneyPanel` and a canvas `EndConfetti` anchored to the bar's last segment.

**Tech Stack:** Existing stack only (Express 5, Prisma 6, Zod, React 18, Tailwind 3, Vitest). **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-11-13-order-progress-design.md` (and the base spec `2026-11-05-mini-erp-design.md`).

## Global Constraints

- No new dependencies; the confetti is hand-written canvas.
- Business logic (levels and %) only in `server/src/services`; React only draws.
- 4 levels, 25% each. `percent` is an integer (`Math.round`) from 0 to 100.
- Stage labels, verbatim: Sales `['Draft','Confirmed','Supplied','Delivered']`; Purchase `['Draft','Confirmed','Receiving','Received']`; Manufacturing `['Draft','Confirmed','In production','Done']`.
- Confetti: only on a transition into 100% caused by an action on the current page, at most once per order per page visit, confined to about 140px around the bar's end, `pointer-events: none`, about 1.5s; under `prefers-reduced-motion` a glow only, no particles.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Decimal quantities** (6.5 of 10 delivered): percent is still an integer and never exceeds 100. → test in Task 1.
2. **MO with zero work orders** in progress: no divide-by-zero; level 3 at a half fill (63%). → test in Task 1.
3. **Opening an already-completed order** must not fire confetti; only a live transition does. → manual check in Task 3.
4. **A cancelled child in the chain** (e.g. a cancelled auto-PO) shows a grey "Cancelled" mini bar and doesn't break the parent. → test in Task 2.
5. **A user who can't see the child's module** (a Sales user viewing an SO whose MO is in Manufacturing) still sees the chain, as reference, status and progress only, with no link. → test in Task 2, client in Task 3.

---

### Task 1: Progress rules and DTO field

**Files:** Create `server/src/services/progress.service.ts`, `server/test/progress.test.ts`. Modify `sales.service.ts`, `purchase.service.ts`, `manufacturing.service.ts` (`toDto` adds `progress`).

**Interfaces — Produces:**

```ts
export type Progress = {
  level: 0 | 1 | 2 | 3 | 4;
  percent: number;
  stage: string;
  stages: string[];
  cancelled: boolean;
  complete: boolean;
};
export function salesProgress(o: {
  status: SalesStatus;
  lines: { quantity: Decimal; deliveredQty: Decimal; available: boolean }[];
  procurementStatuses: string[];
}): Progress;
export function purchaseProgress(o: { status: PurchaseStatus; lines: { quantity: Decimal; receivedQty: Decimal }[] }): Progress;
export function moProgress(o: { status: MoStatus; workOrders: { status: 'PENDING' | 'DONE' }[] }): Progress;
```

Rules (`base(L) = 25*(L-1)`, fill = `25*fraction` within the current level):

- Any `CANCELLED` → `{ level: 0, percent: 0, stage: 'Cancelled', cancelled: true, complete: false }`.
- Sales: DRAFT → L1, 25%. CONFIRMED and not supplied → L2, 50%. Supplied = every line `available`, or at least one procurement and all of them done (`FULLY_RECEIVED` / `DONE`) → L3, 75%. Any delivered qty, or PARTIALLY_DELIVERED → L4 with `75 + 25*(Σdelivered/Σordered)`. FULLY_DELIVERED → 100, `complete: true`.
- Purchase: DRAFT 25 (L1); CONFIRMED 50 (L2); PARTIALLY_RECEIVED → L3 with `50 + 25*(Σreceived/Σordered)`; FULLY_RECEIVED → L4, 100, complete.
- Manufacturing: DRAFT 25; CONFIRMED 50 (L2); IN_PROGRESS / TO_CLOSE → L3 with `50 + 25*(done/total)`, or a fraction of 0.5 when there are no work orders; DONE → L4, 100, complete.
- `stage` = `stages[level-1]`; `percent = Math.min(100, Math.round(x))`.

- [ ] **Step 1: Write failing unit tests** in `server/test/progress.test.ts` (build inputs inline with `dec()`):
  - `sales draft → level 1, 25%, stage Draft`
  - `sales confirmed with a short line → level 2, 50%`
  - `sales confirmed, all lines available → level 3, 75%, stage Supplied`
  - `sales confirmed, short but all procurements DONE/FULLY_RECEIVED → level 3`
  - `sales partially delivered 6 of 10 → level 4, 90%`
  - `sales delivered 6.5 of 10 → 91% (integer)` _(Review Focus 1)_
  - `sales fully delivered → 100%, complete`
  - `sales cancelled → level 0, cancelled, stage Cancelled`
  - `purchase partially received 5 of 12 → level 3, 60%`; `purchase fully received → 100 complete`
  - `mo in progress 2 of 3 work orders → level 3, 67%`; `mo to close (3/3) → 75%`; `mo done → 100 complete`
  - `mo in progress with zero work orders → 63%` _(Review Focus 2)_
  - API: `GET /api/sales/:id returns progress; list items include progress` (create and confirm an SO via the API with enough stock → `progress.level === 3`).
- [ ] **Step 2:** `cd server && npx vitest run test/progress.test.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Implement the service. Add `progress` to each `toDto` (sales: use the computed `lines[].available` and `procurements[].status`).
- [ ] **Step 4:** Run the test file, then `npm test` — expect all PASS.
- [ ] **Step 5:** Commit `feat(progress): level-up progress rules on order DTOs`.

### Task 2: Journey endpoint

**Files:** Modify `progress.service.ts` (add the journey) and `routes/sales.ts`, `routes/purchase.ts`, `routes/manufacturing.ts`. Test `server/test/journey.test.ts`.

**Interfaces:**

- Consumes: `getSales`, `getPurchase`, `getMo` DTOs (with `progress`), `assertCan`, `can`.
- Produces:

```ts
export type JourneyNode = {
  kind: 'SO' | 'PO' | 'MO';
  id: number;
  reference: string;
  title: string;
  status: string;
  progress: Progress;
  canOpen: boolean;
  children: JourneyNode[];
};
export function getJourney(user: AuthUser, kind: 'SO' | 'PO' | 'MO', id: number): Promise<JourneyNode>;
```

- Route: `GET /api/sales/:id/journey`, `/api/purchase/:id/journey`, `/api/manufacturing/:id/journey`. Requires `view` on the root order's module (403 otherwise).
- Children: POs and MOs whose `origin` equals the node's reference, recursing to depth 3, ordered POs first, then by id. Child DTOs are loaded with no permission check (as procurement does). `canOpen = can(user, module, 'view')`.
- `title`: SO `"{customer} · {Σqty} items"`; PO `"{vendor} · {line summary}"`; MO `"{qty} × {product}"`.

- [ ] **Step 1: Write failing tests** (`journey.test.ts`, using `seedDemo` + the demo script's first half through the API):
  - `SO journey shows MO child and MO's PO grandchild` — after SO 10 Wooden Tables confirm, then MO confirm: root SO has one MO child; that MO has one PO child with two lines in its title.
  - `cancelled auto-PO appears as a grey child` — cancel the PO: child `progress.cancelled === true`, root still 200. _(Review Focus 4)_
  - `sales-only user sees the chain but canOpen=false on MO/PO` _(Review Focus 5)_
  - `user without SALES view → 403 on /sales/:id/journey`
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run the file, then `npm test` — PASS.
- [ ] **Step 5:** Commit `feat(progress): order journey endpoint`.

### Task 3: Client bars, journey and end-of-bar confetti

**Files:** Create `client/src/components/LevelBar.tsx`, `client/src/components/EndConfetti.tsx`, `client/src/components/JourneyPanel.tsx`. Modify `client/src/api/types.ts` (add `Progress`, `JourneyNode`, and `progress` on the order DTOs), `pages/orders/OrderFormPage.tsx` (and its configs pass `progress` through `OrderView`), `pages/manufacturing/MoPages.tsx`, `pages/sales/SalesPages.tsx`, `pages/purchase/PurchasePages.tsx`.

**Interfaces — Produces:**

- `LevelBar({ progress, size: 'lg' | 'sm', celebrate?: boolean })`:
  - `lg`: the label "Level {level} of 4 · {percent}%" (or "Cancelled"), 4 segments with stage names, filled up to `percent`, with ✓ on completed stages; `EndConfetti` is mounted inside the last segment's wrapper when `celebrate`.
  - `sm`: a thin bar plus `{percent}%` for list rows and kanban cards.
  - Colours: indigo fill, emerald when complete, slate when cancelled.
- `EndConfetti({ onDone })`: an absolutely positioned canvas (about 160×120) centred on the bar's right end, `pointer-events: none`. Spawns about 60 particles from the end point, with gravity, fading out by 1.5s, then calls `onDone`. If `matchMedia('(prefers-reduced-motion: reduce)')` matches, it renders a 1.5s glow ring instead of particles.
- `useCelebration(progress: Progress | undefined, key: string): boolean`: true exactly when the previous progress seen _in this page session_ for `key` was below 100 and the new one is 100. It's false on first load, which covers Review Focus 3.
- `JourneyPanel({ kind, id, refreshKey })`: fetches `/{sales|purchase|manufacturing}/{id}/journey`, re-fetching when `refreshKey` changes, and renders the children tree: reference (a link only if `canOpen`), title, a `sm` LevelBar and a status badge, indented per depth. It renders nothing when there are no children.

- [ ] **Step 1:** Implement the components and wire them in:
  - The order form header area (below the page header) shows `<LevelBar size="lg" celebrate={useCelebration(...)}>` and then `<JourneyPanel>`, replacing the old "Auto-procurement" box on sales.
  - The MO form gets the same.
  - List pages add a "Progress" column with `size="sm"`, and kanban cards show the `sm` bar under the body.
- [ ] **Step 2:** `cd client && npm run build` — expect success with 0 TypeScript errors.
- [ ] **Step 3: Manual check** (start `api` and `web` via `.claude/launch.json`, then reset the demo):
  - The SO bar goes 25 → 50 on confirm, and the journey shows MO → PO.
  - Confirming the receipt fills the PO bar to 100, with confetti only around its end.
  - The MO goes to 67 after two work orders.
  - Delivering 10 fills the SO to 100, with confetti at its end.
  - Reloading that completed SO shows no confetti (Review Focus 3).
  - The Sales user sees the MO/PO references without links.
- [ ] **Step 4:** Commit `feat(client): level-up progress bars, journey and end-of-bar confetti`.

---

**Final:** one whole-branch review of this feature's commits, then report.
