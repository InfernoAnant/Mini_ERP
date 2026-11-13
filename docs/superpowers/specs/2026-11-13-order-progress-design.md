# Order Level-Up Progress & Celebration — Design (short)

Date: 2026-11-13 · Status: draft for approval · Builds on `2026-11-05-mini-erp-design.md`

## Why
The live demo was hard to follow: a viewer can't see where an order is, or that a sale is waiting on a manufacturing order that is waiting on a purchase order. Game-style "level-up" progress bars make the demand-to-delivery flow visible at a glance, and a small celebration when an order completes gives the demo a satisfying payoff.

## Goals
- Every sales, purchase and manufacturing order shows a **level-up progress bar**: 4 levels, a % fill and a label ("Level 2 of 4 · 55%").
- The order page shows the **supply chain** under the bar: an SO lists the MOs/POs it auto-created, and an MO lists the POs it created, each with its own mini bar.
- When the user's own action completes an order, **confetti bursts around the end (final) section of the bar only**, not full screen, and the final segment shows "Complete! 🎉".
- Mini progress bars appear in the list and kanban views.

## Non-goals
- User XP, levels, badges or leaderboards (option B, not chosen).
- Sounds, full-screen effects, animations on every page load.

## Anti-goals
- Business logic in React (CLAUDE.md): stages and % are computed on the server.
- Confetti that fires repeatedly, blocks clicks or hides content.

## Levels and % (computed in a server service)
| Order | Level 1 | Level 2 | Level 3 (partial fill) | Level 4 |
|---|---|---|---|---|
| Sales | Draft | Confirmed | Supplied: enough stock to ship, or all linked MOs/POs done | Delivered (fills by delivered ÷ ordered) |
| Purchase | Draft | Confirmed | Receiving (fills by received ÷ ordered) | Received |
| Manufacturing | Draft | Confirmed | In production (fills by work orders done ÷ total) | Done |

Each level is 25%. The current level fills partway by its fraction. Cancelled orders show a grey bar labelled "Cancelled". *(Builder's call: exact fill rules within a level.)*

## Approaches considered
1. **Server journey endpoint (chosen).** `GET /api/{sales|purchase|manufacturing}/:id/journey` returns the order's levels/% plus its children, found through the `origin` links, recursively. List endpoints add `progress: { level, percent }` to each row. This keeps logic in services, makes it testable, and shows the full chain.
2. Client-only computation: rejected. It can't see the MO's POs without extra requests, and it would put business logic in React.

Confetti: **hand-written canvas burst (chosen)**, about 60 lines, no new dependency. The `canvas-confetti` library was rejected because it would be a new dependency.

## Celebration rules
- Fires only on a transition into the final level caused by an action on that page (confirming a delivery/receipt/production operation, or an edit that completes the order), once.
- The canvas is positioned over the last segment of the bar (about 140px around its end). Particles stay within roughly that area and fade in about 1.5s. The page stays clickable (`pointer-events: none`).
- Respects `prefers-reduced-motion`: no particles, just a glow on the final segment.

## Testing
- Server: Vitest tests for the level/% rules of each order type and status (including partial delivery and work-order fractions) and for the chain (SO → MO → PO).
- Client: build passes, plus a manual check that the bar, the chain and the end-of-bar confetti work on one full demo run.

## Left to the builder
Colours and styling, mini-bar size in lists and kanban, the exact particle count and shapes, and the endpoint response shape beyond the fields above.
