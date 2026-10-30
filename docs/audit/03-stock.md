# Audit 03: Stock    Date: 28 October 2026

Scope: `apps/api/src/inventory` (stock engine, documents, counts, transfers, reports), the stock parts of `pos` (till bills, returns, serials, batches), `purchasing` (receipts, returns), `orders`; `packages/shared/src/stock-costing.ts`; the till engine in `apps/web/src/lib/till`.

How: three read-only helpers (the engine and moving-average cost; batches, serials and negative stock; two things at once). Each finding was checked by hand; the real ones were tried as automated tests, fixed and the tests kept.

## What was checked

- **Only the engine writes stock**: positions and batch positions are written only by the stock engine from movements; a database trigger refuses deleting or changing what a movement was.
- **Moving average** cost, unit cost to 4 decimals and value to paise; an ordinary sale that empties a shelf takes the whole remaining value; till returns come back at the sale's cost.
- **Back-dating** replays every later movement in order, cascades to linked movements (transfers) and posts corrections against each movement's own account; limits: the right to back-date, current month, the stock lock and the open year.
- **The back office never goes below zero**, now or at any later date; the till may (decision 32) and flags it.
- **Locks**: stock positions are locked in a fixed order before any quantity is read; a till bill sent twice is saved once; number series are locked; transfers, purchase returns and debit notes lock their lines.
- **Batches**: expired batches refused at goods receipt, on stock documents (except a write-off for expiry) and at the till online, earliest unexpired picked. **Styles** are never stocked, priced or sold.

## Findings

| # | Severity | Where | What is wrong | What a shop would see | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical | `pos/pos-bills.service.ts` | The same goods returned at two tills at the same moment were both refunded (what is left to return was checked before saving, without a lock) | Money paid out twice; stock up twice | ✔️ Fixed: the original bill lines are locked and checked again inside the save |
| 2 | Critical | same | The same serial (IMEI) scanned on two bills at once was sold twice; one serial twice on one bill was accepted | One phone sold to two people; stock short | ✔️ Fixed: online, a serial is taken only if still in stock at the till, and every serial must be taken |
| 3 | Critical | `packages/shared/src/stock-costing.ts` | A movement at a fixed cost (a return to the supplier, goods out of transit) that emptied a shelf left its movements adding up to a value while the shelf showed nothing | Stock and the stock account drifting apart | ✔️ Fixed: emptying a shelf always takes the whole remaining value; for a return to the supplier the averaging difference goes to cost of goods sold, so goods received not billed still clears with the debit note |
| 4 | High | same | Free goods (cost 0) were sold at the "fallback" cost, pushing the stock value below zero | A negative stock value with goods on the shelf | ✔️ Fixed: goods in stock leave at their own cost, even 0 |
| 5 | High | `pos/pos-bills.service.ts` | A return put back any serial named, even one sold again since or never sold here | A phone shown in stock while a customer holds it | ✔️ Fixed: it must be out, sold on the bill being returned (or by this shop) |
| 6 | High | same | Cancelling a bill while a return of it was being saved let both go through | Refund twice | ✔️ Fixed: the return holds the original bill; the cancel checks again under its lock |
| 7 | High | `inventory/stock-documents.service.ts` | Cancelling a stock-in, stock-out, move or transfer put serials back unchecked (a phone sold since brought back); a transfer could be received with any serial in transit; serial counts take whatever serials are listed and cancelling a count does not undo them | Serials at the wrong store | ✔️ Fixed: cancels check each serial is still where the document put it; a transfer receives only serials sent on it; a count refuses a serial recorded at another place or in transit, and cancelling a count undoes its serial changes; tests in `module15-audit3` |
| 8 | High | `ledger.service.ts` | When goods arrive into negative stock by transfer or stock-in, or a later re-costing changes a receipt, the correction for the pieces already sold goes to the movement's own account (transfer clearing, goods received not billed) instead of cost of goods sold | A few rupees stuck in clearing accounts | ✔️ Owner approved 28 Oct: goods arriving into minus stock by transfer or stock-in, and later re-costing of an arrival, send the correction for pieces already sold to cost of goods sold; transfer clearing ends at zero (test in `module15-audit3`) |
| 9 | Medium | `stock-costing.ts`, transfers | Moving all of a shelf leaves paise in transfer clearing (the receiving side is priced at the rounded unit cost) | Paise in clearing | ✔️ Fixed: goods coming from another movement bring exactly the value that left it |
| 10 | Medium | various cancels | Cancelling a document can overwrite a counter another document changed at the same moment (received and returned quantities) | A transfer receivable twice in a rare race | ✔️ Fixed: cancels lock the lines whose counters they write back (`lockRows`), like the create paths; receiving a transfer locks the send, returning goods locks the receipt |
| 11 | Medium | `pos/pos-bills.service.ts` | A till number already used gives a server error and the offline queue keeps retrying; two browser tabs on one till could take the same number | A stuck queue | ✔️ Fixed: a bill number already used is a plain refusal and a sync problem for the office; two tabs of one till share the counter under the browser's lock |
| 12 | Medium | batches | When no batch has enough, the till takes the first batch into minus, which a later receipt (a new batch) never settles; offline sales of batch items pick a batch at sync | Batch stock not matching item stock | ✔️ Fixed: with no batch holding enough, the one with the most goes below zero (a count settles it); offline, a sale of goods whose batches all expired is kept with the last-expiring batch and flagged, instead of failing; a return without a bill comes back into a batch of the item |
| 13 | Medium | counts | A same-day draft keeps the time it was made, so finalising later sits before the sales in between | Counts needing the Accountant | ✔️ Fixed: a same-day draft with no typed time takes the moment it is finalised (counts keep the moment they were counted); a same-day count with sales after it no longer needs the Accountant |
| 14 | Medium | engine | Re-costing an old, busy item re-walks every later movement with no limit | A slow or timed-out save | ✔️ Session 8: the re-costed rows are now written 2,000 per statement instead of one at a time |
| 15 | Medium | `stock-reports.service.ts` | The consistency check does not check unit cost, a replay of the movements, a negative value with stock, or the stock account per store | Problems found late | ✔️ Fixed: the check also finds movements without a position, goods with a value below zero, an empty shelf with a value, a unit cost that is not value ÷ quantity, and a break in the running quantities; it runs after every acceptance test file |
| 16 | Medium | transfers | No way to close a part-received transfer short, or write off from transit | Goods stuck in transit | ✔️ Owner approved 28 Oct: "Close short" on In transit writes off what never arrived (Write-off, sending store), marks its serials out and stops further receiving; test in `module15-audit3` |
| 17 | Low | reorder, free offer lines of serial items, returns into an expired batch, a deadlock between two crossed exchanges (no data harm) | — | — | ✔️ Fixed: reorder counts goods on their way from another store; a serial item cannot be an offer's free item; a deadlock between two exchanges is retried once. Accepted by design: a return against a bill goes back into the batch it was sold from even if that batch has expired (the goods are that batch; an expired batch is never sold again) |

## Fixed today, with the tests that prove it

- `module15-audit3.e2e-spec.ts` (4 tests): two returns at once refunded once; one phone on two bills at once sold once, and twice on one bill refused; a phone resold is not put back by a second return; cancel and return at the same moment, never both.
- `stock-costing.spec.ts` (2 new tests): a fixed-cost movement emptying a shelf leaves it matching its movements (5 @ 80, 10 @ 100, 5 sold, 10 returned: the return takes ₹933.33); free goods leave at 0.
- The return-to-supplier tests of decision L5 and audit 2 still hold (goods received not billed clears with the debit note).

## Result

Three Critical, five High and every Medium and Low closed with tests, or decided by the owner (#8, #16). One item is a speed question (#14), measured in Session 8 with real volumes. Session 3 is **done** (28 October 2026).
