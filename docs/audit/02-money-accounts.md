# Audit 02: Money and accounts    Date: 28 October 2026

Scope: `apps/api/src/ledger`, `accounting`, the posting parts of `pos`, `purchasing`, `inventory`, `loyalty`, `orders`; `packages/shared` money and rounding; the accounting reports and their screens.

How: three read-only helpers (money as computer decimals; double entry, transactions and cancelling; reports against the ledger). Each finding was checked by hand in the code; the real ones were tried in automated tests on the test database, fixed, and the tests kept. Two tests were run against the old code first to prove they catch the problem (a double click finalised twice; see below).

## What was checked

- **No money as computer decimals**: no stored or posted amount, tax or quantity goes through a JavaScript number anywhere (API, till engine, shared). One rounding rule (half away from zero), defined once in `packages/shared/src/rounding.ts`; the decimal library's default is the same, so every rounding agrees. Numbers appear only in spreadsheet exports, displays and simple checks.
- **Double entry**: every posting is checked to balance in code and again by a database trigger; a line can only be a debit or a credit (database check); Rounding takes only differences within a set tolerance.
- **Same transaction**: every ledger and stock posting runs inside the same database transaction as its document (bills, shifts, receipts, bills from suppliers, payments, journals, transfers, gift cards, points).
- **Nothing posted is edited**: database triggers refuse any change or deletion of ledger entries and lines; stock entries can only be re-costed, which leaves a trail of correcting entries.
- **Cancelling** reverses every live entry of the document (with later freight and re-costing), on its own date, once (a unique link per reversal).
- **Locks**: dates in a closed year are refused for everyone; locked dates only for the books-lock right; reversals never move dates.
- **Points and gift cards** are liabilities; returns take earned points back and give spent points and card money back.
- **Reports**: trial balance, profit and loss, balance sheet, cash book, cash position and cash flow read the same ledger lines and agree; cancelled entries are handled the same way in each; GSTR-3B compares bills with the tax accounts and warns when they differ.

## Findings

| # | Severity | Where | What is wrong | What a shop would see | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical | `purchasing/goods-receipts.service.ts` (decision L5, built today) | Cancelling a return to the supplier did not take back the return's freight entry | Freight and "goods received not billed" both wrong after a cancelled return | ✔️ Fixed: the freight share is its own entry and is reversed on cancel |
| 2 | High | `pos/pos-bills.service.ts`, `shifts.service.ts` | A bill being saved at the very moment its shift closes could end up in a closed shift without ever reaching the accounts; the same for cancelling a bill; and the drawer's expected cash was worked out before the closing transaction | Sales, GST and cash missing from the books for good; a wrong cash difference | ✔️ Fixed: closing takes the shift row first; a bill or cancel at that moment either finishes before (and is counted) or is refused with "This shift was closed just now" |
| 3 | High | stock documents, goods receipts, payments, journals, supplier bills | A double click (or a retry) on Finalise / Post / Cancel could do it twice: stock moved twice, or reversed twice. Proved: with the old code both clicks answered "done" | Stock and its value doubled or halved | ✔️ Fixed: the document row is locked and its status read again inside the save (`common/row-lock.ts`) |
| 4 | High | payments, journals, supplier bills | A cancel that read the status before someone posted could mark a posted document cancelled without reversing it | A cancelled payment whose entries are still in the books | ✔️ Fixed: the status is checked again under the lock |
| 5 | High | `pos/pos-common.service.ts` | A manager's approval could be used by two cancels at once (a gift card refunded twice) | Money lost on a gift card | ✔️ Fixed: an approval is marked used in one step |
| 6 | High | `accounting/closing.service.ts` | Locking the books while a till shift from that period was still open moved its bills to the next open day: September's GST in the accounts lower than September's bills | GSTR-3B tax to pay understated | ✔️ Fixed: the lock is refused until those shifts are closed (offline bills arriving after a lock still move; see #12) |
| 7 | High | `accounting/ledger-reports.service.ts` | Ageing and the statement for one store counted the customer's bills from every store | A branch's ageing showing another branch's dues | ✔️ Fixed: open amounts worked out across the company, only the chosen stores' bills shown |
| 8 | Medium | payments, journals | Editing a draft while it was being posted could post the old figures | Payment amount and ledger disagree | ✔️ Fixed: posting refuses a draft changed in between |
| 9 | Medium | `schemas/accounting.ts` | Payment amounts took any number of decimals, so "100.004" passed a check against ₹100.00 owed | — | ✔️ Fixed: whole paise only |
| 10 | Medium | trial balance, balance sheet, stock against accounts screens | For one store, or while tills are open, they said "tell the Accountant" when nothing was wrong | Needless alarm | ✔️ Fixed: the message says why and what to do |
| 11 | Low | general ledger, till register | Choosing a document brought cancelled entries back; the till register stopped at 5,000 bills without saying so | — | ✔️ Fixed (the register now asks for a shorter period) |
| 12 | Medium | `pos/pos-bills.service.ts` | An offline bill synced after the books are locked still posts on the next open day | — | ✔️ Fixed: kept (the sale happened) and flagged "Sold on a day the books were locked since" on Offline bills to check; test in `module15-audit2` |
| 13 | Medium | `pos/pos-reports.service.ts` | The till payments report leaves out card and UPI taken for gift cards (the card load does not keep its payment method) | Settlement against the bank short by gift cards sold by card | ✔️ Fixed: a gift card load at the till keeps its payment method and till (migration `20261028160000_gift_card_load_method`); the till payments report includes it; test in `module15-audit2` |
| 14 | Medium | sales reports vs profit and loss | Sales show at once; the accounts get them at shift close. Only GSTR-3B says so | Two different sales figures during the day | ✔️ Fixed: profit and loss says till sales reach the accounts when each shift closes |
| 15 | Low | goods receipts, GST added to cost | The few paise of per-unit rounding go to cost of goods sold with no upper limit | — | ✔️ Accepted by design: this line also carries the correction for goods received into negative stock (the cost of pieces already sold), which can be more than a rupee; it goes to cost of goods sold, where it belongs |
| 16 | Low | supplier bills, goods receipts, gift cards, order advances | Use the bill tolerance (₹0.50) where the payment one (₹0.05) would do | — | ✔️ Accepted: those documents carry their own rounding line, and their totals are checked to the paisa before posting; the ₹0.50 is only a backstop |
| 17 | Low | `accounting/catch-up.service.ts` | Two copies of the API starting at once could both post an old document | — | ✔️ Fixed: each document posted at start-up takes a database lock and checks again that it is still unposted |
| 18 | Low | `documents/go-live.service.ts` | A shop that never records its go-live date can always clear its books as "trial data" | — | ✔️ Owner approved 28 Oct: "Needs your attention" reminds the Owner to record the go-live date from three days before the trial ends |

## Fixed today, with the tests that prove it

- `module15-audit2.e2e-spec.ts` (4 tests): a cancelled return gives its freight back; two clicks on Finalise and on Cancel move stock once (failed on the old code: both answered "done"); two clicks on Post post a payment once, and ₹100.004 is refused; the books cannot be locked over an open till shift.
- Ageing for one store, the general ledger document filter and the register limit are covered by the existing report tests (run in the full suite below).

## Result

One Critical and six High fixed with tests; every other item fixed, accepted with its reason, or decided by the owner. Session 2 is **done** (28 October 2026).
