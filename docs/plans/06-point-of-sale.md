# Plan: Module 6, Point of sale (the billing counter)

Status: **approved by the project owner on 15 October 2026** with these answers to section 11:
1. GST: option A. The HSN GST rate list is built now; bills are marked provisional; tills go live only after the CA approves the rates and the Owner switches go-live on. *(Changed 22 October 2026 by the owner: no approval step; rates apply as soon as they are saved, bills are never provisional, and only the Owner's go-live switch remains. See `docs/plans/08-gst.md`.)*
2. Offers: simple offers and coupons. The best one is applied automatically. Cumulative, slab and stacking offers come later.
3. Cashier discount: up to 5% without a manager PIN, never above the item's maximum.
4. One shift per till, with PIN switching between cashiers.
5. No credit sales at the till until module 7. (Module 7's plan, answer 2, adds them: see `07-accounting.md` §1a.)
6. A cash difference above ₹100 at closing needs a manager PIN and a remark.
7. Companion plan answers: the offline queue on every till; printer and cash drawer now, display and scale later; manager approvals need the connection.

The companion plan `pos-offline-and-devices.md` (offline queue and till devices) is approved with the same date (CLAUDE.md §6.5).

Sources: `docs/blueprint/09-point-of-sale.md`, the offers part of `04-pricing-and-promotions.md` (deliberately left for this module by plan 02), the till receipt in `16-printing-and-documents.md`, `docs/decisions.md` questions 5, 9, 13, 17–19, 22, 32, 39–44, 54, 56, 60, 68, 70, 76, 80, 81, the launch scope row "Billing counter with offline queue, returns, exchange, shift close, card/UPI payment recording", CLAUDE.md rules 1–15.

## 1. What this module gives the shop

1. **Tills:** each till belongs to one store and sells from one stock location (normally the Shop floor). Each has:
   - its own bill number series and price list;
   - the payment methods it accepts;
   - the cashier's discount limit.
2. **Payment methods:** cash, card, UPI and other, each with its kind and whether it may be used for refunds.
3. **Shifts:** open a till with starting cash, record **cash in / cash out** during the shift (decision 41: float top-ups, petty payments), and close with a **count of notes and coins** (₹500, 200, 100, 50, 20, 10 notes; ₹20, 10, 5, 2, 1 coins). The closing shows expected, counted and the difference per payment method.
4. **Billing screen**, built for speed:
   - scan or search by barcode, item code or name;
   - the number pad changes quantity, price or discount;
   - customer: walk-in by default, find by mobile, or quick-add with name and mobile (module 3);
   - park and recall bills, split payment over cash, card and UPI, change worked out, receipt printed.
5. **Selling rules at the till:**
   - **Stock and batches:** stock leaves **at once** on every sale (decision 39). Selling beyond stock is allowed and flagged (decision 32). Expired batches are refused, with no override (decision 13). The batch with the earliest expiry is picked automatically.
   - **Prices and discounts:** never above MRP (decision 76); each item's maximum discount always applies; discounts above the cashier's limit need a **manager PIN** (decisions 19 and 40).
   - **Offers:** the best eligible offer is applied automatically, and a sale is never blocked because offers clash (decision 17).
6. **Returns:**
   - against the original bill, at the original prices;
   - the refund cannot be more than what is returned;
   - stock comes back at the original cost;
   - returns **without a receipt** need a manager PIN (decision 40).
7. **Exchange:** one screen nets the goods coming back against the new goods; the customer pays or gets back only the difference (decision 42).
8. **Card and UPI payments:** recorded with their approval code or reference. The card machine and UPI QR are separate devices at launch (decision 44; settlement matching deferred, decision 54).
9. **Quick cashier switching by PIN** on one till (decision 68): the till locks, the next cashier types their PIN, and each bill records who made it.
10. **Offers and coupons** (the scope is question 2 in section 11).
11. **Offline queue and receipt printing:** see `pos-offline-and-devices.md`.
12. **Reports** (decision 66; all can be exported):
    - till register (every bill);
    - payments by method;
    - shift closing report;
    - hourly sales;
    - sales per cashier;
    - offline bills to check;
    - sync problems;
    - old parked bills.

## 2. GST on till bills (please decide; question 1)

Every bill must show GST, but the GST rules (rate master, invoice layout, B2B details) need the Chartered Accountant's approval before the GST module is built (decisions 43, 55–64).

| Option | What it means |
| --- | --- |
| **A. GST rate list now, approved before go-live (recommended)** | Build the **effective-dated HSN rate list** that decision 56 asks for: HSN code, rate, the date it starts, and who approved it. The till works out GST from it the usual way for MRP-style prices that include GST: taxable = price ÷ (1 + rate), split into CGST + SGST, or IGST for another state. Until the accountant marks a rate as approved, bills using it are marked "GST rate not yet approved", and the tills **refuse to go live** (a switch only the Owner can turn on after the CA's sign-off). The full GST invoice layout, e-invoicing and returns stay in the GST module. |
| B. A GST rate field on each item | Quicker, but it repeats rates on thousands of items and goes against decision 56 (one HSN master). |
| C. Stop module 6 until the CA approves | Safe, but it holds up the build; accounts (module 7) would have to come first. |

## 3. Data model (Prisma)

Every table has the four audit columns. Money is `Decimal(16,2)`, prices are `Decimal(16,4)` and quantities are `Decimal(18,3)` (rule 1).

| Table | Main fields |
| --- | --- |
| `GstRate` (option A) | `hsnCode`, `rate`, `cessRate`, `effectiveFrom`, `approvedById`, `approvedAt`, `note`. Never edited after approval; a change is a new row with a later start date. |
| `PaymentMethod` | `code`, `name`, `kind` (`cash` / `card` / `upi` / `other`), `allowRefund`, `needsReference`, `accountRole` (`cash_in_till` / `card_settlement` / `upi_settlement` / `other_receipts`, for module 7), `active` |
| `Till` | `companyId`, `storeId`, `code` (e.g. T1), `name`, `locationId` (a shelf location of the store), `priceListId`, `numberSeriesId`, `cashierDiscountPercent` (no PIN up to this), `allowPriceChange`, `autoPrint`, `receiptFooter`, `goLiveAllowed`, `active` |
| `TillPaymentMethod` | `tillId`, `paymentMethodId`, `isDefault` |
| `TillDevice` | `tillId`, `deviceName`, `tokenHash`, `registeredById`, `lastSeenAt`, `lastBillNumber` (one registered computer per till) |
| `UserPin` | `userId`, `pinHash` (strong hash, rule 12), `failedCount`, `lockedUntil`. 4–6 digits, used for manager approvals and switching cashiers. |
| `Shift` | `tillId`, `businessDate` (rule 15), `openedById`, `openedAt`, `status` (`open` / `closed` / `cancelled`), `clientId` |
| `ShiftCash` | starting amount per method: `shiftId`, `paymentMethodId`, `amount` |
| `CashMovement` | `shiftId`, `direction` (`in` / `out`), `amount`, `reason`, `byId`, `at`, `clientId` (decision 41) |
| `PosBill` | `companyId`, `tillId`, `shiftId`, `number`, `clientId` (unique with `tillId`, for idempotency), `kind` (`sale` / `return`), `returnOfId`, `exchangeId` (links a return and a sale made together), `customerId`, `cashierId`, `soldAt`, `businessDate`, `status` (`completed` / `cancelled`), `grossAmount`, `discountAmount`, `taxableAmount`, `cgst`, `sgst`, `igst`, `roundingAdjustment`, `total`, `paidAmount`, `changeAmount`, `couponId`, `offline` (sold while offline), `checkFlags` (price changed, stock negative, expired batch found…), `gstProvisional` |
| `PosBillLine` | `billId`, `lineNo`, `itemId`, `unitId`, `factor`, `quantity` (minus on returns), `basicQuantity`, `barcode`, `batchId`, `serialNumbers`, `mrp`, `listPrice`, `price`, `discountPercent`, `discountAmount`, `offerId`, `isFree`, `taxableAmount`, `gstRate`, `cgst`, `sgst`, `igst`, `lineTotal`, `returnOfLineId`, `returnedQuantity`, `approvedById` (manager who allowed a price change or discount), `costValue` (from the stock ledger), `accountRole` (`sales`) |
| `PosPayment` | `billId`, `paymentMethodId`, `amount` (minus on refunds), `reference` |
| `ShiftClosing` | `shiftId`, `closedById`, `closedAt`, `denominations` (count per note and coin), totals (sales, returns, GST by head, bills), and per method `ShiftClosingLine`: `opening`, `expected`, `counted`, `difference` |
| `Offer` | `code`, `name`, `kind` (`percent` / `amount` / `special_price` / `free_goods`), `appliesTo` (`items` / `groups` / `brands` / `bill`), `value`, `buyQuantity`, `freeQuantity`, `freeItemId`, `minQuantity`, `minAmount`, `storeIds`, `customerGroupId`, `startDate`, `endDate`, `priority`, `couponOnly`, `active`; targets in `OfferTarget` |
| `Coupon` | `code`, `offerId`, `startDate`, `endDate`, `maxUses`, `usedCount`, `customerId` (personal, single use) |
| `PosSettings` (per company) | `largeBillDiscountPercent`, `roundToRupee` (true), `printReceiptCopies`, `liveAllowed` |

**Stock:** every completed bill posts its stock at once through module 4's `StockEngine` with `allowNegative: true` (decisions 32 and 39). Each ledger line is flagged when it goes negative, and it shows on the daily negative-stock report built in module 4. Returns come back at the original line's cost.

**Accounts (decision 39):** values and account roles are stored on every bill: sales, output GST, payment method, rounding, change, and cost of goods sold from the ledger. A **day-end summary** is made when a shift closes. Module 7 posts it as summarised entries, as in module 4 and 5 (option A).

**Number series:** one per till (`{STORE}-{TILL}-{FY}-`), allocated by the till itself offline (see the companion plan §3); returns use the same series.

**Permission keys:**

| Key | What it allows |
| --- | --- |
| `pos.sell` | open a shift, bill, park, cash in/out |
| `pos.return` | returns and exchanges with a receipt |
| `pos.approve` | manager PIN approvals: price change, large discount, return without a receipt, cancel a bill, open the drawer |
| `pos.close` | close and count a shift |
| `pos.shift.manage` | close or cancel someone else's shift |
| `pos.setup` | tills, payment methods, registering till computers |
| `offers.manage` | offers and coupons |
| `gst_rates.manage` | enter rates |
| `gst_rates.approve` | the Accountant marks a rate approved |
| `pos.reports` | till reports |

**Role seeds:**

| Role | Permissions |
| --- | --- |
| Cashier | `pos.sell`, `pos.return`, `pos.close` |
| Store Manager | the Cashier's, plus `pos.approve`, `pos.shift.manage`, `offers.manage`, `pos.reports` |
| Accountant | `pos.reports`, `gst_rates.manage`, `gst_rates.approve`, `pos.setup` |
| Owner | all |

Cashiers still never see cost (decision 70).

## 4. Business rules (backend, all tested)

- **Shifts:**
  - One open shift per till.
  - Billing needs an open shift opened **today** (Indian date, rule 15); a shift left open from yesterday stops billing until it is closed.
  - Several cashiers may bill on one shift by switching with their PIN; each bill records its cashier. The blueprint has one cashier per shift; decision 68 asks for quick switching, so the till, not the cashier, owns the shift.
  - A shift with bills cannot be cancelled.
- **Prices:**
  - The price comes from the till's price list (module 2's lookup: customer price, batch price, pack price…).
  - A line's price can never be above the item's **MRP** (decision 76).
  - A price change needs `allowPriceChange` on the till, otherwise a manager PIN.
- **Discounts:**
  - Up to the till's cashier limit, no PIN.
  - Above it, a manager PIN (decision 19), whose name is stored on the line.
  - Never above the item's maximum discount, even with a PIN (blueprint 04).
- **Offers (decision 17):**
  - Collect the active offers for the line or bill (dates, store, customer group, coupon).
  - Apply the one that gives the customer the **biggest saving**; equal savings go to the higher priority.
  - Offers never stack in version 1 and never stop a sale.
  - Free goods come as a separate line marked free, at price 0, with no further discount.
  - A bill discount is shared over the lines by amount, the rounding going to the last line (blueprint 04 §4), so GST stays right per line.
- **Quantities:** whole numbers for piece units (decision 11). Serial numbers are required for serial items and must be in stock at the till's location. The batch with the earliest expiry is picked automatically; an expired batch is refused (decision 13).
- **Payments:**
  - A sale must be paid in full: credit sales are not built until module 7, since decision 22 needs customer balances.
  - Change only when cash is one of the methods; change = paid − rounded total.
  - Card and UPI need a reference when the method says so.
  - On a return, refunds are negative and not more than the return total, only by methods allowed for refunds.
- **Rounding:** the bill total is rounded to the rupee (decision 5: ₹0.50 and above rounds up), and the difference is stored with the `rounding` role.
- **Returns:**
  - Only against a completed sale, with the same customer.
  - Each line no more than sold minus already returned; serials must have been sold on that bill.
  - Stock comes back at the original line's cost through the original ledger entry, like module 5's returns.
  - A return without a receipt needs a manager PIN and uses the current cost.
- **Exchange:** one transaction makes a return bill and a sale bill linked by `exchangeId`, with one net payment. If the customer is owed money, the refund is paid by a refund method.
- **Cancelling a bill:**
  - Only the same day, before its shift is closed, with a manager PIN and a reason.
  - Its stock is reversed and coupon use taken back.
  - Never deleted (rule 4).
- **Closing:**
  - Needs an empty send queue for the till.
  - Expected per method = starting amount + payments − refunds − change (cash) ± cash in / out.
  - Difference = counted − expected; cash counted = Σ denominations × counts.
  - A difference above ₹100 needs a manager PIN and a remark (the threshold is a setting).
  - The day-end summary for module 7 is stored.
- **Idempotency, numbering and offline:** see the companion plan §3–§5.
- **History (rule 9):**
  - logged: shift open and close, cash in / out, manager approvals, price and discount overrides, cancellations, reprints, drawer opened, GST rate approvals;
  - all in the same transaction as the change.

## 5. Calculations (in `packages/shared`, pure functions, all tested)

- **Line:**
  - amount = price × quantity − discount;
  - for prices that include GST: taxable = round(amount ÷ (1 + rate ÷ 100)), GST = amount − taxable;
  - CGST = round(GST ÷ 2), SGST = GST − CGST (or all IGST);
  - **Tax rule: needs the CA's sign-off with the rate list.**
- **Bill discount share** = discount × line amount ÷ Σ line amounts; the remainder goes on the last line.
- **Best offer:** the saving of each eligible offer on the line or bill; the biggest wins.
- **Buy N get M free:** free quantity = whole number of (bought ÷ N) × M.
- **Rounding:** total rounded to the rupee; the difference stored.
- **Change** = paid − rounded total, only with cash.
- **Expected cash at closing**, as in section 4; **denomination total** = Σ value × count.

## 6. Screens (Bazaar look, the orange "Sales" colour)

- **Till (full screen, touch-friendly, keyboard shortcuts):**
  - **Top bar:** till, cashier, shift, sync status, Lock / Switch cashier.
  - **Billing:** scan box, the bill lines with a number pad, customer, totals with the GST table, Park, Recall, Return / Exchange, Cash in/out, Pay.
  - **Pay:** cash, card and UPI with references, change shown big, Finish & print.
- **Shifts:** open (starting cash), close (count of notes and coins, expected vs counted, remarks).
- **Back office:**
  - Tills (set-up, payment methods, register computer)
  - Payment methods
  - Offers & coupons
  - GST rates (option A: enter, approve)
  - POS settings
  - Bills list and bill view (reprint, return, cancel with PIN)
  - Reports
  - Offline bills to check
  - Sync problems
- **My PIN:** each user sets their own 4–6 digit PIN, which a manager can reset.

## 7. API

```
GET/POST/PATCH /pos/tills, /pos/payment-methods, /pos/offers, /pos/coupons, /pos/gst-rates (+ POST /pos/gst-rates/:id/approve)
POST /pos/tills/:id/register                      (till computer pairing; returns a device token)
GET  /pos/till/snapshot?since=                    (till set-up, catalogue, prices, offers, customers; changes only)
POST /pos/shifts            POST /pos/shifts/:id/cash-movements      POST /pos/shifts/:id/close
POST /pos/bills             (idempotent on tillId + clientId; sale, return or exchange pair)
GET  /pos/bills?…  GET /pos/bills/:id   POST /pos/bills/:id/cancel   POST /pos/bills/:id/reprint
POST /pos/approvals         (manager PIN check → a short-lived approval token tied to the action)
POST /users/me/pin          POST /pos/switch-cashier
GET  /pos/reports/{register|payments|shifts/:id|hourly|by-cashier|offline-check|sync-problems|parked}
```

Every endpoint checks the right and the store (rule 11). Till endpoints also check the registered device token.

## 8. Tests

- **Unit:** GST from inclusive prices including paise splits, bill discount sharing, best-offer choice (percentage vs special price vs buy-2-get-1), MRP and maximum-discount caps, change, rounding, denominations, expected cash.
- **Integration:**
  - every acceptance scenario below;
  - **20 tills selling the last unit at once**: all succeed (decision 32 allows negative at the till), stock ends at −19 and is flagged — never lost or doubled;
  - the idempotency and numbering tests in the companion plan;
  - stock position = ledger sum after every test.
- **Web:** till keyboard flow, crash recovery and queue (fake browser database), payment screen change.

## 9. Acceptance scenarios (added to `docs/acceptance-tests.md` "Module 6" before building; CLAUDE.md §6.6 minimums marked ★)

Sample data:
- **Store:** MAIN, till T1, opening cash ₹2,000.
- **Basmati Rice 1 kg:** sold at ₹120, which includes 5% GST; stock 100 at a cost of ₹90.
- **Surf Excel 1 kg:** sold at ₹132, which includes 18% GST; stock 50 at a cost of ₹95.

GST figures are provisional until the CA approves.

- **6.1 A sale ★:** 2 Basmati + 1 Surf = ₹372.00.
  - Basmati: taxable ₹228.57, CGST ₹5.72 + SGST ₹5.71. Surf: taxable ₹111.86, CGST ₹10.07 + SGST ₹10.07.
  - Cash ₹500, so change is ₹128.00.
  - Stock: Basmati 98, Surf 49. Cost of goods sold stored: ₹180.00 + ₹95.00.
- **6.2 A return ★:** 1 Basmati back from 6.1.
  - Refund ₹120.00 in cash: taxable ₹114.29, CGST ₹2.86, SGST ₹2.85.
  - Stock 99 at the original cost ₹90.00.
  - A second return of 2 more Basmati is refused: only 1 is left to return.
- **6.3 An exchange ★:** the Surf comes back, the customer takes Ariel 1 kg at ₹150 (18%).
  - One screen, a return bill and a sale bill linked; the customer pays ₹18.00.
  - Stock Surf +1, Ariel −1.
- **6.4 Selling beyond stock at the till ★:** with 1 unit left, 3 are sold.
  - The sale succeeds and stock is −2, flagged.
  - It appears on the negative-stock report (decision 32). The same quantity in a back-office write-off is still refused.
- **6.5 Shift close with cash count ★:**
  - Expected cash = ₹2,000 opening + ₹372 sale − ₹120 refund + ₹18 exchange − ₹200 cash out = ₹2,070.00.
  - Counted by notes and coins: ₹2,068.00, so the difference is −₹2.00.
  - The closing is stored with the day-end summary; billing after the close is refused until a new shift opens.
- **6.6 Card and UPI payment recorded ★:** a ₹899 bill paid ₹500 by card (approval 482913) + ₹399 by UPI (reference).
  - The payments report shows card ₹500 and UPI ₹399.
  - Neither is in the expected cash.
  - Card without its approval code is refused when the method needs a reference.
- **6.7 Never saved twice:** the same bill sent 5 times gives 1 bill, stock reduced once and 1 payment set. Two tills offline produce no duplicate numbers.
- **6.8 Discount limits:**
  - The cashier gives 5%: allowed.
  - 12%: refused without a manager PIN, allowed with one, and the manager is recorded.
  - Above the item's maximum discount: refused even with a PIN.
  - A price above MRP: always refused.
- **6.9 Offers:** buy 2 get 1 free on Parle-G and 10% off Biscuits are both eligible → the bigger saving is applied automatically and the sale is never blocked (decision 17). A coupon is used once; cancelling the bill takes the use back.
- **6.10 Expired batch:** the till picks the earliest unexpired batch; a batch expired yesterday is refused, even for a manager (decision 13).
- **6.11 Offline bill at an old price:** a bill made offline at ₹120 after the price changed to ₹125 is accepted as sold and appears on "Offline bills to check".
- **(GST invoice ★):** the B2B GST tax invoice belongs to the GST module and is tested there after CA approval.

## 9c. Decisions made while building (for the project owner to confirm)

1. **The item's maximum discount** caps discounts the cashier gives: line discounts and a typed bill discount. Offers and coupons are the owner's own promotions, so they are not capped at the till. A percentage offer on named items still cannot exceed those items' maximum (blueprint 04). Items default to 0% maximum, so a cashier can give no discount on an item until its maximum is set.
2. **Manager approvals and cashier switches** are single-use records in the database, kept only as hashes. An approval works once, for one action, at one till, for 10 minutes. No signing secret is needed and every approval is in the history.
3. **Five wrong PINs** lock that person's PIN for 15 minutes. PINs like 1111 or 1234 are refused.
4. **A customer added on a till** whose mobile number already exists is linked to the existing customer instead of creating a second one (decision 20: never a duplicate). The bill is flagged.
5. **A return refunds the original net price per unit** (after all discounts and offers), with the GST of the original line.
6. **Free goods from "buy N get M"** come out of stock like any sale, at their cost, with a ₹0 line.
7. **Exchange payments** sit on the bill that settles the difference (the sale if the customer pays, the return if the customer gets money back). The rest is settled between the two linked bills.
8. **A bill dated on or before the month-end stock lock** (an offline bill sent late) posts its stock on the first open day and is flagged.
9. **Ledger lines from till bills** show as "pos_sale" / "pos_return" in stock history, with the cost of goods sold role.
10. **A return of a test-period bill** (sold before going live, GST not yet approved) is still accepted after going live, and is marked provisional like the original. Only new sales are refused while a GST rate is unapproved.
11. **An offline bill with a discount above the cashier's limit** is accepted only if the till got the manager's approval before the connection dropped; otherwise it goes on the Sync problems list.
12. **Offline prices** follow the same rules as the server: the till's own price list first, then the default selling list if the catalogue settings allow it, and per-unit or per-basic-unit pricing as set on each list.

## 10. Deliberately not built in this module

| Item | Why / where |
| --- | --- |
| Credit sales at the till | Needs customer balances (decision 22, module 7). |
| Posting to the books, cash-difference journals | Module 7 (decision 39: summarised day-end entries); values and roles stored now. |
| End-of-day "merged invoice" design of the blueprint | Replaced by decision 39 (stock at every sale; summarised accounting at day end). |
| GST tax invoice layout, e-invoice, B2B details, GST returns | GST module after CA approval (decisions 43, 57–64). |
| Loyalty points, gift cards | Launch scope: deferred (decisions 14–16). |
| UPI payment requests, terminal integration, settlement matching | Decisions 44 and 54 (deferred); manual recording now. |
| Weighing-scale barcodes | Decision 9: OPEN until the first sector is chosen. |
| Kits | Plan 02 answer: later. |
| Cumulative and slab offers, stacking offers | See question 2. |
| Home delivery, quotations | Sales module, not the till. |

## 11. Questions for the project owner

1. **GST at the till** (section 2): option A, B or C? A is recommended.
2. **Offers at launch:** simple offers (percentage, amount or special price on items, groups or brands; buy N get M free; a whole-bill discount over a minimum amount) plus coupons? Recommended. Cumulative, slab and stacking offers would come later.
3. **Cashier discount limit:** the cashier may give up to **5%** without a manager PIN (never above the item's own maximum)? Recommended.
4. **One shift per till** with quick PIN switching between cashiers (decision 68), rather than one shift per cashier? Recommended.
5. **Credit sales** off at the till until the accounts module? Recommended.
6. **Cash difference** above **₹100** at closing needs a manager PIN and a remark? Recommended.
7. The questions in `pos-offline-and-devices.md` §12.
