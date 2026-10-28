# Audit 01: Who can see and do what    Date: 28 October 2026

Scope: `apps/api/src/auth`, `users`, `roles`, `platform`, `common`, `setup`, every `*.controller.ts` (452 routes), `packages/shared/src/permissions.ts`, the database row-level security (all migrations), uploads, exports, prints, the till PINs, and the web app's calls to the API.

How: four read-only helpers each read one area (routes, shop separation, logins and web attacks, store limits and rights); every finding they reported was checked by hand in the code before it counted (two of their claims were wrong and are marked). Then each real problem was tried for real in automated tests on the test database, fixed, and the test kept.

## What was checked

- **Every route** (`docs/audit/01-routes.md`): 452 routes in 35 controllers, with their permission, module and till-token checks. Three guards run on every request: rate limit, login (unless `@Public`), permission. A route with no permission needs a logged-in user of the shop; the 28 such routes were each checked (own account, setup steps, health, login pages) and none shows business data.
- **Shop separation**: all 131 tables have row-level security; 125 hold the shop directly, the other 6 are system tables. With no shop known the database shows nothing. Every nightly job runs shop by shop. All raw SQL uses parameters; none is built from what a user typed. Every code and number is unique per shop.
- **New automated sweep** (`module14-sweep.e2e-spec.ts`): shop B calls **every** list route of the API, and no answer contains the id of any of shop A's rows (all tables). The same for a store manager of one store against the other store's documents. Shop A's own lists show its ids on more than 30 routes, so the check can see a row when it is there.
- **Logins**: passwords (scrypt, salted, 10+ characters with letters and digits), reset and confirm links (random, stored only as a hash, one use, expiry), sessions (random, hashed, 30-minute idle and 12-hour limit, HttpOnly, Secure, SameSite cookies; switching a user or shop off stops them at the next request), lockouts and rate limits.
- **Web attacks**: requests from other websites are refused (exact origin list and an Origin check on every change); no unescaped HTML from shop-typed text in pages, receipts, emails or the Tally file; spreadsheet formula injection blocked in every export; uploads limited in size, zip bombs stopped, file names never used as paths; the GSTIN lookup cannot be pointed elsewhere and its key never reaches the browser or the logs; no secrets in the repository; errors never show internals.

## Findings

| # | Severity | Where | What is wrong | What a shop would see | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | High | `pos/pin.service.ts` | Manager PINs: the lock was checked before the slow PIN check, so PINs sent all at once were all tried. A cashier could try all 10,000 four-digit PINs in minutes and get any approval (discounts, price changes, cancelling bills). Proved: 20 guesses at once, all 20 tried. | A cashier approving their own discounts as the manager | ✔️ Fixed: each try first takes one of five in one database step; the fifth locks at once; plus a limit of 60 PIN tries per 10 minutes per connection |
| 2 | High | `users/delegation.ts`, `users.service.ts` | Someone trusted with "Manage users" could give stores they do not work in, or "all stores", to anyone including themselves | A Main-store manager giving themselves every store | ✔️ Fixed: only stores the person works in can be given |
| 3 | High | same | …and could reset the password, or change the email, of anyone with more rights (an accountant), then log in as them | Taking over the accountant's login | ✔️ Fixed: only people whose rights and stores the caller holds too can be changed, reset, logged out or have their PIN cleared |
| 4 | High | `accounting/payments.service.ts`, `journals.service.ts` | A store manager could cancel another store's posted money transfer or cash journal (its accounts reversed), edit its draft, and see every store's receipts, payments and journals | Anna Nagar's manager undoing Main store's cash deposit | ✔️ Fixed: lists show only the person's stores; opening, changing and cancelling check the store |
| 5 | High | `reports/dashboards.service.ts` | The owner dashboard (whole-company stock value and dues) opened for a store manager of one store; only the menu link was hidden | Company figures to a branch manager | ✔️ Fixed: same rule as the menu |
| 6 | High | `accounting/ledger-reports.service.ts` | Day book and ageing took any store from the address without checking it | Another store's every ledger entry | ✔️ Fixed |
| 7 | High | `inventory/stock-documents.service.ts` | The receiving store of a transfer could change, send or cancel the sending store's transfer | Stock leaving Main store on Anna Nagar's say | ✔️ Fixed: seeing it, either store; changing it, only the sender |
| 8 | Medium | `pos/pos-bills.service.ts`, `shifts.service.ts` | With the reports right, a till bill or shift of any store opened by its id | Another store's bills and expected cash | ✔️ Fixed |
| 9 | Medium | `purchasing/supplier-bills.service.ts` | Editing a draft bill, holding and releasing a bill: no store check | — | ✔️ Fixed |
| 10 | Medium | `purchasing/purchase-orders.service.ts`, `landed-charges.service.ts` | An order or freight entry covering several stores could be cancelled, closed or held by someone working in only one of them | — | ✔️ Fixed: changing needs every store on it |
| 11 | Medium | `documents/print.service.ts` | The purchase order print showed buying rates to people who may not see buying prices | Supplier prices on a receiving clerk's print | ✔️ Fixed: rates, amounts and totals left out (also from the data sent to the browser) |
| 12 | Medium | `imports/kinds.service.ts` | The prices export included buying price lists for people who may not see them | — | ✔️ Fixed |
| 13 | Medium | `purchasing/purchase-reports.service.ts` | Purchase register ignored store limits | — | ✔️ Fixed. (The helper's second claim, that paid bills are left out, is wrong: "unpaid" is the only finalised status.) |
| 14 | Medium | `platform/platform-auth.service.ts` | Retail ERP admin login: wrong passwords counted in a way that guesses sent all at once could bypass | — | ✔️ Fixed: counted in the database |
| 15 | Low | `users/users.service.ts` | Adding a user whose email is used in another shop gave a server error | "Something went wrong" | ✔️ Fixed: "A user with email … already exists" |
| 16 | Low | `main.ts` | API answers had no security headers and named the server software; a form-style body reader was on but never used | — | ✔️ Fixed: nosniff, no framing, referrer and resource policy; form bodies off |
| 17 | Low | `pos/pos-common.service.ts` | A cashier switch (12 hours) kept working after that cashier was switched off | — | ✔️ Fixed |
| 18 | Medium | `deploy/docker-compose.prod.yml` | The live database login is the database superuser. Shop separation still holds (every shop query switches to the limited `retail_erp_app` role), but system work runs with full rights | — | ☐ Session 12 (launch check #77): a dedicated owner role and a narrower system role |
| 19 | Medium | `reports/summary-email.service.ts` | Users are created with any email, never confirmed; summary emails go to them from no-reply@rademics.ai. A free sign-up could send mail to strangers | Our mail domain marked as spam | ☐ Owner: confirm a new user's email before any email goes to it (recommended) |
| 20 | Medium | `auth.service.ts` | Someone can keep re-locking a real user's account (5 wrong passwords, 15 minutes) | A cashier locked out all day | ☐ Later: lock per connection as well as per account |
| 21 | Medium | `pos/pos-bills.service.ts:961` | An offline bill keeps whatever price the till sends, without an approval | — | ☐ Session 5 (offline): check against the offline design (prices changed while offline are expected) and the check report |
| 22 | Low | various | Which accounts exist can be guessed from timing and messages (sign-up says an email is taken; login differs for a locked account) | — | ☐ Accepted for now; sign-up must say it |
| 23 | Low | `auth.service.ts` | Changing a password does not cancel a reset link still open (30 minutes) | — | ☐ Small fix later |
| 24 | Low | `users.service.ts` | "Users" shows staff of every store to a store manager with the right to view users | — | ☐ Owner to decide |
| 25 | Low | items, logo | Picture type is taken from the browser, not read from the file | — | ☐ Later (nosniff now set) |
| 26 | Low | `accounting/ledger-reports.service.ts` | Ageing for one store still adds a customer's bills from other stores | — | ☐ Session 2 |
| 27 | Medium | till (browser test) | A computer set up as another shop's till gives an unclear message | — | ☐ Launch check #93 |
| — | — | Prisma | A helper suspected that Prisma could merge lookups of two shops' requests made at the same instant | Never another shop's row (lookups use the requester's own values); at worst "not found" | ☐ Unsure; Session 8 (speed) to try it under load |

## Fixed today, with the tests that prove it

- `module14-audit1.e2e-spec.ts` (9 tests): owner dashboard, day book and ageing, money transfers (list, open, cancel), stock transfers (see yes, send or cancel no), clearing the Owner's PIN, giving stores, taking over a user with more rights, an email from another shop, and twenty PINs at once (run against the old code it failed: all 20 were tried).
- `module14-sweep.e2e-spec.ts` (2 tests): every list route, between two shops and between two stores.
- Full suite run alone afterwards (numbers in the summary below).

## Left for later

Items 18–27: three need the owner (19, 22, 24), the rest belong to later sessions (2, 5, 8, 12) or are small and low.

## Result

No Critical: no way was found for one shop to see another's data or for a stranger to get in. Every High was fixed today with a test. Session 1 is **done**; next is Session 2 (money and accounts).
