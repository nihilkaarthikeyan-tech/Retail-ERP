# Plan — Module 5: Purchasing (orders, goods receipts, supplier bills, returns, extra charges)

Status: **approved by the project owner on 15 October 2026** with these answers to section 10:
1. Accounts: option A, as in module 4 (values and account roles stored now, posted from module 7).
2. GST: recorded as stated on the supplier's bill, with an arithmetic check; stock valued before GST; the CA confirms later.
3. Approval limit: ₹50,000.
4. Bill price different from the receipt price: warn (the Accountant confirms; the difference is kept for module 7).
5. Internal requests: reorder suggestions → draft orders for launch; formal request documents later.
6. Currency: rupees only.
7. Allowances: 0% over-ordering, over-receipt and over-billing by default; item-level allowances and user rights for exceptions.

Sources: `docs/blueprint/07-purchasing.md`, the purchase parts of `06-suppliers.md`, `08-inventory.md` and `12-accounting-effects-map.md`, `docs/decisions.md` (questions 24, 27–31, 52, 55–56, 62, 69–70), launch scope row "Buying stock and receiving goods", the approved module 4 plan (accounting option A, reorder levels), CLAUDE.md rules 1–15.

## 1. What this module gives the business

1. **Purchase orders** to suppliers: items, quantities, units, buying prices (from the supplier's buying price list, else the last purchase price), discounts, GST as stated by the supplier, the store each line goes to, date needed, the supplier's quotation reference (decision 28), payment terms and due dates.
2. **Goods receipts**: goods arriving at a store, against one or more order lines or without an order (decision 31: allowed only with a manager reason, logged). Each line splits into **accepted** (shelf) and **rejected** (the store's Rejected location, **kept at cost**, decision 30). Batches, expiry dates and serial numbers are taken here. A **received-goods check** is recorded: who checked, date and time, result, quantities and remarks (decision 29).
3. **Supplier bills**: the supplier's invoice, recorded against goods receipts, or as a bill that **also receives the goods** (small cash purchases), or for services. The supplier's bill number is checked for duplicates per supplier per financial year. Bills can be **held** with a reason and an end date.
4. **Returns to the supplier**: from a goods receipt (including straight from the Rejected location) or from a bill (**debit note**). Goods leave at their **original cost**, not today's cost.
5. **Extra charges on goods received** (freight, loading, unloading): shared over one or more receipts by quantity, by value, or by hand, and added to the stock cost. Later movements are re-costed by the existing stock engine.
6. **Free goods** (decision 27): a line can carry free quantity; the supplier's total is spread over paid + free units, so the average cost is right.
7. **Reorder suggestions**: the reorder levels saved in module 4 produce a list of "items below reorder level" per store, each with the usual supplier and the suggested quantity. One click turns ticked lines into **draft purchase orders**, one per supplier. Runs nightly (Indian time, rule 15) and on demand.
8. **Progress tracking**: an order shows how much has been received and billed. A receipt shows how much has been billed and returned. Orders can be held, closed (the rest is no longer expected) and reopened.
9. **Last purchase price** on each item is updated when a receipt (or a receiving bill) is finalised. It stays hidden from cashiers (decision 70).
10. **Reports**: order follow-up (ordered / received / billed / pending / days late), goods received not billed (with age), purchase register (every bill line with supplier, price, quantity and GST), purchases by supplier and by item. All can be exported to Excel (decision 65).

## 2. Accounts and GST — how they are handled before modules 7 and 8

Purchasing creates money owed to suppliers and GST input credit. But the chart of accounts (decision 55) and every GST rule (decisions 56–64) need the Chartered Accountant's approval first, and accounting is module 7.

- **Accounts: the same approach as module 4 (option A).** Every document line stores its value and the **account role** it will post to: `stock`, `goods_received_not_billed`, `supplier_payable`, `gst_input`, `purchase_expense`, `freight_inward`, `purchase_price_difference`, `rounding`. Module 7 adds the real ledger posting inside the same transaction. Until then **supplier balances and payments are not shown or recorded** (decision 51: balances come only from the ledger). Bills show their own amount and status, for example "not paid".
- **GST: recorded as the supplier states it, never worked out by our rules.** Each line stores the GST rate and the CGST / SGST / IGST amounts typed from the supplier's bill. The rate is pre-filled from the last purchase of that item, and the backend checks that the amounts add up and match the rate within ₹0.01 per line. Whether input credit is allowed, reverse charge and the HSN rate master come with the GST module after CA approval. **Stock cost = the amount before GST**, the usual treatment when input credit is claimed. The CA must confirm this (question 2).
- TDS is not built (decision 62). Advances, payments on the spot and write-offs need cash/bank accounts and come with module 7.

## 3. Data model (Prisma)

Every table has the four audit columns. Quantities are `Decimal(18,3)`, prices and unit costs `Decimal(16,4)`, amounts `Decimal(16,2)`. Business dates are Indian dates (rule 15).

| Table | Main fields |
| --- | --- |
| `PurchaseOrder` | `companyId`, `number`, `supplierId`, `orderDate`, `neededBy`, `supplierQuoteRef`, `deliverToStoreId` (default for lines), `paymentTermsId`, `status` (`draft` / `to_receive_and_bill` / `to_receive` / `to_bill` / `completed` / `on_hold` / `closed` / `cancelled`), `subtotal`, `discountAmount`, `taxAmount`, `total`, `receivedPercent`, `billedPercent`, `approvedById` (when above the approval limit), `holdReason`, `closeReason`, `remarks` |
| `PurchaseOrderLine` | `orderId`, `lineNo`, `itemId`, `unitId`, `factor`, `quantity`, `freeQuantity`, `basicQuantity`, `rate`, `discountPercent`, `discountAmount`, `taxableAmount`, `gstRate`, `cgst`, `sgst`, `igst`, `lineTotal`, `storeId`, `neededBy`, `receivedQuantity`, `billedAmount`, `reorderSuggestionId` |
| `PaymentSchedule` | `documentType` (`purchase_order` / `supplier_bill`), `documentId`, `dueDate`, `share`, `amount`, built with module 3's `dueDateFrom` |
| `GoodsReceipt` | `companyId`, `number`, `supplierId`, `storeId`, `receivedAt` (instant) + `postingDate`, `deliveryNoteNo`, `transporterName`, `vehicleNo`, `noOrderReason` (decision 31; required when no line has an order), `status` (`draft` / `to_bill` / `partly_billed` / `completed` / `returned` / `closed` / `cancelled`), totals, `isReturn`, `returnOfId`, `checkedById`, `checkedAt`, `checkResult` (`passed` / `passed_with_remarks` / `failed`), `checkRemarks` (decision 29), `billedPercent`, `returnedPercent` |
| `GoodsReceiptLine` | `receiptId`, `lineNo`, `orderLineId`, `itemId`, `unitId`, `factor`, `receivedQuantity`, `acceptedQuantity`, `rejectedQuantity`, `freeQuantity`, `basicAcceptedQuantity`, `basicRejectedQuantity`, `rate`, discounts, `taxableAmount`, GST fields, `extraChargesAmount`, `unitCost` (per basic unit, after free goods and charges), `shelfLocationId`, `rejectedLocationId`, `batchId`, `serialNumbers`, `billedQuantity`, `returnedQuantity`, `returnOfLineId` |
| `SupplierBill` | `companyId`, `number` (ours), `supplierId`, `supplierBillNo`, `supplierBillDate`, `postingDate`, `financialYearId`, `kind` (`against_receipt` / `receives_goods` / `services` / `debit_note`), `receivesGoods`, `storeId`, `paymentTermsId`, `dueDate`, `status` (`draft` / `unpaid` / `cancelled`; paid / overdue states come with module 7), `holdReason`, `holdUntil`, totals, `roundingAdjustment`, `returnOfId` |
| `SupplierBillLine` | `billId`, `lineNo`, `receiptLineId`, `orderLineId`, `itemId`, `unitId`, `factor`, `quantity`, `rate`, discounts, `taxableAmount`, GST fields, `lineTotal`, `priceDifference` (bill vs receipt), `accountRole` |
| `LandedCharge` | `companyId`, `number`, `postingDate`, `status`, `shareBy` (`quantity` / `value` / `manual`), `transporterBillId` (optional link to a services bill), `total`; children `LandedChargeReceipt` (receipt ids), `LandedChargeItem` (`description`, `chargeType` = `freight` / `loading` / `other`, `amount`), `LandedChargeShare` (`receiptLineId`, `amount`) |
| `ReorderSuggestion` | `companyId`, `storeId`, `itemId`, `supplierId`, `onHand`, `onOrder`, `reorderLevel`, `reorderQuantity`, `suggestedQuantity`, `businessDate`, `status` (`open` / `ordered` / `dismissed`), `orderLineId` |
| `PurchaseSettings` (one per company) | `requireOrderForReceipt` (false, decision 31), `overOrderPercent`, `overReceiptPercent`, `overBillingPercent`, `priceMismatch` (`allow` / `warn` / `block`), `checkSupplierBillNo` (true), `approvalLimit` (decision 69), `fillLastPurchasePrice` (true) |

Items get an optional `overReceiptPercent` that overrides the company figure. Number series (module 1 engine): `PO-`, `GRN-`, `PB-` (bill), `PRT-` (return), `DN-` (debit note), `LC-` (extra charges).

**Permission keys:** `purchase.view`, `purchase.order` (create / finalise orders up to the approval limit), `purchase.approve` (finalise above the limit, hold, close), `purchase.receive` (receipts, received-goods check), `purchase.receive_without_order`, `purchase.over_receive`, `purchase.bill`, `purchase.return`, `purchase.charges`, `purchase.settings`. Buying prices and costs still need `buying_prices.view` / `stock.cost.view` (decision 70).

**Role seeds:**

| Role | Permissions |
| --- | --- |
| Stock/Receiving | view and receive |
| Store Manager | view, order, approve, receive, receive without an order, return |
| Accountant | view, bill, return, charges, settings |
| Owner/Admin | everything |
| Cashier | nothing |

## 4. Business rules (backend, all tested)

- **Supplier:** must pass module 3's `assertSupplierUsable` (not switched off; not blocked; not held for orders/bills unless the hold has ended). Supplier ratings are not used (decision 24).
- **Items:** buyable, active, not past their end date; stock items need a store; fractions only where the unit allows them (decision 11). The minimum order quantity is checked per item when one is set.
- **Dates:** a line's needed-by date is not before the order date. A receipt is not in the future and not before its order date. The bill date is not before the order date. The due date is not before the posting date. Every posting date falls in an open financial year and after the stock lock date (module 4 rules, including back-dating by the Accountant only, decision 35).
- **Orders:** finalising raises the "on order" quantity. Above the approval limit, the order needs `purchase.approve` (decision 69); there is no budget check (decision 52). A finalised order may have its quantities, prices, dates and stores changed: the checks run again and every figure is recalculated, and the change is logged. Orders on hold or closed refuse receipts and bills. An order cannot be cancelled while a finalised receipt or bill refers to it.
- **Receipts:**
  - Received = accepted + rejected; no negatives except on returns.
  - Supplier, item and unit must match the order line.
  - Accepted over all receipts may not exceed ordered × (100 + allowance) ÷ 100 (item allowance, else company). Going beyond it needs `purchase.over_receive` and gives a warning.
  - Without an order: `purchase.receive_without_order` and a reason, logged (decision 31).
  - Batch items need a batch, created if the item says so. Expired batches are refused (decision 13). Serial numbers must be unique and not already in stock.
  - Rejected goods go to the store's Rejected location **at the same cost** (decision 30).
  - A receipt cannot be cancelled while a bill, return or extra charge refers to it.
- **Bills:**
  - The supplier bill number is unique per supplier per financial year.
  - Billed amount per order line is within the over-billing allowance.
  - Bill lines against a receipt cannot exceed received − already billed.
  - A price difference against the receipt follows `priceMismatch`. With the default `warn`, the Accountant confirms and the difference is stored with the `purchase_price_difference` role (question 4).
  - A bill can be held only after finalising, with a reason and an end date in the future. The hold lifts itself on the end date (nightly job, Indian date). A return cannot be held.
  - A receiving bill acts as a receipt too and follows all the receipt rules.
- **Returns:**
  - Every line is a minus quantity and exists on the original. Per line, it cannot exceed the original minus earlier returns (received, accepted and rejected separately). Returns from the Rejected location are limited by the original rejected quantity.
  - Batches and serials must be ones that came in on the original and are still in that location. Goods leave at the original unit cost.
  - The original's returned share and the order's received quantity go down, so the order can be supplied again.
  - A debit note without an original is allowed and uses the current cost.
- **Extra charges:** only on finalised receipts (or receiving bills) of one company. The shares add up to the total exactly: automatic sharing puts the rounding remainder on the last line, and hand-typed shares must match within ₹0.02. Finalising re-costs the receipt lines and every later movement of those items through `StockEngine` in one transaction. Cancelling reverses it.
- **Stock and concurrency:** all stock changes go only through module 4's `StockEngine.post` / `reverse`, in the same transaction as the document, with row locks (rules 5–7). Back-office negative stock stays blocked, which matters for returns (decision 32).
- **Cancelling:** finalised documents are never edited or deleted (rule 4). Cancelling writes reversing entries and rolls back the order, receipt and bill shares.
- **History:** finalise, cancel, hold, close, approval, price override, over-receipt, receipt without an order and settings changes go to the audit log in the same transaction (rule 9).

## 5. Calculations (in `packages/shared`, pure functions, all tested)

- Line: `taxable = round(qty × rate − discount)`; GST amounts as typed, checked against `taxable × rate ÷ 100` within ₹0.01; `lineTotal = taxable + GST`; document total rounded to the rupee with the difference in `roundingAdjustment` (decision 5: ₹0.50 and above rounds up).
- **Free goods (decision 27):** cost per basic unit = (taxable + extra charges) ÷ basic (paid + free) quantity.
- **Cost per basic unit** = (taxable amount + share of extra charges + price difference carried from the bill) ÷ basic accepted quantity, rounded to 4 places. The rounding loss between stock value and line amount is stored with the `rounding` role.
- **Extra-charge share** = total × line quantity ÷ total quantity, or × line value ÷ total value; the remainder goes on the last line.
- **Over-receipt / over-billing:** refused when (received − ordered) ÷ ordered × 100 > allowance + 0.01.
- **Received % / billed %** = Σ min(received, ordered) ÷ Σ ordered × 100 (amounts for billed).
- **Return value** = original line unit cost × returned basic quantity.
- **Reorder suggestion** = reorder quantity if set, else (reorder level − (on hand + on order)), rounded up to the order unit; only when on hand + on order < reorder level.
- **Due dates** from module 3's `dueDateFrom(terms, supplierBillDate or postingDate)`.

## 6. Screens (Bazaar look; the purchase pages use the pink "Purchases" colour)

Menu section **Purchases**:
- **Orders:** list (filter by status, supplier, store, overdue) and editor (supplier picker with hold warning, lines with scan box and price fill, totals, Finalise / Hold / Close / Reopen / Cancel, progress bars for received and billed).
- **Receive goods:** start from an order (pick open lines) or without an order (reason box), with scan entry, accepted / rejected split per line, batch / expiry / serial pickers, a received-goods check panel, and a live cost per unit.
- **Supplier bills:** list (filter by status, supplier, held, due) and editor (from receipts, from an order, or standalone; supplier bill number and date; price difference warnings; Hold / Release).
- **Returns to supplier:** start from a receipt or a bill, or from the Rejected location.
- **Extra charges:** pick receipts, enter charges, choose how to share, see the preview, Finalise.
- **Reorder suggestions:** a list per store with tick boxes and "Create orders".
- **Reports** (as in §1) and **Purchase settings**.

## 7. API

```
GET/POST   /purchase/orders            GET/PATCH /purchase/orders/:id
POST       /purchase/orders/:id/{finalise|hold|release|close|reopen|cancel}
GET        /purchase/orders/:id/open-lines            (for receipts and bills)
GET/POST   /purchase/receipts          GET/PATCH /purchase/receipts/:id
POST       /purchase/receipts/:id/{finalise|cancel|close}
POST       /purchase/receipts/:id/check               (received-goods check, decision 29)
POST       /purchase/receipts/:id/return              (makes a draft return)
GET/POST   /purchase/bills             GET/PATCH /purchase/bills/:id
POST       /purchase/bills/:id/{finalise|cancel|hold|release}
POST       /purchase/bills/:id/debit-note
GET/POST   /purchase/charges           GET/PATCH /purchase/charges/:id
POST       /purchase/charges/:id/{finalise|cancel}
GET        /purchase/charges/preview?receiptIds&shareBy
GET        /purchase/reorder-suggestions?storeId      POST /purchase/reorder-suggestions/run
POST       /purchase/reorder-suggestions/create-orders  {suggestionIds[]}
GET        /purchase/reports/{order-follow-up|received-not-billed|register|by-supplier|by-item}
GET/PATCH  /purchase/settings
```

Every endpoint checks the permission and the user's store rights (rule 11).

## 8. Tests

**Unit (no database):** line and total maths with rounding, free-goods cost, cost per unit with charges, charge sharing (quantity / value / manual, remainder on the last line), over-receipt and over-billing limits, received/billed percentages, return value at original cost, reorder suggestion quantity, GST amount check, due dates, and the 00:05-IST-on-1-April date case for the nightly jobs.

**Integration (test database):**
- every acceptance scenario below;
- two people finalising receipts that both use the last allowed quantity of an order line, so only one succeeds (rule 7);
- a bill number used twice by one supplier in a year is refused, and the same number next financial year is allowed;
- cancel blocked while a later document refers to the receipt;
- stock position always equals the ledger sum after every test (the module 4 helper).

## 9. Acceptance scenarios (added to `docs/acceptance-tests.md`, section "Module 5", before building)

Sample: supplier Sri Murugan Traders (Net 30), item Basmati Rice 1 kg (PCS, GST 5% as stated by the supplier), store MAIN, existing stock 100 at ₹90.0000. Account roles are what module 7 will post.

- **5.1 Purchase order** — 200 × ₹95.00 to MAIN: taxable ₹19,000.00, GST ₹950.00 (CGST 475 + SGST 475), total ₹19,950.00. On finalising, on order 200; no stock change.
- **5.2 Purchase receipt (CLAUDE.md minimum)** — receive 120: 118 accepted, 2 rejected. Shelf: 218 at ₹92.7064 (moving average (100×90 + 118×95) ÷ 218 = 92.70642…), value ₹20,210.00. Rejected location: 2 at ₹95.0000, value ₹190.00 (decision 30). Roles: stock +11,400.00 / goods received not billed −11,400.00. Order: received 60%, on order 80; status "waiting for goods and bill".
- **5.3 Supplier bill against the receipt** — bill no. SMT/1182: 120 × ₹95 = ₹11,400.00 + GST ₹570.00 = ₹11,970.00, due 30 days from the bill date. Roles: goods received not billed +11,400.00, GST input +570.00 / supplier payable −11,970.00. Receipt fully billed; order billed 60%.
- **5.4 Duplicate bill number** — a second bill SMT/1182 from the same supplier in 2026-27 is refused; the same number from another supplier is accepted.
- **5.5 Return the rejected goods** — return 2 from the Rejected location: Rejected 0, value ₹0.00; they leave at ₹95.0000 (original cost); roles: supplier payable +190.00 or goods received not billed +190.00 (depending on billing) / stock −190.00. Order received quantity back to 118, so 82 can still come.
- **5.6 Receipt without an order** — refused for Stock/Receiving staff; a Store Manager with a reason succeeds and the reason is in the history (decision 31).
- **5.7 Over-receipt** — with a 0% allowance, receiving 83 more against the 82 still expected is refused; a user with `purchase.over_receive` gets a warning and it is accepted.
- **5.8 Free goods** — 10 paid at ₹100 + 2 free: 12 enter stock at ₹83.3333 each, value ₹1,000.00 (decision 27).
- **5.9 Extra charges** — freight ₹600 shared by value over a receipt of rice ₹9,500 and dal ₹2,500 → rice +₹475.00, dal +₹125.00. Unit costs go up accordingly; a sale made after the receipt is re-costed.
- **5.10 Bill that also receives goods** — cash-style bill for 5 × ₹40 at MAIN: stock +5 at ₹40.0000; roles: stock +200.00, GST input +10.00 / supplier payable −210.00.
- **5.11 Cancel** — cancelling the receipt of 5.2 is refused while its bill exists. After cancelling the bill and then the receipt, stock is back to 100 at ₹90.0000 and the order to 0% received.
- **5.12 Held supplier and expired batch** — a supplier held for bills cannot get a new order or bill. A batch-tracked item whose batch expired yesterday cannot be received (decision 13).
- **5.13 Reorder suggestions** — reorder level 50, quantity 100; on hand 30, on order 0 → suggest 100 from the item's usual supplier; "Create orders" makes one draft order per supplier and marks the suggestion ordered. Nothing is suggested while on hand + on order ≥ 50.

## 9b. Deliberately not built in this module

| Item | Why / where |
| --- | --- |
| Ledger postings, supplier balances, payments, advances, write-offs, bills paid on the spot | Module 7 (decision 51, 55). Values and account roles are stored now. |
| GST rules (input credit eligibility, reverse charge, HSN rate master, GSTR-2B matching) | Module 8 after CA approval. Supplier-stated GST is recorded now. |
| TDS | Decision 62. |
| Requests for quotation, quotation comparison | Decision 28 (only a quotation reference field). |
| Internal request documents (move / internal use) and customer drop-ship lines | Not needed for launch; reorder suggestions cover "items running low". See question 5. |
| Quality inspection templates | Decision 29 keeps only the received-goods check record. |
| Foreign currency, exchange differences | Question 6. |
| Supplier ratings, budgets | Decisions 24, 52. |

## 9c. Decisions made while building (for the project owner to confirm)

1. **Document numbers:** these patterns can be changed on the numbering screen.
   - `PO-{STORE}-{FY}-` for orders;
   - `GRN-{STORE}-{FY}-` for goods receipts;
   - `PRT-{STORE}-{FY}-` for returns;
   - `PB-{FY}-` for supplier bills;
   - `DN-{FY}-` for debit notes;
   - `LC-{FY}-` for extra charges.
2. **Receiving staff do not see buying prices** (decision 70 applied to purchases). Their receipts take the price from the order, the price list or the last purchase price.
3. **Rejected goods count as received** for the order, and the supplier can bill them (the supplier's bill usually covers everything delivered). Returning them reduces the received quantity, so the order can be supplied again.
4. **"Same financial year"** for duplicate bill numbers means the year of the supplier's bill date.
5. **A debit note** reduces the billed share of the goods receipt, not of the order (blueprint 07: "normally yes / normally no"). For a bill that received the goods, the goods also leave stock at their original cost.
6. **A bill that also receives the goods** keeps a draft goods receipt from the start, so batches, expiry dates and serial numbers are kept. Finalising the bill posts that receipt; cancelling the bill cancels it.
7. **Over-billing** beyond the allowance uses the same right as over-receipt (`purchase.over_receive`), with a warning.
8. **The GST rate** is pre-filled from the item's last purchase when none is typed; the supplier's figures can always be typed instead.
9. **Stock engine fix:** a cancelled document now counts as never having happened when checking for negative stock (for example a cancelled return followed by cancelling the receipt). A real shortage, such as goods already sold, is still refused.
10. **Excel export** of the reports is a CSV file that opens in Excel (no new library).
11. **Menu colours:** Purchases uses the pink purchase colour; Parties moved to indigo.

## 10. Questions for the project owner

1. **Accounts:** use the same approach as module 4: store values and account roles now, post to the books from module 7? Supplier balances and payments then appear only after module 7. Recommended **yes**.
2. **GST on purchases:** record the GST **as written on the supplier's bill** (rate and amounts, with an arithmetic check) and value stock **before GST**, with the CA confirming later? Recommended **yes**. The alternative is to record purchases without GST until the CA approves, which would mean re-entering bills later.
3. **Approval limit (decision 69):** orders above what amount need a Store Manager or Owner to finalise? Suggested **₹50,000**.
4. **Bill price different from the receipt price:** recommended **warn**. The Accountant confirms the difference, which is stored for module 7. Alternatives: **block** (always refuse) or **allow** (no warning).
5. **Internal requests:** OK to use **reorder suggestions → draft purchase orders** for launch, and leave the formal internal-request documents for later? Recommended **yes**.
6. **Currency:** rupees only at launch (all suppliers Indian)? Recommended **yes**.
7. **Allowances:** default **0%** over-ordering, **0%** over-receipt and **0%** over-billing, with exceptions only for users given the right? Fresh-produce shops often use 5–10% for weight items, and items can carry their own allowance.
