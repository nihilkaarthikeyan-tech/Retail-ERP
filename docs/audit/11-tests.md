# Audit 11: Tests and acceptance scenarios    Date: 30 October 2026

Scope: `apps/*/test`, the web and shared unit tests, `docs/acceptance-tests.md`.

How: two helpers read the code and changed nothing:
- Helper A matched every scenario in `docs/acceptance-tests.md` (about 230) against the tests.
- Helper B ran the unit tests with coverage and compared all 459 API routes with the URLs the tests call.

The whole suite was then run three times in a row.

## Findings

| # | Severity | What was wrong | Status |
| --- | --- | --- | --- |
| 1 | High | Of the 9 minimum scenarios (CLAUDE.md §6.6), only the transfer was checked for stock, accounts and GST together; the rest were spread over several tests, each missing part | ✔️ `module20-audit11`: all 9 end to end, each to the paisa by account, plus book health and stock against accounts after each |
| 2 | High | A9.4 (Finalise and Post ask first) had no test | ✔️ Web test: "No" sends nothing, "Yes" sends exactly one |
| 3 | Medium | A9.1–A9.3 only partly tested: keyboard-only sale, the cursor going back after a dialog, a locked till, leaving with unsaved changes | ✔️ Web tests for each |
| 4 | Medium | 11.8 (return without the bill) checked only on the till; 11.9 (year-end) never checked the stock-against-accounts refusal; A7.2 had no e-way bill case | ✔️ API tests |
| 5 | Medium | The till's "changes since" download could miss a save that began before the download and finished after it (found while fixing a test that relied on a 20 ms pause) | ✔️ Fixed: it reaches back 5 minutes; the till merges by id, so the overlap only sends a few rows twice. Test added |
| 6 | Medium | Money, tax and stock branches no test reached: offers on return lines and below a minimum amount; sharing over zero weights; stock in at quantity 0 or negative cost; a count with no cost; two receipts on one consignment line; GST rate over 100; charges with nothing to share by; GST figures within half a paisa; e-way bill missing pieces; points and gift card methods | ✔️ `packages/shared/src/audit11.spec.ts` |
| 7 | Medium | Till checks no test reached: an item gone or switched off, a missing serial, no price, no GST rate, a bill discount bigger than the bill, a business invoice without the buyer's address, refund payments, how much of a line can still come back, parked bills, closing with bills waiting | ✔️ `apps/web/src/lib/till/audit11.test.ts` |
| 8 | Medium | Purchase bill line checks and reopening a saved draft never ran | ✔️ Added to `bills.test.tsx` |
| 9 | Medium | Flaky: the sign-in retry test waited 6 s of real time inside an 8 s limit | ✔️ Runs on a fake clock (0.1 s) |
| 10 | Medium | Flaky: the purchase bill test took the first write as the debit note | ✔️ Picks the debit note by its address |
| 11 | Medium | E-mail tests paused 50–80 ms for the mail; the "no e-mail" test passed even if the mail was only slow | ✔️ They wait for the mail; "no e-mail" is proved by a later mail that does arrive alone |
| 12 | Low | Two screen tests proved "nothing appeared" after a 20 ms pause | ✔️ They wait until the sign-in has loaded, then check |
| 13 | Low | The test database reset left "filed months" behind for the next file | ✔️ Added to the reset list |
| 14 | Low | A5.3 in the list said ₹2,150; the test uses ₹200 | ✔️ List corrected |
| 15 | Low | Audits 1–3 had tests but no entries in the list | ✔️ A1–A3 added |
| 16 | High | Nothing checked that the till prices a bill exactly as the server does. The till works out offers, discounts, bill discounts, IGST and rounding itself, and offline bills are not checked again | ✔️ `module21-audit11b`: the till's own pricing code prices 5 bills from the till's real download, and the server must agree line by line. A total that does not match is refused (PRICE_CHANGED) and nothing is saved |
| 17 | High | Goods received against a purchase order used the item's *current* box size, not the one ordered. 2 boxes of 12 ordered at ₹600, received after the box was changed to 10, came in as 20 pieces at ₹60 instead of 24 at ₹50 | ✔️ Fixed: a receipt against an order line uses that line's box size. Test added |
| 18 | Medium | Routes no test called: the balance sheet; undoing a payment link; cancelling an opening bill; points and gift cards used as plain payments; changing an item's box size after stock came in; unit conversions; 12 purchase, till and sales reports and dashboards; editing draft bills, receipts, payments and journals; switching off a GST registration in use | ✔️ `module21-audit11b`: 19 tests. All passed on their first run: the code did what it should |

## Accepted, with the reason

- **A run that crosses midnight Indian time** can fail a few API tests that read "today" more than once. This happens only to a run started just before midnight; run the tests again.
- **The speed check (A8.4)** stays a separate kit (`apps/api/perf`), run by hand before a release: it needs a 2-year database and about an hour.
- **Changing an item's box size is allowed** after stock came in. Every saved document keeps the box size it was made with, so nothing already saved changes (tested), and orders now keep theirs too (finding 17).
- **One till test** waits 30 ms to show that nothing printed by itself with 0 copies. The printing it guards against happens at once when it happens, so the risk of a false pass is small.

## Result

Every scenario in `docs/acceptance-tests.md` has an automated test except A8.4 (the speed kit, run by hand). The full suite passed three times in a row (30 October 2026, 13:54–14:39), each time:

| Part | Tests |
| --- | --- |
| Acceptance (API, end to end) | 497 (was 468) |
| Web screens | 482 (was 463) |
| Shared | 324 (was 314) |
| API unit | 54 |
| Till Helper | 98 |

Two product fixes came out of the tests: goods received on an order keep the order's box size, and the till's "changes since" download overlaps by 5 minutes. Session 11 is **done** (30 October 2026).
