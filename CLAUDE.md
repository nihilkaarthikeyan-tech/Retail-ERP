# Retail ERP — Project Rules and Setup

We are building our own Retail ERP product, **entirely with our own code**.
It will be hosted on our company server and used through a web browser by many users, so it must be reliable.

Read this whole file before doing anything.

---

## 1. Clean-room rules (must follow at all times)

1. **This project does not use ERPNext or Frappe in any form.** Never install them, depend on them, or import anything from them.
2. **Never open, read, search, fetch, clone or paste ERPNext or Frappe source code.** ERPNext was studied separately, in a different folder, only to learn features. Do not read anything outside this project folder.
3. **Build features only from our blueprint** in `docs/blueprint/`. The blueprint describes what each feature does in plain language. If a detail is missing, ask the project owner; do not look it up in ERPNext.
4. **Design our own data model, names, screens and wording.** Common business terms are fine (item, invoice, warehouse, supplier).
5. **Tax rules (GST, e-invoice, e-way bill)** come from the blueprint and official government sources (https://www.gst.gov.in), never from other ERP products.
6. **Every source file we write** starts with our copyright line, for example:
   `// Copyright (c) 2026, <Our Company Name>. All rights reserved.`
7. **Third-party libraries:** only use packages with permissive licences (MIT, Apache-2.0, BSD, ISC). Ask the project owner before adding anything under GPL, AGPL or an unclear licence.
8. **Branding:** the product uses its own name and logo only.

---

## 2. Technology stack

| Layer | Choice |
| --- | --- |
| Frontend (web app, POS screen) | Next.js (TypeScript) |
| Backend API | NestJS (TypeScript) |
| Database | PostgreSQL |
| Database access and migrations | Prisma |
| Local database for development | PostgreSQL in Docker |
| Package manager | pnpm |

Everything runs directly on Windows. No Linux or WSL is needed for development.
PostgreSQL is used directly (not a hosted service) so the whole system can run on our own company server.

---

## 3. Folder layout

```
Retail ERP/
├── CLAUDE.md              <- this file
├── docs/
│   ├── blueprint/         <- feature descriptions (copied in by the project owner)
│   ├── decisions.md       <- agreed answers to the blueprint's open questions (overrides the blueprint)
│   └── plans/             <- short build plan per module, approved before building
├── apps/
│   ├── web/               <- Next.js frontend
│   └── api/               <- NestJS backend
├── packages/
│   └── shared/            <- shared TypeScript types and validation
├── docker-compose.yml     <- local PostgreSQL
└── package.json           <- pnpm workspace root
```

```
Browser (staff, cashiers, managers)
      ↓
apps/web  (Next.js: screens, POS)
      ↓  HTTPS / JSON
apps/api  (NestJS: business rules, permissions, accounting, stock)
      ↓  Prisma
PostgreSQL (all data)
```

All business rules (prices, tax, stock, accounting) live in the backend. The frontend never calculates final amounts on its own authority; it shows what the backend confirms.

---

## 4. Reliability rules (must follow)

### Money and numbers
1. **Never use floating-point numbers for money, tax or quantities.** Store money as PostgreSQL `numeric` (Prisma `Decimal`) and calculate with a decimal library.
2. Rounding rules are defined once, in one place, and covered by tests.

### Accounting
3. **Double-entry always:** every financial transaction creates ledger entries whose debits equal credits. The save must fail if they do not balance.
4. **Posted documents are never edited or deleted.** A mistake is fixed by cancelling (which posts reversing entries) and creating a new document.
5. Every document that affects stock or accounts posts its stock and ledger entries **in the same database transaction** as the document itself: all succeed or none do.

### Stock
6. Every stock change is recorded as a stock movement (what, where, how many, when, value). Current stock is always explainable from the movements.
7. Prevent two cashiers selling the last unit at the same moment (use database row locking or equivalent).

### Data safety
8. Every table holding business data records who created and last changed each row, and when.
9. Keep an audit log of important actions (posting, cancelling, price changes, permission changes).
10. Database changes happen only through Prisma migrations, committed to the repository.

### Security
11. Every API endpoint checks the user's role and store permissions on the backend.
12. Passwords are stored only as strong hashes. Secrets live in environment files that are never committed.

### Testing
13. **Every calculation involving money, tax or stock has automated tests**, including returns, cancellations and rounding.
14. A feature is not done until its tests pass.

### Dates and time
15. **All business dates use Indian time (Asia/Kolkata), never the server's UTC date.** This covers bill dates, shift dates, financial years, document numbers, report periods, history filters and scheduled jobs. A sale at 00:05 Indian time on 1 April belongs to 1 April (and to the new financial year) even though it is still 31 March in UTC. Use the `businessDate()` helper from `packages/shared`; never `new Date().toISOString().slice(0, 10)` for a business date. Timestamps (when something was saved) are still stored as UTC instants.

---

## 5. Setup on Windows (development)

Install, if not already present:

- **Git:** https://git-scm.com
- **Node.js (current LTS version):** https://nodejs.org
- **pnpm:** run `npm install -g pnpm`
- **Docker Desktop:** already installed

Check:

```powershell
git --version
node -v
pnpm -v
docker --version
```

### Local database

Create `docker-compose.yml` in the project root with a PostgreSQL service (official `postgres` image, a named volume for data, port 5432, credentials from a `.env` file that is not committed). Then:

```powershell
docker compose up -d
```

### Create the apps

Set up a pnpm workspace with:

- `apps/web`: Next.js with TypeScript (`pnpm create next-app`)
- `apps/api`: NestJS (`pnpm dlx @nestjs/cli new api`)
- `packages/shared`: shared types
- Prisma inside `apps/api`, connected to the local PostgreSQL

Confirm the API can connect to the database and the web app can call the API before building any feature.

---

## 6. How to build

1. **Only build what is described in `docs/blueprint/`, following the agreed answers in `docs/decisions.md`.** Read the module's blueprint file and the related decisions fully before starting it.
   - Where `docs/decisions.md` and the blueprint differ, **`docs/decisions.md` wins**.
   - Do not build anything marked **OPEN** in `docs/decisions.md` until the project owner records a decision.
   - Build only the **launch scope** in `docs/decisions.md`. Do not build deferred features.
   - Do not build the GST module until questions 43 and 55–64 are marked as approved by the Chartered Accountant.
2. Build in this order, finishing and testing each before the next:
   1. Users, roles and permissions; company and stores
   2. Items, units, barcodes, price lists
   3. Customers and suppliers
   4. Inventory (warehouses, stock movements, valuation)
   5. Purchasing
   6. Point of sale
   7. Accounting (chart of accounts, ledger posting, payments)
   8. Tax (GST)
   9. Reports
   10. Printing, import/export
3. Before each module, write a short plan in `docs/plans/<module>.md`: data model, main screens, API endpoints. Wait for the project owner's approval if the module affects money, tax or stock.
4. If the blueprint is unclear or incomplete, stop and ask. Do not guess business rules.
5. **Before building the point of sale module**, write and get approval for `docs/plans/pos-offline-and-devices.md`: how the offline queue works (what is saved on the till, how bills sync, unique bill numbering per till, how a bill is never saved twice if it is sent twice, what happens if stock or prices changed while offline, and how a till recovers after a crash) and how the local device connector talks to printers, cash drawers, customer displays and weighing scales.
6. **Acceptance tests.** Keep `docs/acceptance-tests.md`: a plain-language list of end-to-end scenarios with the expected result in stock, accounts and tax for each. At minimum: a sale, a return, an exchange, a purchase receipt, a stock transfer between shops, a negative-stock sale at the till, a shift close with cash count, a card/UPI payment recorded at the till, and a GST invoice. (Settlement matching is deferred; add its scenario when it is built.) Write each module's scenarios before building it; a module is not done until its scenarios pass as automated tests.

---

## 7. Day-to-day commands

| Task | Command |
| --- | --- |
| Start the database | `docker compose up -d` |
| Stop the database | `docker compose down` |
| Run all apps in development | `pnpm dev` (set up in the root `package.json`) |
| Create a database migration | `pnpm --filter api prisma migrate dev` |
| Run tests | `pnpm test` |

---

## Sources

- Next.js: https://nextjs.org/docs
- NestJS: https://docs.nestjs.com
- Prisma: https://www.prisma.io/docs
- PostgreSQL Docker image: https://hub.docker.com/_/postgres
- GST official portal: https://www.gst.gov.in
