# Mini ERP — Shiv Furniture Works: Design

Date: 2026-11-05 · Status: draft for approval

Source material: `docs/problem-statement.txt` (Odoo hackathon brief "Mini ERP: From Demand to Delivery") and the organisers' Excalidraw mockup (https://link.excalidraw.com/l/65VNwvy7c4X/gt2p7234Do). Project rules live in `CLAUDE.md`; this document does not repeat them.

## 1. Intent

A resume showcase for software-developer roles. The audience is a recruiter or interviewer who clicks a **live demo link** for a few minutes, and possibly opens the GitHub repo. It must prove the author can build a real, connected business system — not a CRUD toy.

**Success looks like:** a visitor logs in with one click, confirms a sales order for furniture that isn't in stock, watches the system automatically create a manufacturing order (and purchase orders for missing raw materials), runs it through to delivery, and sees every stock movement in the ledger and every change in the audit log — with nothing broken along the way.

**Time budget:** 2 days total, including deployment and README.

## 2. Goals, non-goals, anti-goals

**Goals**
- The full demand-to-delivery flow from the brief works end to end: Products → Sales → Procurement (MTO) → Purchase / Manufacturing (BoM, MO, Work Orders) → Stock Ledger → Audit Log → Dashboard.
- Stock numbers are always correct: on-hand, reserved, free-to-use.
- Role-based access visibly changes what each demo user can see and do.
- Deployed publicly with seed data and one-click demo logins.
- README with a 2-minute demo script, screenshots, architecture and design notes.

**Non-goals (v1)**
- **Field-level permissions** (per-field create/view/edit/delete rights from the mockup's User Management form). Deferred by the user; revisit when the project is nearly finished.
- Everything in CLAUDE.md "Out of scope" (accounting, invoicing, multi-warehouse, lots, notifications…).
- Make-to-stock reorder rules / min-max replenishment (not required by the brief).
- Work-order timers, pause/resume; PDFs; CSV export; nested (multi-level) BoMs.
- Forgot-password flow (link may be shown disabled).

**Anti-goals** — failures even if "it works":
- Stock that drifts from the ledger, or ever goes negative.
- A demo that is empty, broken, or needs sign-up before showing anything.
- Many half-finished screens. Fewer screens that work perfectly beat more that don't.

## 3. Users and access

Demo users (seeded), one per brief role, each with a one-click login button on the login page:

| User | Role | Module access |
|---|---|---|
| Admin | System Administrator | ADMIN on every module, plus user management and audit logs: can do everything |
| Sales user | Sales | Sales: Admin; Products: User |
| Purchase user | Purchase | Purchase: Admin; Products: User |
| Manufacturing user | Manufacturing | Manufacturing + BoM: Admin; Products: User |
| Inventory manager | Inventory | Products: Admin; Sales/Purchase/Manufacturing: User (view stock-related) |
| Business owner | Owner | View-only (User level without create/edit) on all modules + dashboard |

**Model:** each user has an access level per module — `ADMIN`, `USER` or `NONE` (the brief's "Access Type"). Modules: Sales, Purchase, Manufacturing, BoM, Products. What each level allows per action comes from the mockup's User Management matrix, encoded once in `server/src/config/permissions.ts`:

| Module | Action | ADMIN | USER |
|---|---|---|---|
| Sales | View / Create | ✓ | ✓ |
| Sales | Edit | ✓ | limited |
| Sales | Delete / Confirm | ✓ | ✗ |
| Purchase | View / Create | ✓ | ✓ |
| Purchase | Edit | ✓ | limited |
| Purchase | Confirm | ✓ | ✗ |
| Manufacturing | View / Production entry | ✓ | ✓ |
| BoM | Edit | ✓ | ✗ |
| Products | View / Create | ✓ | ✓ |
| Products | Edit | ✓ | limited |

Actions the mockup matrix leaves out *(builder's call)*:
- Placing and confirming stock operations (§5a) for deliveries, receipts and production, and completing work orders, are operational actions: allowed at USER level on the related module. Stock adjustments need ADMIN on Products.
- Confirm and Cancel on any order, and creating or editing BoMs, need ADMIN.
- The Inventory manager is USER on Sales, Purchase and Manufacturing, so they can deliver, receive and produce (and create drafts).
- Procurement runs as the system: when a Sales user confirms an order, the auto-created PO/MO is created regardless of that user's access to Purchase/Manufacturing. Its responsible person / assignee is left empty, and the audit row records the confirming user plus "auto-procurement from SO-…".

`NONE` = module hidden and API returns 403. "Limited" edit = may edit only Draft records they created *(builder's call)*. The Business Owner case is covered by a per-user `readOnly` flag *(builder's call)* rather than a fourth level.

System Administrator (`isSystemAdmin`) additionally manages users (list, edit profile, set access levels) and sees Audit Logs. Only the admin may change a user's Position.

**Sign-up:** creates a user with `NONE` on every module until the admin grants access. Rules from mockup: login ID 6–12 chars and unique, email unique, password ≥ 8 chars with upper, lower and special character.

Auth mechanics are fixed by CLAUDE.md (JWT in httpOnly cookie, bcrypt).

## 4. Core data

- **Product:** name, sales price, cost price, unit, on-hand qty (decimal allowed), `procureOnDemand` (bool), `procurementType` (PURCHASE | MANUFACTURING, required when procureOnDemand), default vendor (required if PURCHASE), default BoM (required if MANUFACTURING). Reserved and free-to-use are computed.
- **Contact:** customers and vendors (name, address, type).
- **Sales Order:** reference `SO-000001`, customer, customer address, salesperson (user), creation date (auto, read-only), scheduled date, status, lines (product, ordered qty, delivered qty, unit price copied from product, line total).
- **Purchase Order:** mirror of sales: `PO-000001`, vendor, vendor address, responsible person, expected date, lines with received qty and cost price.
- **Bill of Materials:** `BOM-000001`, finished product, quantity it produces (default 1), component lines (product, qty), operation lines (name, work center, duration in minutes).
- **Work Center:** name (seed: Assembly Line, Paint Floor, Packaging Unit).
- **Manufacturing Order:** `MO-000001`, finished product, quantity, BoM (filtered to that product), assignee, deadline, status, component lines (to-consume qty = BoM qty × MO qty ÷ BoM output qty; consumed qty), work orders (operation, work center, expected duration scaled by quantity, real duration entered by hand, status Pending/Done).
- **Stock Operation:** reference `OP-000001`, type (DELIVERY, RECEIPT, PRODUCTION, ADJUSTMENT), source document (SO/PO/MO, or none for adjustments), lines (product, quantity), reason (adjustments), status (PLACED → CONFIRMED, or PLACED → REJECTED), placed by + at, confirmed/rejected by + at. See §5a.
- **Stock Move:** product, signed quantity, type (RECEIPT, DELIVERY, MO_CONSUME, MO_PRODUCE, ADJUSTMENT), source document reference, user, timestamp. The ledger.
- **Audit Log:** timestamp, user, module, record type, record id/reference, action (CREATE, UPDATE, DELETE, STATUS_CHANGE), field changed, old value, new value.
- **Procurement link:** auto-created PO/MO stores its origin document (e.g. "SO-000003") and shows it on the form.

## 5. Inventory rules

- **On-hand** changes only through Stock Moves (per CLAUDE.md). Product keeps a cached `onHand` column updated in the same transaction as each move *(builder's call, for locking and fast reads)*; a test asserts it always equals the ledger sum.
- **Reserved** = Σ (ordered − delivered) over Confirmed / Partially Delivered sales lines + Σ (to-consume − consumed) over components of Confirmed / In-Progress / To Close MOs.
- **Free-to-use** = on-hand − reserved. It may be negative (displayed as a shortage); on-hand may never be.
- Concurrency: stock-changing operations lock the affected product rows (`SELECT … FOR UPDATE`, in product-id order) inside the transaction.
- Delivering or consuming more than on-hand is rejected with a clear error.
- **Stock outside orders:** the initial "Stock Quantity" entered when creating a product becomes an ADJUSTMENT move *(builder's call: posted directly, since it's part of creating the product)*. The product form has an **Adjust stock** button (new quantity + reason) for users with ADMIN on Products (the Inventory manager and Admin). It places an ADJUSTMENT operation (§5a).

## 5a. Stock operations: place, then confirm (user's decision)

No stock changes the moment someone clicks Deliver, Receive, Produce or Adjust stock. Instead, the action **places** a Stock Operation, and stock is only written to the ledger when the operation is **confirmed**.

- The same person may place and confirm, or one person places and another confirms. Example from the user: the Inventory manager places "materials sent", and someone in the receiving department confirms they arrived.
- Placing records the intended quantities. It checks that they don't exceed what's left to deliver/receive/produce, but does not move stock.
- Confirming re-checks everything (e.g. enough on-hand to deliver), then in one transaction writes the Stock Moves, updates on-hand, updates the source order's delivered/received/produced quantities and status, and writes audit rows.
- An operation can be **rejected** instead of confirmed, with a reason; nothing moves.
- While placed, the quantities stay reserved, and a second operation can't claim the same remaining quantity.
- Who can confirm: anyone with USER or ADMIN access on the related module (Sales for deliveries, Purchase for receipts, Manufacturing for production, ADMIN on Products for adjustments) *(builder's call)*.
- Screens: each order form lists its operations with Confirm / Reject buttons; a **Stock Operations** page lists everything awaiting confirmation; the dashboard shows an "Awaiting confirmation" count.

## 6. Workflows

**Edit button (user's decision)** on all three order types. Draft orders are freely editable. After Confirm, **Edit** is still available until the order is complete or cancelled *(rules are builder's call)*:
- Lines can be added, removed, or have quantities changed, but a quantity can never drop below what's already delivered/received/produced or placed in a pending operation.
- Saving recalculates reservations. If quantities went up, procurement (§7) runs again for the extra shortage only. If they went down, already auto-created POs/MOs are left alone (they're linked, so a user can cancel them).
- Every changed field is audited.
- Completed and cancelled orders are read-only.

**Sales:** Draft → Confirmed → Partially Delivered → Fully Delivered; Draft → Cancelled. Confirmed / Partially Delivered may also be cancelled, releasing reservations *(builder's call)*.
- Confirm: quantities reserved; procurement runs (§7).
- Deliver: user enters quantity per line, which places a DELIVERY operation (§5a). When it's confirmed, delivered quantities update. All lines complete → Fully Delivered (form read-only, Deliver hidden); otherwise Partially Delivered.
- Lines show an availability warning when ordered qty > free-to-use.
- Total = ordered qty × price; after delivery = delivered qty × price (per mockup).
- Draft orders can be deleted (audited).

**Purchase:** Draft → Confirmed → Partially Received → Fully Received; Draft → Cancelled. Receive works like Deliver: it places a RECEIPT operation, and stock arrives when that's confirmed.

**Manufacturing:** Draft → Confirmed → In-Progress → To Close → Done; Cancel allowed before Done.
- Choosing a BoM copies its components and operations into the MO; expected durations scale with quantity.
- Confirm: components reserved; procurement runs for components (§7).
- Marking the first work order done (with real duration) → In-Progress; all done → To Close.
- **Produce** (allowed from Confirmed onward) places a PRODUCTION operation (§5a). When confirmed: consumes all components (MO_CONSUME moves), adds finished goods (MO_PRODUCE), status Done, form read-only. Confirming is rejected if any component lacks on-hand stock.

**Late** (dashboard): scheduled/expected/deadline date has passed and the order is not yet complete (Confirmed, partially delivered/received, or MO not Done).

## 7. Procurement (MTO)

On confirming a sales order (and on confirming an MO, for its components): for each line whose product has `procureOnDemand`:

shortage = ordered qty − max(free-to-use *before* this order's reservation, 0). This is never more than the ordered qty: each order procures only its own shortfall, so if free-to-use is already negative, earlier orders have already procured theirs and nothing is duplicated. Open incoming POs/MOs are not subtracted (simple per-order MTO, like Odoo) *(builder's call)*. If shortage > 0:
- PURCHASE → create a **Draft** PO to the product's default vendor for the shortage.
- MANUFACTURING → create a **Draft** MO with the product's default BoM for the shortage.

The new document records its origin, is audited, and is linked from the source order. If `procureOnDemand` is off, nothing is created.

Using free-to-use (not on-hand, as the mockup literally says) so reservations by other orders are respected — *builder's call, deviation from mockup wording*. Creating as Draft (so a human confirms) is also *builder's call*; confirming the auto-created MO then cascades procurement for its components, which produces the demo's chain.

## 8. Screens (from the mockup)

- **Login** (with demo-user buttons) and **Sign-up**.
- **Top bar:** app logo/name, master-menu toggle, user avatar → profile (name, address, mobile, photo URL editable; email and position read-only).
- **Master menu:** Sale Orders, Purchase Orders, Manufacturing Orders, Bills of Materials, Products, Audit Logs (admin), Users (admin). Menu entries hidden for `NONE` modules.
- **Dashboard:** for Sales, Purchase, Manufacturing — status chips with counts in an "All" row and a "My" row (orders where I'm salesperson / responsible / assignee), plus Late. Clicking a chip opens the list filtered to it. Also: low free-to-use stock list.
- **Per module:** list view (search by reference and contact, status filter, pagination), kanban view grouped by status, form view with status-driven buttons and a **Logs** button opening the audit log filtered to that record.
- **Product form** also shows on-hand / reserved / free-to-use and its stock-ledger history.
- **Audit Logs page:** tiles (total, created, updated, deleted), filters (date range, user, module, action), paginated table with field / old / new values.
- **Users (admin):** list; form with profile and per-module access level.

Visual style: clean, plain Tailwind; desktop-first but usable on a laptop screen. No component library.

## 9. Audit

Every create, delete, status change, and change to a tracked field writes an Audit Log row in the same transaction. Tracked fields include prices, quantities, partner, dates, assignee, BoM lines, procurement settings, user access levels. Deliveries, receipts and production are logged as status changes plus quantity changes.

## 10. Seed data

Furniture catalogue: finished goods (Wooden Table, Dining Table, Office Chair, Wooden Chair, Bookshelf) and raw materials (Wooden Legs, Wooden Top, Screws, Paint, Fabric…), BoMs with operations matching the brief's example (Wooden Table = 4 legs + 1 top + 12 screws; Assembly 60, Painting 30, Packing 20 min), several customers and vendors, the six demo users, and a few historical orders in various statuses so the dashboard isn't empty. At least one MTO product is deliberately short of stock for the demo script. Seed must be re-runnable to reset the demo.

## 11. Deployment

Frontend on Vercel, API on Render (free), Postgres on Neon (free). Vercel rewrites `/api/*` to the Render API so the auth cookie stays same-site (keeps `SameSite=Lax`). The free API sleeps when idle (~30 s cold start) — README mentions it. *Hosting choice is builder's call.*

**Shared public demo** *(builder's call, proposed to the user)*: a **Reset demo data** button (login page and top bar) restores the seed in a few seconds; the README tells visitors to click it first. The six seeded demo accounts are locked: their access levels, login IDs and passwords can't be changed. Sign-up stays open, and new accounts start with no access.

## 12. Quality bar

- Vitest tests for: stock service (moves, on-hand cache = ledger, no negatives), place/confirm/reject of stock operations (nothing moves until confirmed), order edits after confirm, reserved/free-to-use computation, procurement creation, every status transition (allowed and rejected), permission checks.
- README: what it is, live link, demo logins, 2-minute demo script, architecture diagram, key design decisions (ledger, row locking, transactions + audit), local setup.

## 13. Left to the builder

Folder internals beyond CLAUDE.md layout, API shape, component structure, exact Tailwind styling, reference-number generation, pagination size, and the order of work within the 2 days. New dependencies still need the user's approval per CLAUDE.md — the implementation plan will list them.
