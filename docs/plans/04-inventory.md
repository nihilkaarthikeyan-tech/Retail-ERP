# Plan — Module 4: Inventory (stock locations, stock movements, valuation)

Status: **approved by the project owner on 15 October 2026** with these answers to section 10:
1. Accounting: option A — store value changes and account roles on every stock ledger line now; module 7 adds the ledger posting inside the same transaction.
2. Locations: Shop floor + Back room + Rejected per store, one Transit per company; more can be added by hand.
3. Reorder levels: stored per item per store now; the automatic reorder job comes with purchasing (module 5).
4. Write-offs, stock-in and counts: staff draft them, Store Manager (or above) finalises. Repack is left for later.

Sources: `docs/blueprint/08-inventory.md`, the stock parts of `03-items.md`, `docs/decisions.md` (questions 7–8, 13, 30, 32–37), CLAUDE.md reliability rules 5–7 and 15.

## 1. What this module gives the business

1. **Stock locations** per store: shop floor and back room (bottom level), the store as a folder above them, a **transit** location per company for transfers (decision 37) and a **rejected/quarantine** location per store (decision 30).
2. **Stock movements**, each a numbered document that is drafted, finalised and (if wrong) cancelled — never edited after finalising (rule 4):
   - **Stock in** — opening stock, stock found, free goods.
   - **Stock out** — damage, expiry, theft/loss, samples, shop use (write-offs).
   - **Transfer** between stores — always two steps through transit (decision 37): *send* (out of the sender, into transit) and *receive* (out of transit, into the receiver), partial receipts allowed, the rest stays in transit.
   - **Move inside a store** — back room → shop floor, one step.
3. **Stock counts** — opening stock load, normal count, with a **blind count** option; differences posted as one movement.
4. **Stock ledger** — one line per item, location and movement, never typed: quantity in/out, cost per unit, running quantity, running value. Current stock is always the sum of the ledger (rule 6).
5. **Moving-average costing** per item and location (decisions 33–34; no FIFO, no LIFO, no per-batch valuation in version 1).
6. **Batches** with manufacture and expiry dates for batch-tracked items; **expired batches cannot leave stock as a sale or be received** (decision 13). **Serial numbers** for serial-tracked items (where each piece is).
7. **Negative stock**: blocked in the back office (transfers, write-offs, counts) — decision 32. The till's "allow and flag" rule is built with point of sale (module 6) on top of the same engine; this module provides the flag and the daily **negative-stock exception report**.
8. **Locks**: a **month-end stock lock** (decision 36); **back-dated** movements only by the Accountant, only within the current month, with full history (decision 35); later movements re-costed automatically.
9. **No two people take the last unit**: the stock position row of an item+location is locked (`SELECT … FOR UPDATE`) while a movement is written (rule 7).
10. **Reports**: stock balance (per item × location, as at a date), stock history (ledger), stock by store, batch expiry, negative-stock exceptions, quick stock lookup by scan.

## 2. The one big question: accounting entries (please decide)

CLAUDE.md rule 5 says every document that affects stock **or accounts** posts its stock and ledger entries in the same transaction. Inventory movements are supposed to post accounting entries (stock account against stock adjustment / write-off / temporary opening). But the **chart of accounts needs the Chartered Accountant's approval first (decision 55)** and accounting is module 7.

| Option | What it means |
| --- | --- |
| **A. Build stock now, post accounts from module 7 (recommended)** | Every stock ledger line stores its **value change** and the **account role** it should post to (`stock`, `stock_adjustment`, `write_off`, `temporary_opening`, `transit`). When module 7 is built, the posting is added *inside the same transaction* for every new movement. Nothing goes live before module 7 anyway, and the pre-go-live test-data wipe (decision 72) removes any development movements that never had ledger entries. Stock value can be reconciled with the books from day one of live use. |
| B. Build a minimal chart of accounts now | Means inventing accounts before the CA has approved them — against decision 55. Not recommended. |
| C. Do accounting (module 7) before inventory | Changes the build order in CLAUDE.md and accounting has little to post without stock and sales. Not recommended. |

## 3. Data model (Prisma)

All tables have the four audit columns; quantities `Decimal(18,3)`, money `Decimal(16,4)` unit costs and `Decimal(16,2)` values.

| Table | Purpose / main fields |
| --- | --- |
| `StockLocation` | `companyId`, `storeId` (null for the company transit location), `parentId`, `code`, `name`, `kind` (`folder` / `shelf` / `transit` / `rejected`), `isLeaf`, `active`. Created automatically for every store (folder + Shop floor + Back room + Rejected) and once per company (Transit). |
| `StockDocument` | `companyId`, `number` (from number series per kind and store), `kind` (`stock_in` / `stock_out` / `transfer_send` / `transfer_receive` / `move` / `count`), `reason` (`opening`, `found`, `free_goods`, `damage`, `expiry`, `theft_loss`, `sample`, `shop_use`, …), `status` (`draft` / `finalised` / `cancelled`), `postingDate` (Indian business date, rule 15), `postingTime`, `storeId`, `fromLocationId`, `toLocationId`, `sendDocumentId` (receive → its send), `remarks`, `isBackDated`, `cancelledById`, `cancelReason`, `totalValueIn`, `totalValueOut`. |
| `StockDocumentLine` | `documentId`, `lineNo`, `itemId`, `unitId`, `quantity` (in the line unit), `factor`, `basicQuantity`, `batchId`, `serialNumbers` (array), `unitCost` (for stock in / counts), `countedQuantity`, `expectedQuantity` (counts), `valueChange`, `receivedQuantity` (send lines: how much has arrived). |
| `StockLedgerEntry` | append-only; `itemId`, `locationId`, `batchId`, `documentId`, `documentLineId`, `postingDate`, `postingTime`, `sequence`, `quantityChange`, `unitCost`, `quantityAfter`, `unitCostAfter`, `valueAfter`, `valueChange`, `accountRole`, `isCancellation`, `isNegativeFlag`. UPDATE/DELETE refused by trigger except by the re-costing routine (see §4). |
| `StockPosition` | one row per item × location (× batch for batch items): `quantity`, `unitCost`, `value`, `lastPostingAt`. Locked row-by-row while writing. Always equal to the sum of the ledger; a check report proves it. |
| `Batch` | `itemId`, `batchNumber` (unique per item), `manufactureDate`, `expiryDate`, `supplierId`, `active`. Created on stock in / receipt; auto-numbered when the item says so; expiry = manufacture + shelf life when not typed. |
| `SerialNumber` | `itemId`, `serial` (unique per item), `status` (`in_stock` / `in_transit` / `out` / `sold` later), `locationId`, `batchId`, `inDocumentId`, `outDocumentId`, `warrantyUntil`. |
| `InventorySettings` (per company) | `stockLockDate` (month-end lock), `allowNegativeAtTill` (true, decision 32 — used by module 6), `defaultReceivingLocationKind`, `batchPickOrder` (`earliest_expiry` default). |

Permission keys: `stock.view`, `stock.move` (draft and finalise moves, transfers, write-offs), `stock.count`, `stock.adjust_finalise` (finalise counts and write-offs above zero value — Store Manager), `stock.backdate` (Accountant, decision 35), `stock.lock` (Accountant / Owner), `stock.cost.view` (values and unit costs; hidden from cashiers, decision 70).

## 4. Business rules (all in the backend, all tested)

- **Locations:** only active leaf locations of the document's company; a location with any ledger entry can't be deleted or become a folder.
- **Items:** stock items only, not styles, active, not past end date (module 2's `assertItemUsable(…,'stock')`); fractional quantities only for weight/length/volume units (decision 11).
- **Batches / serials:** required for tracked items, refused for untracked; an expired batch cannot be received or sent out except by a write-off with reason `expiry` (decision 13 — no override).
- **Movement types:** stock in needs only a destination; stock out only a source; a move needs both and they must differ; a transfer send must go *to transit* and to a *different store*; a receive cannot exceed sent − already received.
- **Negative stock:** any back-office movement that would make quantity < 0 — at its own date *or at any later date* — is refused, naming how many more are needed (decision 32). Rounding tolerance 0.0001.
- **Moving average:** receipt: new cost = (Q₀×C₀ + q×c) ÷ (Q₀+q), or c if Q₀ ≤ 0; issues leave the cost unchanged and are valued at quantity × current cost; transfers carry the sender's cost into transit and on to the receiver (no profit). **Fallback cost** when stock is zero or negative: last cost in that location → last cost in any location → last purchase price → refused with a "missing cost" message (zero cost only if the line says so).
- **Counts:** expected quantity is taken at the count's date and time; lines with no difference are dropped; nothing left → refused; opening-stock counts use the `temporary_opening` account role and need a cost; normal counts use `stock_adjustment`.
- **Rounding:** all values via the shared `roundMoney`, quantities via `roundQuantity` (rule 2).
- **Dates (rule 15):** posting date defaults to today's Indian business date; future dates refused; must be inside an open financial year.
- **Locks and back-dating:** nothing on or before `stockLockDate`; a posting date before the latest ledger entry of that item+location needs `stock.backdate` **and** must be in the current calendar month (decision 35), and re-costs every later entry for that item+location in the same transaction (bounded by the month rule, so it stays small).
- **Cancelling:** writes equal and opposite ledger entries and re-costs later ones; a transfer send can't be cancelled after anything was received; nothing is ever deleted.
- **Concurrency:** positions locked with `FOR UPDATE` in a fixed order (item id, location id) to avoid deadlocks.
- **History:** finalise, cancel, back-dating and lock changes go to the audit log in the same transaction (rule 9).

## 5. Screens

Stock locations (tree per store) · Stock movements list (filter by kind, status, store, date) · Movement editor (lines with scan box, batch/serial pickers, live expected cost and value, Finalise / Cancel) · Transfers: "In transit" list for the receiving store with **Receive** (pre-filled from the send) · Stock count (pick location, add items by scan or "all items of group", blind option, expected vs counted, finalise) · Stock balance report · Stock history (ledger) · Batch expiry · Negative-stock exceptions · Quick stock lookup (scan → quantity per location) · Inventory settings (lock date).

## 6. API

```
GET/POST /stock/locations            PATCH /stock/locations/:id
GET/POST /stock/documents            GET/PATCH /stock/documents/:id   (draft only)
POST     /stock/documents/:id/finalise   POST /stock/documents/:id/cancel {reason}
GET      /stock/transfers/in-transit     POST /stock/transfers/:sendId/receive
GET/POST /stock/counts  … same lifecycle as documents (kind = count)
GET      /stock/balance?locationId&itemId&groupId&asOf
GET      /stock/ledger?itemId&locationId&from&to&batchId
GET      /stock/lookup/:code             (scan → quantity per location)
GET      /stock/batches?itemId&expiringWithinDays
GET      /stock/exceptions/negative
GET/PATCH /stock/settings
```

Internal service for later modules (purchasing, POS, returns): `StockEngine.post(tx, movements[], { allowNegative })` and `StockEngine.reverse(tx, documentId)` — the only code that writes ledger entries and positions.

## 7. Tests

Unit (no database): moving-average maths (receipts, issues, negative then positive, zero-quantity edge), fallback-cost chain, transfer cost carry-over, count difference, rounding to paise, batch expiry date from shelf life, lock and back-dating rules.

Integration: every acceptance scenario below; **20 parallel issues of the last 5 units → exactly 5 succeed** (rule 7); a back-dated receipt re-costs a later issue; cancelling restores quantity and value exactly; stock position always equals the sum of the ledger after every test (a shared assertion helper).

## 8. Acceptance scenarios (added to `docs/acceptance-tests.md`, section "Module 4")

Each states the expected stock result and the **account roles** that module 7 will post.

- **4.1 Opening stock** — count of type *opening* at MAIN shop floor: 100 × Basmati Rice at ₹90 → quantity 100, value ₹9,000.00, cost ₹90.0000; roles: stock +9,000 / temporary opening −9,000.
- **4.2 Moving average** — then stock in 50 at ₹96 → 150 at ₹92.0000, value ₹13,800.00.
- **4.3 Write-off** — 3 damaged → 147, value ₹13,524.00; roles: write-off +276 / stock −276.
- **4.4 Transfer between shops (CLAUDE.md minimum)** — send 20 MAIN → ANNA: MAIN 127 (₹11,684.00), transit 20 (₹1,840.00); receive 15: transit 5, ANNA 15 at ₹92.0000; receive the last 5 → transit 0; total stock value of the company unchanged at every step.
- **4.5 Negative stock blocked in the back office** — writing off 200 from MAIN refused ("127 available, 73 more needed"); nothing changes.
- **4.6 Last unit, two people** — 20 parallel issues of 1 when 5 remain → 5 succeed, 15 refused, quantity 0, never −1.
- **4.7 Stock count** — counted 125 where 127 expected → −2 at ₹92 (roles: stock adjustment +184 / stock −184); blind count hides the expected figure.
- **4.8 Expired batch** — a batch expired yesterday cannot be transferred or received; it can only be written off with reason *expiry*.
- **4.9 Back-dating** — a Store Manager cannot post dated before the last movement; the Accountant can within the current month, and the later issue's cost is re-worked; last month is refused even for the Accountant.
- **4.10 Month-end lock** — after locking 30 Sep, any movement dated on or before 30 Sep is refused.
- **4.11 Cancel** — cancelling the stock in of 4.2 restores 100 at ₹90 exactly; the document stays visible as cancelled.
- **4.12 Ledger explains the stock** — after all of the above, every stock position equals the sum of its ledger lines (rule 6).

## 9. Deliberately not built in this module

| Item | Why / where |
| --- | --- |
| Accounting entries | Module 7 after CA approval (see §2). Values and account roles are stored now. |
| Firm reservations against customer orders | Need sales orders; not in launch scope. |
| Automatic reordering / internal requests | Needs purchasing (module 5); see question 3. |
| FIFO, LIFO, per-batch and per-serial valuation | Decisions 7, 33–34. |
| Repack (several items out, one in) | See question 4. |
| Stock closing (frozen balances) beyond the month-end lock | Decision 36 keeps only the month-end lock. |
| Racks, bins, capacity rules | Decision 36. |

## 9b. Decisions made while building (for the project owner to confirm)

1. **Cancelling posts reversing lines at the original date and time**, so the stock and its cost go back exactly as they were (scenario 4.11), and later movements are re-costed. Because that is back-dating, cancelling a document from an **earlier month** needs the Accountant (`stock.backdate`), and nothing on or before the stock lock date can be cancelled.
2. **A past date typed without a time counts as the end of that day** (23:59 Indian time), so it sorts after everything already posted that day.
3. **Counts of batch or serial items post the difference** for each batch (or the missing / extra serial numbers) rather than "setting" the quantity; a serial count lists the complete set of serials at the location.
4. **Staff choose the batch** on outgoing lines in the back office; automatic batch picking by expiry comes with the till (module 6).
5. **Automatic batch numbers** are item code + date + a running number (e.g. `ITM-000004-20261015-1`) when the item is set to number batches automatically.
6. **Account roles stored per reason**: opening → temporary opening; found / free goods / other in → stock adjustment; damage / expiry / theft-loss → write-off; samples → samples expense; shop use → shop-use expense; moves and transfers → transfer (stock to stock). The CA confirms the actual accounts with the chart of accounts (decision 55).
7. **The Accountant finalises but does not draft** stock-ins, write-offs and counts (approved answer 4); a Store Manager drafts back-dated entries and the Accountant finalises them (scenario 4.9).

## 10. Questions for the project owner

1. **Accounting entries:** approve option **A** (store values and account roles now; post ledger entries from module 7, same transaction from then on)?
2. **Locations per store:** Shop floor + Back room + Rejected for every store, one Transit for the company. Enough, or do some stores need more (e.g. a godown)? More can always be added by hand.
3. **Reorder levels:** set them per item per store now (data only) and build the automatic reorder job with purchasing (module 5)? Recommended yes.
4. **Repack** (making gift hampers, breaking cartons into singles with different codes): needed at launch? Recommended **later**.
5. **Who finalises write-offs and counts?** Recommended: Stock/Receiving staff draft them; Store Manager (or above) finalises.
