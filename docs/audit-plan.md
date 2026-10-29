# Production audit plan

Written 27 October 2026, before the Retail ERP is given to real shops.

**Goal:** check the whole system, part by part, so that a shop can trust it with its money, stock and GST, and we can support many shops on our own server.

**How we work:** one part per session. Each session fits one 5-hour usage window, finishes with a written result, and is never started "blindly": we read this plan, pick the next session, and do only that.

---

## 1. Where we stand (27 October 2026)

| Done | Result |
| --- | --- |
| Every screen tested by hand in the browser, A to Z | `docs/launch-check.md`: 91 problems found, 74 fixed, 10 waiting for the owner's decision, 7 planned for the deploy or accepted |
| First code audit (security, money, dates) | 11 security problems, 7 fixed; the rest are deploy-time items |
| Library security check | 18 known holes; 15 fixed by upgrading (two were critical in Next.js); 3 left inside a developer-only Prisma tool |
| Automated tests | 287 shared + 386 screen + 37 unit + 374 acceptance, all passing |

What this plan adds: a **deliberate, section-by-section audit** of the code and the running system, with written findings, instead of finding problems by chance while testing screens.

---

## 2. Rules for every session

1. **Clean room.** Only our own code and `docs/blueprint/`, `docs/decisions.md`; tax rules only from gst.gov.in, CBIC and the e-invoice/e-way portals. Never look at another ERP's code (CLAUDE.md §1).
2. **Never on the live server.** Audits run on the local copy and the test database (`retail_erp_test`). The live VPS is touched only in Session 12, and only with the owner's approval and the VPS rules in the global CLAUDE.md.
3. **Find first, then fix.** Each session writes its findings, ranks them, fixes what is safe to fix the same day, and lists the rest. A fix that touches money, stock or tax needs the owner's approval first (CLAUDE.md §6.3).
4. **Every fix gets a test**, and the whole suite runs, alone (two runs at once corrupt each other), before anything is committed.
5. **Plain language** in findings: what is wrong, what a shop would see, what we did.
6. **End of every session:** update the session's results file, update `docs/launch-check.md`, commit and push (when the owner says so), and write the next step at the bottom of this file.

### Severity

| Level | Meaning | Must be fixed before real shops? |
| --- | --- | --- |
| **Critical** | Money, stock or tax can come out wrong; one shop can see another's data; a stranger can get in | Yes, at once |
| **High** | A shop is blocked from working, or data can be lost | Yes |
| **Medium** | Confusing or slow, but there is a way round it | Before many shops |
| **Low** | Polish | When convenient |

### Results file for each session

`docs/audit/NN-name.md`, with this shape:

```
# Audit NN: <name>    Date:    Scope (folders, screens):
## What was checked   (list, so the next person knows it was covered)
## Findings           | # | Severity | Where (file:line or screen) | What is wrong | What a shop sees | Status |
## Fixed today        (with the test that proves it)
## Left for later     (why, and who decides)
```

---

## 3. The sessions

Order: the things that can hurt a shop most come first. Each session lists **what to check**, **how**, and **done when**.

### Session 1: Who can see and do what (security, access, shop separation)

Scope: `apps/api/src/auth`, `users`, `roles`, `platform`, `common`, every `*.controller.ts`; `packages/shared/src/permissions.ts`; database row-level security.

Check:
- Every endpoint has a permission check on the server (CLAUDE.md §4.11). A script lists every route with its decorators; any route without `@RequirePermission`, `@RequireAnyPermission`, `@Public` or an owner check is a finding.
- Store limits: a person limited to one store cannot read or change another store's records (bills, stock, shifts, cash, reports). Try each with a cashier of Anna Nagar.
- Shop separation: one shop can never see another's data. Two test shops; try every list and every "get by id" with the other shop's ids. Confirm row-level security is on for every business table.
- Nobody gives more rights than they hold (fixed 27 Oct; re-check every way in: users, roles, imports).
- Login, sessions, lockout, password reset, email links, PINs, the platform admin login: brute force, replay, expiry, logging out everywhere.
- Uploads (imports, logos): size, type, file name, zip bombs.
- Secrets: nothing in the repository, logs or error messages; `.env` never committed.
- Web attacks (added 28 Oct): cross-site request forgery (cookies, SameSite, CORS), cross-site scripting (shop-typed names on receipts, invoices, labels and emails), spreadsheet formula injection in exports, security headers, input checks and request size on every route, SQL built from user input, the server calling other sites (GSTIN lookup) with user input.

Done when: a route table with the check for each route, two-shop and two-store tests in the acceptance suite, no Critical or High left.

### Session 2: Money and accounts

Scope: `ledger`, `accounting`, `pos` (posting parts), `purchasing` (bills, payments), `loyalty` (points, gift cards); `packages/shared` money and rounding.

Check:
- No floating-point money anywhere: search for `Number(`, `parseFloat`, `toFixed` on money, `+` on amounts (CLAUDE.md §4.1).
- Rounding is defined once and tested (§4.2); decision L9 (till rounding allowance) answered.
- Every posting balances, and the save fails if it does not (§4.3); try forcing an unbalanced posting.
- Posted documents are never edited or deleted; cancelling posts the reverse (§4.4).
- Document, stock and ledger entries are saved in one database transaction (§4.5): kill the process half-way in a test and check nothing half-saved remains.
- Trial balance, profit and loss, balance sheet and cash flow agree with each other on a shop with a full month of activity.
- Points and gift cards are liabilities and come back right on returns.

Done when: a "books agree" acceptance test over a month of mixed activity; no Critical or High left.

### Session 3: Stock

Scope: `inventory`, stock parts of `pos`, `purchasing`, `orders`.

Check:
- Every stock change is a movement; current stock rebuilt from movements equals the stored figure, for every item and location (§4.6).
- Two cashiers selling the last piece at the same moment (§4.7): parallel test.
- Valuation (cost) after receipts at different prices, returns, transfers, counts, write-offs.
- Batches (earliest expiry first, expired refused), serial numbers / IMEI (never sold twice), sizes and colours.
- Negative stock at the till and how it is settled later.
- Transfers between shops, in transit, partly received.

Done when: a consistency check runs after every acceptance test; no Critical or High left.

### Session 4: GST and the law

Scope: `gst`, `gst-portal`, GST parts of `pos`, `purchasing`, `documents`; `packages/shared/src/gst-core.ts`.

Check, citing the official source for each rule:
- Tax invoice, bill of supply and credit note contents (CGST Rules 46, 49, 53).
- Place of supply, CGST/SGST against IGST, the clothing price band (decision L7), paise split (decision L8).
- HSN summary, B2B / B2C / credit notes in GSTR-1; GSTR-3B figures agree with the books.
- E-invoice and e-way bill files against the portal's published schema and limits.
- Invoice numbering: unique, at most 16 characters, per financial year.
- Composition dealers, reverse charge, input credit matching.

Done when: every rule in a table with its source; GSTR-1 and 3B of a test month agree with the ledger; decisions L7 and L8 answered.

### Session 5: Billing counter, offline and devices

Scope: `apps/web/src/components/till`, `lib/till`, `pos` API, `apps/till-helper`, `docs/plans/pos-offline-and-devices.md`.

Check:
- A bill sent twice is saved once; bill numbers unique per till; works after the till crashes or the browser is closed mid-bill.
- Offline for a day: prices, offers or stock changed meanwhile; what the shop is told.
- Shift open, cash in/out, close with count, differences and approvals.
- Receipt printer, cash drawer, scanner and Till Helper on a real Windows till.
- Speed: a 40-line bill on a slow computer.

Done when: an "offline day" acceptance test and a hands-on test on real till hardware.

### Session 6: Dates, numbers and the Indian calendar

Scope: everything that uses a date.

Check:
- Every business date uses Indian time (`businessDate()`), never the server's UTC date (§4.15). Search for `new Date().toISOString().slice(0, 10)`, `getDate()`, `setHours`.
- 1 April at 00:05 (new financial year), month ends, leap years, daylight saving does not exist in India but the server may be elsewhere.
- Scheduled jobs (nightly reorder, summary email, year creation) at the right Indian time.
- Amounts shown with Indian grouping (1,00,000) and dates as 27 Oct 2026 everywhere, including exports and prints.

Done when: a date test suite run with the server clock set to a few minutes before and after midnight Indian time.

### Session 7: Data safety, migrations and history

Scope: `apps/api/prisma`, `audit`, every model.

Check:
- Every business table records who created and last changed each row, and when (§4.8).
- The change history records posting, cancelling, price and permission changes (§4.9).
- Database changes only through committed Prisma migrations (§4.10); the migrations apply cleanly on an empty database and on a copy of the live one.
- Database rules back up the code: unique codes, foreign keys, no negative quantities where they cannot be.
- "Download all my data" and "Clear trial data" do exactly what they say.

Done when: a table of models with their audit columns and constraints; a restore of a backup into an empty database works.

### Session 8: Speed and growth

Scope: the slowest screens and reports; the database.

Check:
- Load a test shop with 2 years of data (50,000 items, 500,000 bills): every list, search and report under 2 seconds, and the till under 300 ms per scan.
- Missing indexes, queries inside loops, lists without pages.
- 20 tills billing at once on one server.
- Memory use of the API and the web server over a day.
- Growth beyond one server (added 28 Oct): what breaks with two API copies (nightly jobs running twice, in-memory caches and rate limits, sessions), database connection limits, how long a nightly job takes with 500 shops, the largest single shop we can carry.
- When an outside service is slow or down (GST network lookup, email, later e-invoice and payments): the shop keeps working, the work is retried, and nobody waits more than a few seconds.
- Running costs and limits: email per day (Hostinger: 100), GSTIN credits per shop, disk growth per shop per year, backup size.

Done when: timings written down before and after; nothing above the limits.

### Session 9: Screens, ease of use and accessibility

Scope: every screen in `apps/web/src/app` and `components`.

Check:
- The ease-of-use rules of the launch check: plain words, Indian dates and rupees, helpful empty lists, error messages next to the box, nothing lost on a mistake.
- Keyboard use (the till without a mouse), screen readers on the main screens, contrast in light and dark, phone layout.
- First-time shop: sign up, set-up guide, first bill, without help. Time it with someone who has never seen the product.

Done when: a new person sets up a shop and makes a bill unaided; no High left.

### Session 10: Libraries, licences and the build

Scope: `package.json` files, `pnpm-lock.yaml`, `docs/third-party-licences.md`, Dockerfiles.

Check:
- `pnpm audit`: no Critical or High (3 developer-only Prisma ones known today).
- Every library has a permissive licence (MIT, Apache-2.0, BSD, ISC) (CLAUDE.md §1.7); the licence list is up to date.
- The production image holds only the built app and production packages (launch check 65); runs as a non-root user.
- A routine for monthly library updates.

Done when: a clean audit and a slim image.

### Session 11: Tests and acceptance scenarios

Scope: `apps/*/test`, `docs/acceptance-tests.md`.

Check:
- Every scenario in `docs/acceptance-tests.md` has an automated test, and every money, tax and stock calculation has tests (§4.13).
- What is not tested: list the services and screens without tests and add the important ones.
- Tests that sometimes fail (one seen on 27 October in the purchase bill screen): make them reliable.

Done when: every scenario automated; the full suite passes three times in a row.

### Session 12: The live server, backups and running it (owner present)

Scope: `deploy/`, the VPS (with approval only), the global CLAUDE.md deployment rules.

Check:
- Deploy the security upgrades of 27 October first (Next.js was critically out of date on the live server).
- HTTPS everywhere with HSTS; security headers; IPv4 and IPv6 (dual-stack).
- The app's database login has no owner rights, so row-level security applies to it (launch check 77).
- `/.git/HEAD`, `/.env` and any database or upload path return 404.
- Backups: nightly, kept off the server, and a **restore actually tested**.
- Logs kept and readable; an alert when the API or database is down; disk space watched.
- A written "what to do when it breaks" page and a rollback.
- One-person team (added 28 Oct): everything needed to run and recover the system is written down (passwords in a root-only file, where backups are, how to deploy and roll back), so it does not depend on one memory.

Done when: the deployment checklist in the global CLAUDE.md passes and a restore has been done.

### Session 13: Ready for people (support, legal, first shops)

Check:
- Terms of use and a privacy policy (India's Digital Personal Data Protection Act, 2023), shown at sign-up. Needs the owner and a lawyer.
- Personal data (added 28 Oct): what we keep about shop customers (names, mobiles, birthdays, GSTINs), who can see it, how long it is kept, how a shop exports or deletes it, and what a data breach notice would need.
- Help: the shop guides in `docs/guides`, a support contact, how a shop reports a problem.
- Platform admin (see section 5 below): what Rademics needs to look after many shops.
- A pilot: one or two friendly shops for two weeks, a daily check of their books and stock, then a go / no-go meeting.

Done when: the go / no-go list at the end of this file is all ticked.

### Session 14: Code health for a one-person, AI-built product (added 28 October 2026)

Scope: the whole repository.

Check:
- The same rule written twice (for example the till and the server both pricing a bill): one place, or a test proving they agree.
- Tests that pass for the wrong reason: assertions that only repeat what the code does, mocks that hide the real database, tests never run in CI.
- Code paths no test reaches in money, stock, tax and security (coverage report on those folders).
- Dead code, unused settings, screens no menu reaches, TODOs.
- Library calls and options that do not exist or are deprecated; type checks and lint warnings switched off.
- The docs match the code: plans, decisions and acceptance tests describe what is built today.

Done when: a coverage figure for the money, stock, tax and security folders, the duplicated rules listed with a test for each, and no warnings left in type check and lint.

### What each session covers (A to Z)

| Topic | Session |
| --- | --- |
| Access, logins, passwords, PINs, sessions, shop and store separation, web attacks, uploads, secrets | 1 |
| Money, rounding, double entry, cancelling, loyalty and gift cards | 2 |
| Stock, cost, batches, serials, two cashiers at once | 3 |
| GST law, returns, e-invoice and e-way files | 4 |
| Billing counter, offline, devices, crash recovery | 5 |
| Indian dates, financial year, scheduled jobs, number and date formats | 6 |
| Audit columns, history, migrations, constraints, backups restore, data export | 7 |
| Speed, large shops, many shops, two servers, outside services down, costs and limits | 8 |
| Ease of use, accessibility, phone layout, first-time shop | 9 |
| Libraries, licences, image size, monthly updates | 10 |
| Tests and acceptance scenarios | 11 |
| Live server, HTTPS, headers, monitoring, alerts, backups, runbook, rollback | 12 |
| Legal, privacy (DPDP Act), support, pilot shops | 13 |
| Code health, duplicated rules, AI-built risks, docs matching code | 14 |

---

## 4. How to run one session (step by step)

1. Open this file and the previous session's results; pick the next session.
2. Start the local database and apps (CLAUDE.md §7); make sure the full test suite passes before changing anything.
3. **Read** the scope folders (for big folders, read-only helper agents may survey them and report back; their findings are checked by hand before they count).
4. **Try** the risky things for real: in the browser, through the API, and as automated tests on the test database.
5. Write each finding in the results file as you go, with severity.
6. Fix the Critical and High ones that do not need the owner's decision; add a test for each.
7. Run the whole suite alone; record the numbers.
8. Update `docs/launch-check.md` and the "Progress" table below; ask the owner to commit and push.

Rough size: Sessions 1 to 4 are the largest and may need two windows each; the rest fit in one.

---

## 5. Platform admin (Rademics' own screen)

Today, at `/admin` (separate from every shop's logins; the live password is kept in a root-only file on the server):
- **Shops**: every shop with its owner, city, shop type, users, bills, last active and trial end; switch a shop off or on with a reason (kept in that shop's history).
- **Messages**: the contact form messages, marked as handled.

To add before many shops (owner to choose; each needs a short plan first):
- Extend or end a trial; mark a shop as paying; its plan.
- Shop health at a glance: till sync problems, failed emails, errors, storage used.
- More than one admin, each with their own login and two-step sign-in; a history of what admins did.
- A support view of a shop only with the shop's consent, time-limited and recorded.
- Messages to all shops (planned downtime, new features).
- Requests to export or delete a shop's data (privacy law).

---

## 6. Go / no-go before giving it to people

- [ ] Sessions 1 to 7 done with no Critical or High open
- [x] The owner's decisions L1 to L12 recorded (`docs/decisions.md`, 28 October 2026)
- [ ] Security upgrades deployed (done 27 October 2026); live server checks pass (Session 12)
- [ ] Backup restore tested
- [ ] Terms and privacy policy published
- [ ] Two pilot shops ran two weeks with books, stock and GST agreeing
- [ ] Support contact and help guides ready

---

## 7. Progress

| Session | Status | Date | Results |
| --- | --- | --- | --- |
| 1. Security and access | **Done**: 28 findings, all closed (2 Critical, 7 High) | 28 Oct 2026 | `docs/audit/01-security-access.md`, route table `docs/audit/01-routes.md` |
| 2. Money and accounts | **Done**: 18 findings, all closed (1 Critical, 6 High) | 28 Oct 2026 | `docs/audit/02-money-accounts.md` |
| 3. Stock | **Done**: 17 findings, 3 Critical and 5 High fixed with tests | 28 Oct 2026 | `docs/audit/03-stock.md` |
| 4. GST | **Done**: 15 findings and the owner's decisions T1–T15, all closed | 28 Oct 2026 | `docs/audit/04-gst.md` |
| 5. Billing counter and offline | **Done**: 21 findings and the owner's decisions C1–C9, all closed; hands-on till test for the owner | 29 Oct 2026 | `docs/audit/05-billing-counter.md`, `docs/audit/05-till-hands-on-checklist.md` |
| 6. Dates | Not started | | |
| 7. Data safety | Not started | | |
| 8. Speed | Not started | | |
| 9. Screens and ease of use | Partly done by the launch check | 27 Oct 2026 | `docs/launch-check.md` |
| 10. Libraries and build | Partly done (upgrades) | 27 Oct 2026 | `docs/launch-check.md` #90, #91 |
| 11. Tests | Not started | | |
| 12. Live server | Not started | | |
| 13. Ready for people | Not started | | |
| 14. Code health | Not started | | |

**Next step:** Session 6 (dates, numbers and the Indian calendar). Owner to run the hands-on till checklist (05). Carried to Session 8: stock re-costing speed (03 #14). Carried to Session 12: the Rule 138 value of delivery charges and the SEZWPA / SEZWPNA split (04, accepted items).
