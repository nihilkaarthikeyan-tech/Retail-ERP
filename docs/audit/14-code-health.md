# Audit 14: Code health    Date: 30 October 2026

Scope: the whole repository. Three read-only helpers looked at:
- rules written twice;
- tests that pass for the wrong reason;
- dead code, switched-off checks, out-of-date library calls, and docs against code.

Three more helpers then fixed the weak tests, brought the docs up to date, and wrote tests for the least-covered security and money code. The whole acceptance suite was run with coverage measured.

## The biggest finding: the till and the server disagreed in 8 places

The till prices every bill itself, so it can bill offline. The server prices it again. Where the two rules were written separately, they had drifted apart:

| # | Case | What went wrong | Now |
| --- | --- | --- | --- |
| D1 | Return after the credit-note time limit (30 November after the sale's year), or of a bill with no tax | The till showed CGST and SGST and asked a walk-in for a name. The server saved a return note with no GST | One shared rule, `returnSupplyOf`, used by both |
| D2 | Return without the bill | The till showed tax (−₹114.28 + ₹2.86 + ₹2.86). The server saved −₹120.00 with no GST (rule 53(1A)(g): no original invoice, no credit note) | The till reduces no GST either |
| D3 | A serial-numbered item sold by the box (box of 2) | The till wanted 1 serial, the server 2: such boxes could not be sold at all | The till counts one serial per piece |
| D4 | Returning a serial-numbered item against its bill | The till never sent the serials, so the server always refused: **these returns were impossible** | The return screen shows the bill's serial numbers as tick boxes; the ticked ones are sent |
| D5 | Purchase bill or order from a supplier in another state | The screen previewed CGST + SGST (total ₹1,052); the bill saved IGST (₹1,051) | The screens ask the server (`/purchase/place-of-supply`) and preview IGST |
| D6 | A business customer whose billing address has another state's GSTIN | The till charged CGST + SGST; the server charged IGST | The till's download carries the GSTIN the server uses |
| D7 | "Save typed prices" switched on, item with no price | The till blocked the line; the server accepts it and keeps the price | The till knows the setting |
| D8 | Business buyer with taxable and tax-free goods on one bill | The till accepted it; the server refused it | The till stops it, with the server's words |

Each case now has a test that runs the till's own pricing code against the server and compares them line by line (`module21-audit11b`), or a test of the one shared rule (`packages/shared/src/audit14.spec.ts`).

The other rules helper A found written twice already agree. They are listed in the table below with what proves it.

### Rules written twice, and what proves they agree

| Rule | Proof |
| --- | --- |
| Pricing a sale: price, offers, manual and bill discounts, IGST, rounding | `module21-audit11b`: the till's code against the server, 4 sales and 1 return, line by line |
| Return GST (D1) | One shared function, `returnSupplyOf`, plus its own test |
| Return without a bill (D2), serials (D3, D4), billing-address GSTIN (D6), typed prices (D7), mixed exempt goods (D8) | `module21-audit11b`, audit 14 tests |
| Purchase GST preview (D5) | The server answers the question; `module21-audit11b` checks the answer and the saved IGST |
| Bill numbers have 6 digits | One shared constant, `TILL_NUMBER_DIGITS`, now used by both |
| Gift card numbers have 16 digits; e-way bill sub-supply codes; HSN digits for import | One shared constant each, now used where the value was typed out |
| Rounding, fractions, payment terms, e-way limits, points earned, credit limits | Already one shared function each |
| Offers in force, coupons, points paid, change in cash only, quantity left to return, bill discount limit | Identical copies; covered by the till's unit tests and the parity tests. Moving them into shared code is left for when they next change |

## Other findings

| # | Severity | What was wrong | Status |
| --- | --- | --- | --- |
| 1 | High | **No automatic tests at all**: nothing ran on a push | ✔️ GitHub CI (`.github/workflows/ci.yml`), free for a public repository. On every push and pull request it runs the type checks, lint, all unit tests, `pnpm audit`, and the whole acceptance suite against its own database. First green run 30 October 2026, about 8 minutes |
| 2 | High | The setting "address that decides same-state or other-state GST" was saved but nothing read it. The law decides the place of supply, so per CLAUDE.md §1a it should not be a setting | ✔️ Removed from the settings screen, the settings centre and the API; the unused function behind it removed. The column stays (no data lost) |
| 3 | Medium | Tests that passed for the wrong reason: expected values worked out by the code under test, `>= 400` that a crash would pass, a status list that could never fail, month-dependent branches, unchecked set-up steps | ✔️ See the helper D list below |
| 4 | Medium | Weakly covered security and money code: roles 67%, manager PINs 68%, chart of accounts 51%, nightly catch-up 44% | ✔️ `module22-audit14`: 26 tests (roles, PINs, chart, catalogue and stock masters, catch-up after a missed night), all exact; no product bug found |
| 5 | Medium | The shared package was never linted; the API had the "no `any`" rule switched off | ✔️ Shared now linted (24 warnings fixed, including cells or portal fields that would have read as "[object Object]"); the rule is back on (0 uses) |
| 6 | Low | Out-of-date library calls: 108 old-style id checks and 5 date-time checks (Zod 4), `navigator.platform`, web on Node 20 types | ✔️ Replaced; web on Node 24 types |
| 7 | Low | Dead code: 12 exports used nowhere, a summary-email preview route with no screen that ignored who asked, an unused variable and parameter | ✔️ Removed |
| 9 | Medium | Found by the final runs: the "My modules" page re-reads the module list when it opens. If that answer came after the owner had switched a module, it put the old switches back on screen | ✔️ Fixed (`apps/web/src/lib/modules.tsx`): a read that started before the last change is ignored. Three screen tests that looked a moment too early (a button shown just after its message, a list row redrawn) now wait or look again; screen tests may wait 10 s on a busy computer. The web suite then ran 10 times in a row |
| 8 | Low | Docs out of date: decisions page header broken, "waiting for the owner" and "CA approval required" though decided and built, wrong API paths in the plans, warranty dates promised but not built, DNS step | ✔️ Updated |

## Coverage of the server code by the acceptance tests

Share of the server's lines and branches run by the acceptance tests (vitest coverage, 30 October 2026). Before means before this audit's tests; after means after them.

| Area (folders) | Lines before | Lines after | Branches after |
| --- | --- | --- | --- |
| Money (accounting, ledger, pos, purchasing, loyalty, orders, pricing) | 91.9% | **93.1%** | 73.2% |
| Stock (inventory, items, catalogue) | 84.4% | **88.6%** | 72.5% |
| Tax (gst, gst-portal) | 78.6% | **78.6%** | 55.7% |
| Security (auth, roles, users, platform, prisma, stores, company, audit, common) | 79.0% | **81.0%** | 74.3% |
| Whole API | 87.1% | **88.4%** | 68.9% |

The tax figure is held down by the GSTIN look-up service (25%). It calls an outside service, and the tests use a stand-in on purpose, so no credits are spent and no network is needed. The GST rules themselves are tested in the shared package (327 tests).

## Accepted, with the reason

- **Prisma's "failed to detect the libssl/openssl version" note** in the live logs: the database tool works in the slim image (`prisma migrate status` on the live server answered "Database schema is up to date"), so it is only a note.
- **`forRoutes('*')`**: still accepted by NestJS 11 with no warning in the live log.
- **Web on TypeScript 5** (the rest on 6): Next.js sets its own TypeScript range; it moves with the next Next.js update.
- **`GET /stock/consistency`** has no screen: it is the owner-level stock check, kept for support.
- **Waiting for the owner** (`docs/pending-work.md`): renaming the top-level accounts, whether the daily summary email starts on, warranty dates, a screen to clear a forgotten PIN, and "forget this till".

## Result

All 8 disagreements between the till and the server are fixed, each with a test. Every duplicated rule is listed above with what proves it agrees. Coverage is measured. Lint and the type checks show 0 warnings in all four parts. GitHub CI runs everything on every push. The full suite passed three times in a row (30 October 2026, 19:13–20:05). Each time: acceptance 529 (was 497), shared 327, API unit 54, Till Helper 98. The web suite (482) failed once in the third run, which led to finding 9. After that fix it passed 10 times in a row. Session 14 is **done** (30 October 2026).
