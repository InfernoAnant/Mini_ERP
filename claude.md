Mini ERP — Shiv Furniture Works

Mini ERP for a furniture manufacturer covering Products, Sales, Purchase, Manufacturing (BoM, MOs, Work Orders), Stock Ledger, MTS/MTO auto-procurement, audit logs and a dashboard. Every module moves inventory, so the Stock Ledger is the source of truth for all stock changes.

Stack & commands
React + TypeScript (Vite, Tailwind) · Node.js + Express + TypeScript · PostgreSQL via Prisma · JWT auth · Zod validation
Server: cd server && npm i && npx prisma migrate dev && npx prisma db seed && npm run dev (port 5000)
Client: cd client && npm i && npm run dev (port 5173)
Tests: cd server && npm test (Vitest — stock, procurement and status-transition logic)
Layout
client/src/ — pages/<module>, components/, api/, context/ (auth)
server/src/ — routes/, services/ (all business logic), middleware/ (auth, permissions), config/permissions.ts
server/prisma/ — schema.prisma, migrations, seed.ts
Rules
TypeScript strict, no any; no new dependencies without asking
Business logic only in server/src/services, never in routes or React
Stock changes only via StockMove rows, inside a Prisma transaction; quantities never negative
Free-to-use = on-hand − reserved (computed, not stored)
Enforce status transitions and role permissions on the server
Auth: JWT signed with JWT_SECRET from .env, sent in an httpOnly, SameSite=Lax cookie (never localStorage); passwords hashed with bcrypt; payload carries userId + role only; auth middleware rejects missing/expired tokens with 401, permissions middleware returns 403
Every important change writes an AuditLog entry in the same transaction
Small commits: feat(sales): reserve stock on confirm
Out of scope
Accounting, invoicing, payments, taxes
Multiple warehouses/locations, lots, serial numbers
Email/notifications, mobile app, multi-company, multi-currency