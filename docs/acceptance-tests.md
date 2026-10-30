# Acceptance tests

Plain-language end-to-end scenarios. Each module's scenarios are written before the module is built, and the module is not done until they pass as automated tests. Scenarios for stock, accounts and tax state the expected effect on each.

Automated versions live in `apps/api/test/acceptance/`.

---

## Module 1 — Users, roles, company and stores

Stock, accounts and tax are not affected by anything in this module.

### 1.1 First-time setup
- **Given** an empty database
- **When** the owner completes the setup screen with their name and email, a password, company "Rademics Retail Pvt Ltd", state Tamil Nadu, one GSTIN, financial year 1 Apr 2026 – 31 Mar 2027 and first store "Main Store" (code `MAIN`)
- **Then** the owner can log in; the company has code `RRPL`; one open financial year `2026-27`; one active store `MAIN` linked to that GSTIN; the setup screen can no longer be used; the audit history shows the creation of each record by that owner.

### 1.2 Creating a cashier limited to one store
- **Given** a logged-in Owner/Admin and stores `MAIN` and `ANNA`
- **When** they create user Priya with role Cashier, store `ANNA` only, and a temporary password
- **Then** Priya can log in, must change her password before doing anything else, sees no back-office menu, and any API call for store `MAIN` is refused.

### 1.3 Wrong password lockout
- **Given** lockout set to 5 attempts for 15 minutes
- **When** someone enters a wrong password for Priya 5 times
- **Then** the 6th attempt is refused even with the right password; the login history shows 5 failures and one "locked" refusal; after 15 minutes the right password works.

### 1.4 Switching a user off
- **Given** Priya has made changes that appear in the history
- **When** the admin switches Priya off
- **Then** she cannot log in, her open sessions end, and every history line still shows her name.

### 1.4b The last Owner/Admin cannot be removed
- **Given** Karthik is the only active Owner/Admin
- **When** anyone tries to take the Owner/Admin role from him or switch him off
- **Then** it is refused until another active user holds Owner/Admin.

### 1.4c Every endpoint checks permissions
- **Given** Priya is a Cashier
- **When** she calls the financial years, roles, permissions, company, stores, numbering or history endpoints directly
- **Then** each is refused; only her own login details are returned.

### 1.5 Store manager cannot change access rights
- **Given** user Arun with role Store Manager
- **When** Arun tries to create a user or change a role
- **Then** the request is refused and nothing changes.

### 1.6 Financial year rules
- **Given** financial year `2026-27`
- **When** the accountant tries to add a year 1 Jan 2027 – 31 Dec 2027
- **Then** it is refused because it overlaps.
- **When** three days before 31 Mar 2027 the nightly job runs
- **Then** year `2027-28` (1 Apr 2027 – 31 Mar 2028) exists, marked as created automatically.
- **When** a cashier tries to lock a year
- **Then** it is refused; only Accountant or Owner/Admin may.

### 1.7 Document numbering never repeats
- **Given** a series for sales invoices with pattern `INV-{STORE}-{FY}-` and a 5-digit counter
- **When** two tills at store `MAIN` ask for a number at the same instant
- **Then** one gets `INV-MAIN-2026-27-00001` and the other `INV-MAIN-2026-27-00002`; store `ANNA` separately starts at `INV-ANNA-2026-27-00001`.

### 1.7b Business dates are Indian dates
- **Given** financial years 2026-27 and 2027-28 exist
- **When** a bill is numbered at 00:05 Indian time on 1 April 2027 (still 31 March in UTC)
- **Then** its number is in the 2027-28 series; a bill at 23:45 Indian time on 31 March is in 2026-27.
- **When** the nightly job runs on what is already 28 March in India but still 27 March in UTC
- **Then** it creates 2027-28 (three days before year end, by the Indian date).

### 1.8 Counter change is restricted and logged
- **When** a Store Manager tries to change a counter
- **Then** it is refused.
- **When** the Owner/Admin changes the `MAIN` counter from 3 to 100 with a reason
- **Then** the next number is `…-00100` and the history shows who, when, old value 3, new value 100 and the reason.

### 1.9 History cannot be edited
- **When** anyone, including the database owner role used by the API, tries to update or delete a history row
- **Then** the database refuses it.

### 1.10 Audit and change are saved together
- **Given** an update to a store that fails half-way (simulated error after the store row is written)
- **Then** neither the store change nor its history row is saved.

---

## Module 2 — Items, units, barcodes, price lists

Stock, accounts and tax are not affected by anything in this module.

### 2.1 A simple item with two pack sizes
- **Given** units PCS and BOX exist and the group Grocery > Staples > Rice is a leaf group
- **When** the catalogue manager creates item "Basmati Rice 1 kg" without typing a code, basic unit PCS, another unit BOX = 12 PCS, barcode `8901234567890` (EAN-13) for PCS and `5901234123457` (EAN-13) for BOX, HSN 1006, MRP ₹120.00, selling price ₹110.00 in Standard Selling
- **Then** the item gets code `ITM-000001`; scanning `8901234567890` returns the item in PCS; scanning `5901234123457` returns the item in BOX with 12 basic units; the price lookup for 1 BOX returns ₹1,320.00 (12 × 110) because prices are per basic unit.

### 2.2 Barcodes are unique and checked
- **When** another item is given barcode `8901234567890`
- **Then** it is refused, naming the item that already has it.
- **When** an item is given EAN-13 `8901234567894` (wrong check digit)
- **Then** it is refused.

### 2.3 A style with sizes and colours
- **Given** attribute Size with S/M/L and attribute Colour with Red (RED) and Blue (BLU)
- **When** the manager creates style `SHIRT` varying by Colour and Size and ticks Red, Blue × S, M, L
- **Then** six variants exist with codes `SHIRT-RED-S` … `SHIRT-BLU-L` and names "Shirt Red S" etc.; creating the same combinations again adds nothing; a price or barcode on `SHIRT` itself is refused; a price on `SHIRT-RED-M` is accepted.

### 2.4 Fractions only for weight, length and volume
- **Given** unit PCS (count) and unit KG (weight)
- **When** a quantity of 1.5 PCS is entered anywhere
- **Then** it is refused; 1.5 KG is accepted.
- **When** the manager tries to allow fractions on PCS
- **Then** it is refused.

### 2.5 The right price is found
- **Given** item X with Standard Selling price ₹100 (from 1 Apr 2026), a scheduled price ₹105 from 1 Nov 2026, a contract price ₹90 for customer C (module 3; until then recorded with a placeholder customer id), and a Wholesale list with no price for X
- **Then** on 14 Oct 2026 a walk-in sale gets ₹100; on 1 Nov 2026 it gets ₹105; customer C gets ₹90 on both dates (a contract price wins over a newer general price); a bill on the Wholesale list gets ₹100 through the default-list fallback when that setting is on, and no price when it is off; a supplier price on a selling list and an identical duplicate price are refused.

### 2.6 Cashiers never see cost or buying prices
- **Given** Priya is a Cashier
- **When** she opens an item
- **Then** the response has no last-purchase-price field, the buying price list is not returned, and `GET /price-lists` shows only selling lists; the Owner/Admin sees everything.

### 2.7 A switched-off item cannot be used
- **When** item X is switched off (or given an end date in the past) and its barcode is scanned
- **Then** the scan answers "not usable: switched off" and any document line for X is refused.

### 2.8 Price changes are in the history
- **When** the price of X in Standard Selling is changed from ₹100 to ₹110 by ending the old price today and adding the new one
- **Then** the history shows who, when, the old price and the new price.

### 2.9 Item codes never repeat
- **When** two staff create items at the same instant without codes
- **Then** they get `ITM-000002` and `ITM-000003`, never the same code.

---

## Module 3 — Customers and suppliers (draft; approved with the module 3 plan)

Stock, accounts and tax are not affected by anything in this module.

### 3.1 Quick add at the till warns about a duplicate mobile
- **Given** customer Lakshmi with mobile 9876543210 exists
- **When** a cashier quick-adds "Lakshmi S" with the same mobile
- **Then** the system refuses and shows the existing customer; when the cashier confirms it is a different person, a second customer is created; nothing is merged.

### 3.2 A business customer with a GSTIN in another state
- **When** a Wholesale customer is created with GSTIN `29…` (Karnataka) while the company is in Tamil Nadu
- **Then** its state is recorded as 29 and billing it from Tamil Nadu is inter-state (IGST), by the same rule the till and the server use; a GSTIN whose state digits differ from the typed state is refused.

### 3.3 Due dates from payment terms
- **Given** terms "Net 15" (15 days after bill date), "Month end + 10" and "50 % advance / 50 % at 30 days"
- **Then** for a bill dated 20 Feb 2027: Net 15 → 7 Mar 2027; Month end + 10 → 10 Mar 2027; the split terms → two parts due 20 Feb and 22 Mar 2027; a due date before the bill date is impossible.

### 3.4 Credit limits are protected
- **When** a Store Manager tries to change a customer's credit limit or block them
- **Then** it is refused; an Accountant can, and the history shows old and new limit.

### 3.5 Blocked versus switched off
- **When** a customer is switched off
- **Then** any document naming them is refused for everyone; **when** blocked, the Accountant may still post for them.

### 3.6 Supplier holds
- **Given** supplier Metro Distributors is on hold for payments only until 30 Nov 2026
- **Then** a purchase order or bill helper check passes, a payment helper check is refused with the reason; after 30 Nov the hold lifts by itself.

### 3.7 Same party as customer and supplier
- **When** "Arun Traders" exists as a supplier and is created as a customer with a link to that supplier
- **Then** both records exist with separate numbers and the link is shown on each; balances stay separate.

### 3.8 Group defaults are copied
- **Given** customer group Wholesale with price list Wholesale and Net 30 terms
- **When** a customer is created in that group without terms
- **Then** the customer shows Wholesale prices and Net 30; changing the group's defaults later does not change existing customers.


---

## Module 4 — Inventory

Sample data: item Basmati Rice 1 kg (PCS), stores MAIN and ANNA. Values in rupees. Accounts are not posted until module 7; each scenario names the **account roles** stored on the stock lines, which module 7 will post (stock account against the role shown).

### 4.1 Opening stock
- **When** an opening-stock count of 100 at ₹90 is finalised at MAIN shop floor
- **Then** MAIN shop floor has 100 at ₹90.0000, value ₹9,000.00; roles: stock +9,000.00 / temporary opening −9,000.00.

### 4.2 Moving average cost
- **When** a stock-in of 50 at ₹96 is finalised
- **Then** MAIN has 150 at ₹92.0000, value ₹13,800.00.

### 4.3 Write-off
- **When** a stock-out (damage) of 3 is finalised
- **Then** MAIN has 147, value ₹13,524.00; roles: write-off +276.00 / stock −276.00.

### 4.4 Transfer between shops (two steps through transit)
- **When** 20 are sent from MAIN to ANNA
- **Then** MAIN has 127 (₹11,684.00) and transit 20 (₹1,840.00).
- **When** ANNA receives 15
- **Then** transit has 5 (₹460.00) and ANNA shop floor 15 at ₹92.0000 (₹1,380.00); the send shows 15 of 20 received.
- **When** ANNA receives the last 5
- **Then** transit is empty and the send is complete. The company's total stock value is ₹13,524.00 at every step.

### 4.5 Negative stock blocked in the back office (decision 32)
- **When** a write-off of 200 from MAIN is attempted
- **Then** it is refused naming 127 available and 73 more needed; nothing changes.

### 4.6 Two people take the last units at once (rule 7)
- **Given** 5 left of an item
- **When** 20 write-offs of 1 are finalised at the same instant
- **Then** exactly 5 succeed, 15 are refused, and the quantity is 0, never negative.

### 4.7 Stock count
- **When** a count at MAIN finds 125 where 127 are expected
- **Then** the difference −2 is posted at ₹92.0000 (−₹184.00); roles: stock adjustment +184.00 / stock −184.00. A blind count does not show the expected figure to the counter.

### 4.8 Expired batches (decision 13)
- **Given** a batch-tracked item with a batch that expired yesterday
- **Then** it cannot be received, moved or transferred; it can only be written off with reason "expiry".

### 4.9 Back-dating (decision 35)
- **Given** a stock-in on the 10th and a write-off on the 12th of the current month
- **When** a Store Manager posts a stock-in dated the 11th
- **Then** it is refused.
- **When** the Accountant posts it
- **Then** it is accepted and the write-off of the 12th is re-costed at the new average; a date in the previous month is refused even for the Accountant.

### 4.10 Month-end stock lock (decision 36)
- **When** stock is locked up to the end of last month
- **Then** any movement dated on or before that date is refused, for everyone.

### 4.11 Cancelling
- **Given** 100 at ₹90 and then a stock-in of 50 at ₹96
- **When** the stock-in is cancelled
- **Then** the item is back to 100 at ₹90.0000, value ₹9,000.00; the stock-in stays visible as cancelled with its reversing lines.

### 4.12 The ledger explains the stock (rule 6)
- After every scenario above, each stock position equals the sum of its ledger lines, and each batch position equals the sum of its batch's ledger lines.

### 4.13 Serial numbers
- **When** a phone is received with serials S1, S2, S3 and S2 is transferred to ANNA
- **Then** S1 and S3 are in stock at MAIN, S2 is in transit and, after receipt, in stock at ANNA; receiving a serial already in stock is refused.

## Module 5 — Purchasing

Sample data: supplier Sri Murugan Traders (Net 30), item Basmati Rice 1 kg (PCS, GST 5% as written on the supplier's bill), store MAIN with 100 at ₹90.0000 on the shop floor. Accounts are not posted until module 7; each scenario names the **account roles** stored on the lines. GST is recorded as stated by the supplier (plan 05, answer 2).

### 5.1 Purchase order
- **When** an order for 200 × ₹95.00 to MAIN is finalised
- **Then** taxable ₹19,000.00, GST ₹950.00 (CGST ₹475.00 + SGST ₹475.00), total ₹19,950.00; on-order quantity 200; no stock change. Above ₹50,000 the order needs a Store Manager or Owner to finalise.

### 5.2 Purchase receipt (CLAUDE.md minimum)
- **When** 120 arrive against the order: 118 accepted, 2 rejected
- **Then** shop floor 218 at ₹92.7064 (value ₹20,210.00); Rejected location 2 at ₹95.0000 (value ₹190.00, decision 30); roles: stock +11,400.00 / goods received not billed −11,400.00; order received 60%, on order 80, status "waiting for goods and bill"; last purchase price ₹95.0000.

### 5.3 Supplier bill against the receipt
- **When** bill SMT/1182 for 120 × ₹95 is recorded: ₹11,400.00 + GST ₹570.00 = ₹11,970.00
- **Then** due 30 days from the supplier's bill date; roles: goods received not billed +11,400.00, GST input +570.00 / supplier payable −11,970.00; receipt fully billed; order billed 60%.

### 5.4 Duplicate supplier bill number
- **Then** a second bill SMT/1182 from the same supplier in 2026-27 is refused; the same number from another supplier, or in the next financial year, is accepted.

### 5.5 Returning the rejected goods
- **When** the 2 rejected bags are returned from the Rejected location
- **Then** Rejected 0 (value ₹0.00); they leave at ₹95.0000, the original cost; the order's received quantity goes back to 118, so 82 can still be received.

### 5.6 Receipt without an order (decision 31)
- **Then** Stock/Receiving staff are refused; a Store Manager succeeds only with a reason, and the reason appears in the history.

### 5.7 Over-receipt
- **Given** a 0% allowance and 82 still expected on the order line
- **Then** receiving 83 is refused; a user with the over-receive right gets a warning and it is accepted.

### 5.8 Free goods (decision 27)
- **When** 10 are bought at ₹100.00 with 2 free
- **Then** 12 enter stock at ₹83.3333 each, value ₹1,000.00.

### 5.9 Extra charges on goods received
- **When** freight of ₹600.00 is shared by value over a receipt of rice ₹9,500.00 and dal ₹2,500.00
- **Then** rice gets ₹475.00 and dal ₹125.00; their unit costs rise accordingly; a stock movement made after the receipt is re-costed.

### 5.10 Bill that also receives the goods
- **When** a bill for 5 × ₹40.00 (GST 5%) receives the goods at MAIN
- **Then** stock +5 at ₹40.0000; roles: stock +200.00, GST input +10.00 / supplier payable −210.00.

### 5.11 Cancelling
- **Then** cancelling the receipt of 5.2 is refused while its bill exists; after cancelling the bill and then the receipt, MAIN is back to 100 at ₹90.0000 and the order to 0% received.

### 5.12 Held supplier and expired batch
- **Then** a supplier held for bills cannot get a new order or bill; a batch whose expiry date was yesterday cannot be received (decision 13).

### 5.13 Reorder suggestions
- **Given** reorder level 50 and reorder quantity 100 at MAIN, on hand 30, nothing on order
- **Then** the suggestion is 100 from the item's usual supplier; "Create orders" makes one draft order per supplier and marks the suggestion ordered; nothing is suggested while on hand + on order ≥ 50.

## Module 6 — Point of sale

Sample data: store MAIN, till T1, opening cash ₹2,000. Basmati Rice 1 kg sold at ₹120 including 5% GST (stock 100 at cost ₹90); Surf Excel 1 kg at ₹132 including 18% GST (stock 50 at cost ₹95); Ariel 1 kg at ₹150 including 18%. GST figures use the HSN rate list and stay **provisional until the CA approves the rates** (plan 06 answer 1). Accounts are posted from module 7; each scenario names the values stored. Scenarios marked ★ are the CLAUDE.md §6.6 minimums.

### 6.1 A sale ★
- **When** 2 Basmati and 1 Surf are billed and paid with ₹500 cash
- **Then** total ₹372.00. Basmati: taxable ₹228.58, CGST ₹5.71, SGST ₹5.71 (decision L8: CGST and SGST always equal). Surf: taxable ₹111.86, CGST ₹10.07, SGST ₹10.07. Change ₹128.00. Stock Basmati 98, Surf 49. Cost of goods sold stored: ₹180.00 and ₹95.00.

### 6.2 A return ★
- **When** 1 Basmati from 6.1 comes back
- **Then** the refund is ₹120.00 in cash (taxable ₹114.28, CGST ₹2.86, SGST ₹2.86; decision L8), and stock is 99 at the original cost of ₹90.00. Returning 2 more is refused: only 1 is left to return.

### 6.3 An exchange ★
- **When** the Surf comes back and the customer takes Ariel at ₹150 on the same screen
- **Then** a return bill and a sale bill are linked and the customer pays ₹18.00. Stock: Surf +1, Ariel −1.

### 6.4 Selling beyond stock at the till ★ (decision 32)
- **When** 3 are sold with 1 in stock
- **Then** the sale succeeds, stock is −2 and flagged, and the item appears on the negative-stock report. The same write-off in the back office is still refused.

### 6.5 Shift close with cash count ★
- **Then** expected cash = ₹2,000 + ₹372 − ₹120 + ₹18 − ₹200 cash out = ₹2,070.00. Counted ₹2,068.00 in notes and coins gives a difference of −₹2.00. The closing and the day-end summary are stored. Billing on that till is refused until a new shift is opened.

### 6.6 Card and UPI payments recorded ★
- **When** a ₹899 bill is paid ₹500 by card (approval 482913) and ₹399 by UPI (with its reference)
- **Then** the payments report shows card ₹500 and UPI ₹399, and neither is in the expected cash. A card payment without its approval code is refused.

### 6.7 Never saved twice
- **Then** the same bill sent 5 times makes 1 bill, reduces stock once and records 1 set of payments. Two tills billing offline never produce the same number.

### 6.8 Discount limits (decisions 19, 40, 76)
- **Then** a cashier may give 5%. 12% is refused without a manager PIN and allowed with one, and the manager is recorded. A discount above the item's maximum is refused even with a PIN. A price above MRP is always refused.

### 6.9 Offers (decision 17)
- **When** "buy 2 get 1 free" on Parle-G and "10% off Biscuits" both apply
- **Then** the bigger saving is applied automatically and the sale is never blocked. A coupon can be used once; cancelling the bill gives the use back.

### 6.10 Expired batch (decision 13)
- **Then** the earliest batch that has not expired is picked. A batch that expired yesterday is refused, even for a manager.

### 6.11 Offline bill at an old price
- **When** a bill is made offline at ₹120 after the price changed to ₹125
- **Then** it is accepted as sold and appears on "Offline bills to check".

## Module 7 — Accounting

Every scenario ends with the same check: total debits equal total credits, and every ledger entry balances.

### 7.1 Till shift posted at closing ★ (decision 39)
- **Given** a shift with a ₹186 cash sale (3 kg rice), a ₹62 return of 1 kg and a ₹5 carry bag (₹200 paid, ₹14 change, ₹57 refunded), counted ₹9 short
- **Then** closing the shift writes one ledger entry for the store:
  - debits: cash in till ₹129.00, cost of goods sold ₹104.00, cash short ₹9.00;
  - credits: sales ₹122.86, output CGST ₹3.07, output SGST ₹3.07 (decision L8), stock ₹104.00, cash in till ₹9.00.
- The same entry moves the ₹2,000 starting float from the store's cash in hand into cash in till, and the ₹2,120 counted back to cash in hand, so cash in till is zero after every shift.
- Nothing is posted to the accounts until the shift closes.

### 7.2 Card and UPI ★
- **When** a ₹899 bill is paid ₹500 by card and ₹399 by UPI and the shift closes
- **Then** card settlement is debited ₹500 and UPI settlement ₹399; cash in till is not touched.
- **When** a card payout of ₹500 arrives as ₹491 in the bank
- **Then** the transfer credits card settlement ₹500 and debits the bank ₹491 and card commission ₹9.

### 7.3 Purchase receipt and bill ★
- **When** goods worth ₹1,000 are received with ₹100 freight added to stock
- **Then** stock is debited ₹1,100, goods received not billed credited ₹1,000 and freight inward credited ₹100.
- **When** the supplier's bill for ₹1,020 + ₹51 GST arrives against it
- **Then** goods received not billed is debited ₹1,000 (back to zero), the price difference ₹20, input GST ₹51, and the supplier is credited ₹1,071.

### 7.4 Paying a supplier
- **When** one payment of ₹2,000 settles two bills of ₹1,071 and ₹800, oldest first
- **Then** both bills owe ₹0 and ₹129 stays as an advance that the next bill uses. A supplier on hold for payments cannot be paid.

### 7.5 Stock movements and transfers ★
- **Then:**
  - a transfer between shops credits the sending store's stock and debits goods in transit, and receiving debits the receiving store's stock;
  - damage is debited to stock write-off;
  - a count difference goes to stock adjustment.
- "Stock against accounts" shows no difference for any store.

### 7.6 Re-costing after a sale
- **When** freight is added to a receipt after some of the goods were sold
- **Then** only the difference is posted (to stock and cost of goods sold). Earlier ledger entries are unchanged and stock against accounts still shows no difference.

### 7.7 Cancelling ★
- **When** a posted supplier bill is cancelled
- **Then** equal and opposite lines are written with the bill's date. The trial balance is as if it never happened, both entries stay in the ledger, and the database refuses any edit or delete of a ledger line.

### 7.8 Locked books
- **When** the books are locked up to 30 September
- **Then** a store manager's posting dated 30 September is refused and the Accountant's is accepted.

### 7.9 Journals
- **Then:**
  - an unbalanced journal is refused;
  - a supplier-balance line without a supplier is refused;
  - an income line without a store is refused;
  - a line against a bill for more than it owes is refused.
- A difference of a few paise is not "rounded away" on a journal above 5 paise.

### 7.10 Opening balances
- **When** an opening journal, two opening customer bills and opening stock are posted
- **Then** the temporary opening account is at zero, and the customers' ageing shows the bills at their original dates.

### 7.11 Year-end closing
- **When** the year is closed to retained earnings
- **Then** every income and expense account is zero in the new year and retained earnings moved by the year's profit, per store. Posting into the closed year is refused; cancelling the closing (with no later closing) allows it again.

### 7.12 Credit sale at the till ★ (decision 22)
- **Given** a customer approved for credit with a ₹5,000 limit who owes ₹4,500
- **Then:**
  - a ₹400 bill on account is accepted;
  - a further ₹200 is refused unless a store manager approves, and the override is logged;
  - a walk-in customer, or any offline bill, cannot use On account.
- At shift close the customer's balance is debited. A receipt of ₹4,900 settles the bills oldest first, and the statement and ageing match the ledger.

### 7.13 Book health
- **Then** after all of the above, every party's ledger balance equals their unpaid bills minus advances, and the opening check shows zero.

## Module 9 — Reports and dashboards

Reports only read. Each scenario checks that a report agrees with the documents and the books.

### 9.1 Daily sales by store
- **Given** MAIN sells 3 bills worth ₹1,000 net and ANNA 1 bill worth ₹500
- **Then** MAIN shows 3 bills with an average bill of ₹333.33, and ANNA 1 bill.
- **When** a ₹200 return is made the next day
- **Then** that day shows −₹200 net sales and 0 bills.

### 9.2 Best sellers and gross profit
- **Then** items rank by quantity and by sales, and margin uses the cost at the time of sale.
- **When** freight is added to a receipt after some of its goods were sold
- **Then** the item's margin falls by that share, and the report's cost of goods sold equals the cost of goods sold in the accounts.
- A cashier gets no cost or margin.

### 9.3 Discounts given
- **Then** a manual 5% line discount, a manager-approved 12% discount, an offer and a coupon each appear with who gave or approved them.

### 9.4 Stock cover and sell-through
- **Given** 60 in stock and 90 sold over 30 days
- **Then** 20 days of stock are left.
- **Given** 100 opening and 50 received with 90 sold
- **Then** sell-through is 60%.

### 9.5 Stock age
- **Given** 40 units received 100 days ago and 20 received 10 days ago, with 30 on hand
- **Then** 20 are in 0–30 days and 10 in 91–180 days.

### 9.6 Stock variance and loss
- **Given** ₹180 damage and a ₹270 count shortfall against ₹9,000 net sales
- **Then** the loss is ₹450, which is 5.00% of sales.

### 9.7 Cash position and cash flow
- **Then** balances match the ledger.
- For the period, opening cash + trading + investing + financing = closing cash.
- Cash taken to the bank appears in none of them.

### 9.8 Store limits
- **Then** a store manager of MAIN sees only MAIN on every report and dashboard, and the totals equal MAIN's own.

### 9.9 Dashboards agree with reports
- **Then** today's sales tile equals the daily sales report for today, and month-to-date margin equals the gross profit report for the month.

### 9.10 Daily summary email (decision 67)
- **Then:**
  - the email contains the agreed figures;
  - it is sent once per day even if triggered twice;
  - a switched-off user gets nothing;
  - a mail failure is recorded and shown.

### 9.11 Downloads are recorded
- **Then** each CSV download appears in the history with the report name and filters.

## Module 10 — Printing, labels, import and export

### 10.1 Amount in words
- **Then** ₹1,23,450.25 reads "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only", and ₹0.50 reads "Fifty Paise Only".

### 10.2 Purchase order print
- **Then** the purchase order prints with the store's own address and GSTIN, the supplier, the lines and the totals.
- A draft prints marked DRAFT, and every print is in the history.

### 10.3 Payment receipt print
- **Then** the payment receipt prints with the bills it settled and the amount in words.

### 10.4 Labels
- **Then:**
  - 3 copies of an item with an EAN-13 barcode give 3 labels, and their bars decode back to the same barcode;
  - a receipt of 12 units gives 12 labels with batch and expiry;
  - "price changed since" lists only items whose price changed after that date.

### 10.5 Importing items
- **Given** a file of 3 new items, one with a second barcode and a box unit
- **Then** all three are added.
- **When** one row has an unknown item group
- **Then** that row fails with its row number, and the other rows are saved.
- Running the fixed failed-rows file adds the last item; running the whole file again adds nothing twice.

### 10.6 Leading zeros and Indian numbers
- **Then** barcode "0012345678905" and HSN "0902" are kept as typed, and a price of "1,05,000.50" reads as 105000.50.

### 10.7 Change mode
- **Then:**
  - importing prices with new start dates adds new price rows and keeps the old ones;
  - changing a customer's mobile keeps everything else.

### 10.8 Opening stock and opening bills
- **Then** imported opening quantities and costs for two locations become draft opening counts, and nothing moves until they are finalised.
- Imported opening bills post against the temporary opening account, and the opening check reflects them.

### 10.9 Export and import back
- **Then** an exported item list imported back in change mode reports "nothing to change" for every row.

### 10.10 Clearing trial data (decision 72)
- **Given** a trial sale, receipt and payment
- **Then** clearing keeps items, customers, suppliers, prices and users, and removes bills, stock, the ledger and the counters. Stock is zero.
- **Then** it is refused without the typed company name.
- **Then** after the go-live date is recorded, it is refused for good, even for the Owner.

### 10.11 Store limits and rights
- **Then** a store manager prints only their own stores' documents, and a cashier can neither import nor export.

## Module 11 — Fixes and extras for clothing and fancy stores (plan 11, part 1)

### 11.1 Items that have moved cannot change their unit or tracking (A1)
- **Given** an item with an opening stock of 10
- **Then** changing its basic unit, batch or serial tracking, or stock/service flag is refused with a plain message; its name and MRP can still change.
- An item with no stock movement can still change all of them.

### 11.2 Selling below cost (A2)
- **Given** "block selling below cost" is on, and an item costs ₹90 (last purchase ₹95) and sells at ₹120
- **Then** a till sale at a typed price of ₹92 is refused (below the last purchase price); with a manager's PIN it is saved and the override is logged.
- A return, and a free line from an offer, are never refused.
- **Given** "allow price change on bill" is off for the company
- **Then** a typed price is refused even on a till that allows price changes.
- **Given** "save typed prices" is on, and an item has no price in the till's list
- **Then** after a sale at a typed ₹55, the item has a price of ₹55 in that list from that day.

### 11.3 Supplier bill payment status (A3)
- **Given** a ₹11,970.00 supplier bill
- **Then** after a ₹5,000.00 payment it shows "part paid" with ₹6,970.00 due; after the rest, "paid", never "overdue", and it cannot be put on hold.
- Cancelling the payment brings it back to "part paid" or "unpaid".

### 11.4 Ledger screens show everything (A4)
- **Given** an account with 6,000 lines in a period
- **Then** the general ledger pages through all 6,000. The closing balance equals the trial balance for that account, whatever page is shown.

### 11.5 A 20,000-line count (A5)
- **Given** an opening count of 20,000 items
- **Then** finalising it succeeds in one go; stock value equals the sum of quantity × cost; the stock ledger has 20,000 rows.

### 11.6 Blocked and switched-off customers, group credit limits (A6, A7)
- **Then** a blocked customer is refused at the till when online; an offline bill for them is saved and flagged.
- **Then** a customer with no own limit in a group with a ₹10,000 limit cannot buy ₹12,000 on account without a manager's PIN.
- **Then** a customer in a group marked "skip credit check" can buy on account with no limit check.

### 11.7 Bills need an order or receipt (A8)
- **Given** "a bill needs a goods receipt" is on
- **Then** a supplier bill that receives goods directly is refused, except for a supplier whose exception allows bills without a receipt.

### 11.8 Return without the original bill (A9)
- **Then** at the till, a return of 1 shirt without a bill needs a manager's PIN, refunds ₹899.00 in cash, and puts the shirt back at its current cost.
- **Then** it is refused offline, and refused for a refund to a method that does not allow refunds.

### 11.9 Year-end closing checks (A10)
- **Then** closing the year is refused while the stock value and the stock accounts differ, or while the year's last month is not locked; the message says which.

### 11.10 Sizes and colours from Excel (B1)
- **Given** a sheet of 8 rows: one shirt style in sizes S, M, L, XL and colours Red and Blue, with barcodes and prices
- **Then** one style and 8 variants (`…-RED-M` etc.) are created, each with its barcode and price.
- Importing the same sheet again adds nothing twice; a row with an unknown size fails with its row number.

### 11.11 Style changes reach the variants (B2)
- **Then** changing a style's MRP from ₹999 to ₹1,099 with "also change all sizes and colours" sets every variant's MRP to ₹1,099; codes, barcodes and prices are unchanged. Each variant's history shows the change.

### 11.12 New offers (B3)
- **Any 3 for ₹999** on group T-shirts (₹399 each):
  - **Then** a bill of 3 T-shirts totals ₹999.00, with the ₹198.00 saving spread over the three lines;
  - a bill of 4 totals ₹1,398.00.
- **Buy 2, cheapest free** on tops priced ₹599 and ₹499:
  - **Then** the ₹499 top is free and the bill is ₹599.00;
  - returning the ₹599 top later refunds ₹599.00, the amount actually paid for that line; the free top stays sold at ₹0.
- **Buy a shirt, get a belt free:**
  - **Then** adding the shirt adds the belt at ₹0, and the belt leaves stock at its cost.
- **Then** with several offers possible, the bill gets the one that saves the customer most.

### 11.13 Home delivery (B4)
- **Given** a fixed delivery charge of ₹50, free above ₹2,000
- **Then:**
  - a ₹1,500 bill with delivery adds a ₹50.00 charge line and shows in the store's pending deliveries;
  - marking it delivered records who and when;
  - a ₹2,500 bill has no charge.

### 11.14 Salesperson (C1)
- **Given** salespeople Priya and Arun
- **Then:**
  - a bill by Priya with one line changed to Arun shows each line's sales against the right person;
  - a later return of Arun's line reduces Arun's sales, not Priya's;
  - sales by salesperson for the day equals the till's net sales.

### 11.15 Size × colour grid (C2)
- **Then** typing quantities 2, 3, 3, 2 under S, M, L, XL for Red on a goods receipt adds 4 lines (one per variant) with those quantities.

### 11.16 Reports by style, size and colour (C3)
- **Then** item sales grouped by size shows S, M, L, XL totals that add up to the style's total; the stock of a style shows as a size × colour grid per shop.

### 11.17 Seasons and markdowns (C4, C5)
- **Given** season "Summer 2026" on 20 styles, and a 30% markdown from 1 August
- **Then:**
  - from 1 August the selling price is 70% of the old price, rounded to the rupee and never above MRP;
  - before 1 August the old price applies;
  - season sell-through shows bought, sold, in stock and percentage sold.

### 11.18 Expense entry and cash book (C8)
- **Given** a rent expense of ₹30,000.00 paid in cash at MAIN
- **Then:**
  - rent is debited and MAIN's cash in hand credited by ₹30,000.00, with MAIN as the store;
  - the cash book for that day shows it under money out, and the closing balance matches the ledger;
  - cancelling the expense reverses it on the same date.

### 11.19 Customer purchases and birthdays (C9, C10)
- **Then:**
  - a customer's purchases tab lists their bills and returns with this year's total equal to the sales report filtered by that customer;
  - a customer with a birthday in the next 7 days appears in "birthdays this week".

## Module 11, part 2 — Orders, alterations, sale-or-return, Tally (plan 11 part 2)

### 11.20 Customer order with an advance
- **Given** Priya orders a ₹2,499 kurta in size XL (not in stock) and pays a ₹1,000 advance by UPI
- **Then** the order is open with ₹1,000 advance; her customer balance shows ₹1,000 in credit; stock does not move.
- **When** the kurta arrives and the order is marked ready
- **Then** one unit is set aside for her, and the till warns before selling that last unit to someone else.
- **When** she collects it
- **Then** the till bill is ₹2,499.00, the advance pays ₹1,000.00 and she pays ₹1,499.00. The order is "collected", the advance is linked to the bill, her balance is back to zero, and one unit has left stock.

### 11.21 Cancelling an order
- **Then** cancelling with a refund needs a manager's PIN and returns the ₹1,000.00 by a refund-allowed method; the balance is zero.
- **Then** cancelling with credit kept leaves ₹1,000.00 in her favour, and her next bill can use it.

### 11.22 Alteration job
- **Given** a trouser bought on bill MAIN-T1-…-000010 needs shortening, ₹150, promised in 2 days
- **Then** the job is "received", then "with the tailor", then "ready", then "delivered", each with who and when.
- **Then:**
  - the ₹150 charge can be added to the original bill as a service line, or billed when the trouser is collected — never both;
  - jobs past their promised date show as overdue.

### 11.23 Supplier sale-or-return
- **Given** 20 handbags received on sale-or-return from Fancy World at ₹300 each
- **Then** stock goes up by 20, valued at ₹6,000.00, against the consignment balance owed, not the supplier's normal balance.
- **When** 7 are sold, 3 are returned unsold, and a statement is made for the month
- **Then:**
  - the statement shows received 20, sold 7, returned 3, held 10;
  - it becomes a supplier bill of ₹2,100.00 for the 7 sold;
  - the consignment balance is ₹3,000.00 for the 10 still held;
  - a second statement for the same period adds nothing twice.

### 11.24 Tally export
- **Given** one day with till sales at two stores, a supplier bill, a supplier payment and an expense
- **Then** the export has one voucher for each, with debits equal to credits on every voucher, using the mapped ledger names.
- **Then** exporting the same day again gives identical vouchers, and the export is recorded in the history.

## Module 8 — Tax (GST) (plan 08)

Amounts use test rates entered for these scenarios. There is no CA approval step: a rate applies as soon as it is saved, and bills are never provisional.

### 8.1 Consumer bill, same state (the CLAUDE.md "GST invoice" minimum)
- **Given** MAIN in Tamil Nadu (33), a shirt priced ₹1,050 including 5% GST
- **Then** the bill shows taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00, HSN per line, the store's GSTIN and a unique number; it prints as a tax invoice. Accounts: output CGST and SGST up ₹25.00 each when the shift closes.

### 8.2 Business invoice to another state
- **Given** a buyer with a Karnataka GSTIN (29…) buying the same shirt at the till
- **Then** the bill becomes a business tax invoice with the buyer's name, address, GSTIN and state, place of supply Karnataka, IGST ₹50.00 and no CGST/SGST.
- **Then** a bad GSTIN is refused with a plain message.

### 8.3 Rate by selling price
- **Given** a test rule for HSN 6205: 5% up to ₹2,500 per piece, 18% above
- **Then** a ₹2,000 shirt is taxed at 5% and a ₹3,000 shirt at 18% on the same bill; the HSN summary shows two lines for 6205.

### 8.4 Rate change by date
- **Given** an HSN at 12% until 21 September 2025 and 5% from 22 September 2025
- **Then** a bill dated 21 September uses 12% and one dated 22 September uses 5%; an old bill reprinted later still shows 12%.

### 8.5 Return as a credit note
- **Then** a return of the 8.1 shirt reverses taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00, names the original bill number and date, and appears in GSTR-1 credit notes.
- **Then** a return dated after 30 November of the next financial year still refunds and returns the stock, with a warning that the tax cannot be adjusted.

### 8.6 Composition scheme
- **Given** the company switched to composition
- **Then** the same sale prints a "bill of supply" with the declaration and no tax; purchase tax goes into the cost of the goods; no input credit is posted.

### 8.7 Reverse charge and blocked credit on purchases
- **Then:**
  - a reverse-charge purchase bill of ₹10,000 at 18% posts ₹1,800.00 as tax payable by the shop and, where allowed, ₹1,800.00 input credit;
  - a line marked "credit not claimable" adds its tax to the cost of the goods.

### 8.8 GSTR-1 and HSN summary for a month
- **Given** a month with consumer bills in-state, a business invoice to another state, a large other-state consumer bill above ₹2.5 lakh, and two credit notes
- **Then:**
  - B2B, B2CL, B2CS (by state and rate), credit notes, HSN summary (business and consumer separately) and documents issued all add up to the sales tax register;
  - the Excel and JSON downloads carry the same figures.

### 8.9 GSTR-3B
- **Then** tax collected per head minus input credit per head, set off in the legal order (IGST first), plus reverse charge, gives the net payable; extra credit carries forward and never goes below zero.

### 8.10 E-invoice and e-way bill files
- **Given** e-invoicing switched on
- **Then:**
  - a business invoice produces the e-invoice JSON, and prints "not yet registered";
  - importing the portal's response attaches the reference number and signed QR code, which then print.
- **Then** a ₹60,000 transfer to another state produces the e-way bill JSON; with 450 km entered, validity is 3 days.

### 8.11 GST applies as soon as it is saved (owner decision, 22 October 2026)
- **Given** the GST settings at their defaults and a GST rate just added for a new HSN code (there is no approval step)
- **Then:**
  - a till bill using that rate is real GST at once: it is not marked provisional and carries no "GST provisional" flag;
  - the Owner can switch the tills live without any GST approval; nobody else can;
  - a GST rate can be edited; the change is in the history, new bills use the new rate and bills already saved keep the rate they were made with;
  - a bill saved as provisional before 22 October 2026 keeps that mark, and its return copies it.

### 8.12 Transfers between stores (G10)
- **Given** MAIN under the Tamil Nadu GSTIN, ANNA under the same GSTIN, BLR under a Karnataka GSTIN, and 50 shirts at MAIN at ₹500 (HSN 6205, 5%)
- **Then:**
  - sending 5 to ANNA prints a delivery challan (consignor, consignee, HSN, quantity, value) and posts no tax;
  - sending 10 to BLR prints a tax invoice: taxable ₹5,000.00 (stock at cost), IGST ₹250.00, place of supply Karnataka; output IGST at MAIN and input IGST at BLR go up by ₹250.00 each; stock arrives at BLR at ₹500.00;
  - cancelling an unreceived send to BLR takes its tax back; an item without an HSN code cannot be sent to BLR.

### 8.13 Purchase tax register
- **Then** for a GSTIN and a month, every supplier bill and debit note shows the supplier GSTIN, taxable value, CGST, SGST, IGST, the credit claimable, the tax not claimable and whether reverse charge applies; the totals and the Excel download carry the same figures.

### 8.14 Input credit matching (GSTR-2B)
- **Given** three bills of a supplier (₹2,000, ₹3,000, ₹4,000 at 5%) and a GSTR-2B file from the portal with the first (number typed differently), the second at ₹3,200, and one bill we never recorded
- **Then** the first is matched, the second shows the taxable and tax differences, the unknown one is "only on the portal" and the third bill is "only in our books"; a file for another GSTIN, or not a GSTR-2B, is refused with a plain message.

## Module 12 — Guided setup, modules on and off, settings centre (plan 12)

### 12.1 A fancy shop sees only what it needs
- **Given** a new company set up through the wizard as "Fancy and gift"
- **Then** nothing about sizes and colours, batches and expiry, serial numbers, seasons, alterations or sale-or-return appears anywhere: menus, item form, purchase screens, till, reports, settings.
- **Then** the API refuses those modules' actions with a plain "switched off" message.

### 12.2 Switching a module on and off keeps the data
- **Given** a clothing shop with 3 styles in sizes and colours
- **When** "Sizes and colours" is switched off, then on again
- **Then:**
  - while off, the variants still sell at the till as ordinary items and their stock stays correct;
  - when back on, the styles, sizes and colours are exactly as before.
- Nothing is deleted at any point.

### 12.3 Warnings and dependencies
- **Then:**
  - switching off "Customer orders" with 3 open orders warns "3 customer orders are still open" before going ahead;
  - switching on "Alterations" also switches on "Salesperson", and says so;
  - only the Owner can switch modules, and every change is in the history.

### 12.4 Existing companies
- **Then** after the update, an existing company has every optional module on and nothing disappears.

### 12.5 Shop types fill in settings
- **Then:**
  - "Clothing" switches on sizes and colours, seasons and markdowns, salesperson, alterations, customer orders and offers, and creates the starting size and colour lists and item groups;
  - "Cosmetics" switches on batches and expiry;
  - "Mobiles" switches on serial numbers.
- Re-applying a different shop type asks first and deletes nothing.

### 12.6 Guided setup
- **Then:**
  - the wizard saves each step; closing the browser after step 2 and logging in again resumes at step 3 with the earlier answers kept;
  - finishing it fills in the company, GST registration, first shop and tills, and switches on the chosen modules.
- Since plan 14 the owner signs up first (name, email, password, shop name) and goes through the wizard logged in; the wizard no longer asks for the owner or the password.

### 12.7 Getting-started checklist
- **Then** the checklist shows the open steps; adding a till, importing items and making a test bill tick their steps automatically; the owner can hide it.

### 12.8 Settings centre
- **Then:**
  - every setting shows a plain label, an explanation and its default;
  - "back to default" restores it;
  - settings of switched-off modules are hidden;
  - search finds a setting by name.

## Module 13 — Loyalty points and gift cards (plan 13)

Starting values: ₹100 spent = 1 point; 1 point = ₹1; points last 365 days; minimum 100 points to spend; at most 50% of a bill in points; gift cards last 12 months.

### 13.1 Earning points
- **Given** member Priya buys for ₹2,450
- **Then:**
  - she earns 24 points (fractions dropped), expiring in 365 days;
  - loyalty expense is debited and loyalty points liability credited ₹24.00;
  - the receipt shows her new balance.
- **Then** a walk-in bill earns nothing.

### 13.2 Spending points
- **Given** Priya has 150 points
- **Then:**
  - on a ₹500 bill she can spend 100 points: the bill shows ₹100.00 paid with points and she pays ₹400.00;
  - the liability goes down ₹100.00;
  - the bill earns points only on the ₹400.00 she paid (4 points).
- **Then:**
  - spending 90 points is refused (minimum 100);
  - spending 300 points on a ₹500 bill is refused (more than 50%);
  - spending offline is refused with a plain message.

### 13.3 Returns and cancelling (decision 16)
- **Then:**
  - returning half of the 13.2 bill takes back the points earned on the returned lines and gives back the points spent on them, in proportion;
  - cancelling the bill reverses both completely.

### 13.4 Expiry and tiers
- **Then** points not spent within 365 days expire; the liability goes down by their value, credited back as set.
- **Given** a Gold tier from ₹25,000 spent in a year at ₹100 = 2 points
- **Then** her bills after crossing ₹25,000 earn at the Gold rate.
- **Then** the liability always equals unexpired points × point value.

### 13.5 Selling and reloading a gift card
- **Then:**
  - selling a ₹1,000 gift card for cash puts cash up ₹1,000.00 and gift card liability up ₹1,000.00, with no GST and no stock movement;
  - the card number is unique and the receipt shows it;
  - reloading ₹500 more makes the balance ₹1,500.00.

### 13.6 Spending a gift card
- **Then:**
  - a ₹600 bill (GST included) paid with the card charges GST on the goods as usual, reduces the liability by ₹600.00 and leaves ₹900.00 on the card;
  - a blocked card is refused;
  - an expired card is refused.

### 13.7 Returns and expiry of gift cards
- **Then:**
  - returning goods paid with a gift card puts the money back on the card;
  - when a card expires, its balance is written back as set, after appearing in the expiring-cards report;
  - the gift card liability always equals the sum of card balances.

## Module 14 — One system for many shops (plan 14)

### 14.1 Two shops with the same codes
- **Given** two shops, each with item code ITM-000001, barcode 8903000000006, shop code MAIN and a customer "Priya Raman"
- **Then:**
  - both are saved without clashing, and scanning the barcode in each shop finds that shop's own item;
  - document numbers, item codes and customer codes run separately in each shop.

### 14.2 A shop never sees another shop's data
- **Then:**
  - every list (items, customers, suppliers, shops, users, roles, history) shows only the shop's own rows;
  - opening, changing or deactivating another shop's record by its id is refused, and nothing of the other shop changes;
  - another shop's id slipped into a new record (for example an item group) is refused, and nothing is saved;
  - the database itself (row-level security) shows a shop only its own rows, and no rows at all when the shop is not known.

### 14.3 Sign-up
- **Then:**
  - signing up with name, email, password and shop name makes the shop with its six roles, standard units, groups and settings, and logs the owner in;
  - the owner is taken to the setup wizard until it is finished;
  - an email that already belongs to any shop cannot sign up again; a weak password is refused and nothing is made.

### 14.4 A switched-off shop
- **Then** when Rademics switches a shop off, its people cannot log in and their open sessions stop working; switching it on again lets them back in.

### 14.5 Clearing trial data clears only the shop's own data
- **Then** a shop clearing its trial data (decision 72) removes only its own bills, stock movements and ledger entries; every other shop's data is untouched.

### 14.6 Download all my data
- **Given** two shops, each with items, customers and users
- **Then:**
  - the Owner of one shop downloads one zip with a CSV file per list and a "READ ME" naming each file and its row count;
  - the file holds only that shop's rows, never another shop's;
  - passwords, PINs and login sessions are not in it;
  - amounts keep every digit as stored (an MRP of 249 is 249.00);
  - the download is recorded in the shop's change history; only the Owner can download.

### 14.7 Forgot password
- **Given** a shop owner who has forgotten their password
- **Then:**
  - "Forgot password?" answers the same for any email, so it never tells who has an account; only an active account in an active shop gets an email;
  - the email's link works once and stops working after 30 minutes; asking again makes the earlier link stop working; at most three links an hour are sent to one person;
  - only a hash of the link is kept in the database;
  - a too-short new password is refused and the link still works;
  - saving the new password ends every open session of the account, the old password stops working, a "your password was changed" email follows, and both the request and the reset are in the login history.

### 14.8 Confirm your email at sign-up
- **Then:**
  - signing up sends a "confirm your email" link, and the owner sees a reminder bar with "Send the link again" until it is used;
  - sending it again makes the earlier link stop working; the link works once (7 days);
  - a confirm link cannot reset a password and a reset link cannot confirm an email;
  - everyone already using the system before this change counts as confirmed.

### 14.9 Rate limits
- **Then:**
  - from one connection, at most 20 login tries in 10 minutes (the 21st is refused even with the right password), 5 sign-ups an hour, 5 "forgot password" requests in 15 minutes, 20 link uses in 15 minutes and 5 contact-form messages an hour;
  - the whole API takes about 20 requests a second from one connection, enough for a busy shop sharing one internet line;
  - a refused request says "Too many tries from this connection. Please wait a few minutes and try again." and tells the browser when to try again;
  - one limit being reached does not block other pages.


## Module 15 — The owner's decisions of 28 October 2026 (L1–L12)

### 15.1 Clothing template (L1, L2, L6)
- **Given** the owner picks the shop type "Clothing"
- **Then** the shop's own HSN list gets the common clothing headings (6104–6111, 6115, 6203–6211, 6214) with the official descriptions of the GST portal's list; the size list is XS, S, M, L, XL, XXL and Free size; a new item starts with a 10% maximum discount (a typed one wins). Applying the shop type again adds nothing twice and leaves the shop's own wording alone.

### 15.2 Cosmetics template (L12)
- **Then** a new batch item starts with "Number batches automatically" off (the batch number on the pack is typed in); the owner can still tick it per item; other shop types start it on.

### 15.3 Withdrawing or ending a markdown (L3)
- **Given** a 20% markdown starting in two days
- **When** it is withdrawn with a reason
- **Then** its prices never apply (each ends the day before it starts, nothing is deleted, every change is in the history), and it shows "Withdrawn".
- **Given** a markdown that started three days ago
- **When** it is ended now
- **Then** from today the price before the markdown applies again; the days it ran keep its price; it shows "Ended" with yesterday as its last day.

### 15.4 GST rate on a purchase order (L4)
- **Given** HSN 6203 at 5% up to ₹2,500 and 18% above, and items never bought before
- **Then** a line at ₹900 a piece starts at 5%, one at ₹6,000 at 18%, and an item whose HSN has no rate at 0%.

### 15.5 Freight on goods returned (L5)
- **Given** 10 T-shirts at ₹100 with ₹100 freight added (₹110 each in stock), billed by the supplier
- **When** 2 go back on a debit note
- **Then** goods received not billed is ₹0.00 and ₹20.00 of the freight goes back to Freight inward (₹80.00 left as the cost of the 8 kept).

### 15.6 Clothing price band (L7)
- **Then** the ₹2,500 band is on the value before GST, after discounts (CBIC GST rates FAQ 33: the transaction value; CGST Act section 15: it does not include the GST). At the till a ₹2,625 shirt (₹2,500 + 5%) is at 5%, a ₹2,700 one at 18% (the higher rate when the price fits no band once its GST is taken out).

### 15.7 CGST equals SGST (L8)
- **Then** within a state, CGST and SGST of every line (and so of every bill) are equal; the odd paisa stays in the taxable value.

### 15.8 Till rounding (L9)
- **Then** a till day's accounts entry may differ by at most 1 paisa per bill, which goes to Rounding; more is refused.

### 15.9 Cash accounts of a new store (L10)
- **Then** a store added in Settings has "Cash in till" and "Cash in hand" at once, before its first till shift.

## Audits 1–3: access, money and stock (27–28 October 2026)

### A1 Each shop and each store sees only its own
- **Then** a store manager cannot read, change or cancel another store's documents, the owner dashboard or the Owner's PIN; someone trusted with users cannot hand out stores they do not work in or reset a user with more rights; every GET route called by another shop or store carries none of the first one's ids; twenty PIN guesses sent together get five tries, then the PIN locks (`module14-audit1`, `module14-audit1b`, `module14-sweep`).

### A2 Money and accounts
- **Then** cancelling a return to the supplier gives its freight share back; a double click posts once; the books cannot be locked over an open till shift (`module15-audit2`).

### A3 Two things at once, and minus stock
- **Then** the same goods returned at two tills at once are refunded once; a phone is sold once and comes back only on its own bill; goods arriving into minus stock re-cost what was already sold, to the paisa; a transfer partly received can be closed short (`module15-audit3`).

## Audit 4: GST and the law (28 October 2026; automated in `module15-audit4.e2e-spec.ts`)

### A4.1 SEZ supply (T6)
- **Given** a customer with a Tamil Nadu GSTIN marked "SEZ unit", the shop in Tamil Nadu
- **Then** a ₹1,050 shirt is billed with IGST ₹50.00 (no CGST/SGST) and the SEZ endorsement; with "SEZ sales without GST (LUT)" on, taxable ₹1,050.00 and no tax. GSTR-1 lists them as SEWP and SEWOP; GSTR-3B 3.1(b) shows taxable ₹2,050.00, IGST ₹50.00.

### A4.2 Taxable and exempt goods on one bill (T10)
- **Then** a walk-in buying a shirt and milk gets an "Invoice-cum-bill of supply"; a business buyer is refused (two documents); milk alone is a "Bill of supply".

### A4.3 Delivery charge (T4)
- **Then** a ₹50 delivery with a 5% shirt is at 5%; with a 5% shirt and an 18% bag it is at 18%.

### A4.4 Credit note and return note (T7–T9)
- **Then** a return to a walk-in without a name is refused ("A credit note needs the customer's name"); with "Lakshmi" it is a credit note reducing CGST ₹25.00, state 33. A return without the bill is a "Return note" with no GST, not in GSTR-1. A return after 30 November of the next year refunds the money and returns the stock, without reducing GST.

### A4.5 Filed months (T15) and IFF
- **Then** a month can be marked filed only after it ends; an offline bill of a filed month that arrives later is reported in the next month. A quarterly filer's first or second month is an IFF with business invoices only; the third month has none.

### A4.6 Composition (T3, T13)
- **Then** a composition shop cannot bill a Karnataka buyer; GSTR-3B shows the CMP-08 figure: 0.5% CGST and 0.5% SGST of taxable turnover.

### A4.7 Input credit (T11)
- **Then** without an imported GSTR-2B, GSTR-3B says to import it; credit of bills the supplier did not report is held back and claimed when it appears; credit after the s.16(4) limit is left out (unit tests in `gst-inward.spec.ts`).

### A4.8 Other checks
- **Then** a business invoice with an item without HSN is refused; a cess rate cannot be saved; a bill with a registered IRN cannot be cancelled; HSN digits under 6 are refused above ₹5 crore turnover.

## Audit 5: Billing counter and offline (29 October 2026; automated in `module16-audit5.e2e-spec.ts` and the till tests)

### A5.1 An offline day
- **Given** a till offline all day while the office uses up a coupon, switches off an item, lowers a discount limit and removes a payment method
- **Then** every bill made offline is kept as sold when it arrives and listed on "Offline bills to check" with what was charged and what the price list said; none is refused.

### A5.2 Closing with unsent bills (C3)
- **Then** a shift with a bill that "could not be sent" cannot close; the office posts it into the shift ("Post into shift"), and the close then expects its cash.

### A5.3 Approvals tied to the amount
- **Then** a manager's approval of a ₹150 cash shortage does not cover a ₹200 shortage; a bill discount or cash out approval covers only the amount approved.

### A5.4 A lost answer
- **Then** a bill whose answer was lost after the server saved it is shown as saved; sending the same bill identity with other contents is refused.

### A5.5 Drawer and cash out (C4, C5)
- **Then** No-sale opens the drawer only with a manager PIN and is recorded on the shift; a cash out above ₹2,000 needs a manager.

## Audit 7: Data safety (29 October 2026; automated in `module18-audit7.e2e-spec.ts`)

### A7.1 Clearing trial data clears all of it
- **Given** a trial with a gift card sold and loyalty points earned
- **Then** clearing removes the card, its entries, the points and the ledger together; the card can no longer be checked at the till; customers stay; the books are in order. Every table with a shop column is on the "cleared" or the "kept" list.

### A7.2 No clearing after reporting to the GST portal
- **Then** with a registered e-invoice, a generated e-way bill or a month marked as filed, clearing is refused and nothing is deleted.

### A7.3 The database backs up the rules
- **Then** deleting a finalised document, changing a gift card entry, a negative gift card balance or a GST rate over 100% are refused by the database itself.

## Audit 8: Speed and growth (30 October 2026; automated in `module19-audit8.e2e-spec.ts`, 14.9, and the speed kit in `apps/api/perf`)

### A8.1 Each shop its own modules
- **Then** a module switched off in one shop stays on in another, at once.

### A8.2 Stock movement from today's stock
- **Then** opening, in, out and closing are right for a period before, during and after the movements.

### A8.3 E-mail allowance
- **Then** after the day's allowance for other e-mails is used, a password e-mail still goes out.

### A8.4 Two years of a busy shop
- **Given** 504,719 bills over two years and 53,200 items
- **Then** daily screens, reports for a day or a month and the till are under 2 seconds; no report takes the server down.

## Audit 9: Screens and ease of use (30 October 2026; automated in `audit9.test.tsx`, `audit11.test.tsx`, `till.test.tsx` and `bills.test.tsx`)

### A9.1 A sale by keyboard alone
- **Then** scan, + for quantity, F4, Enter (the till's usual payment), Enter (finish), Enter (next bill): the cursor is back in the scan box.

### A9.2 Dialogs
- **Then** a dialog opens with the cursor in its first box and returns it where it was when closed; a locked till takes no keys.

### A9.3 Nothing lost
- **Then** leaving an editor with unsaved changes asks first; a sign-in that ends sends the person back to their page after logging in.

### A9.4 Finalise and post
- **Then** each asks once, in plain words, before stock or the accounts change.

## Audit 11: The minimums end to end (30 October 2026; automated in `module20-audit11.e2e-spec.ts`)

Rice (HSN 1006, 5%) sells at ₹105 (₹100 + ₹2.50 CGST + ₹2.50 SGST) and costs ₹60; soap (HSN 3402, 18%) sells at ₹118 and costs ₹70. Opening stock ₹4,400. Each scenario checks the stock, the accounts by account and the GST, and that the books agree with themselves and with the stock.

### A11.1 Sale and GST tax invoice
- **When** 2 rice are sold for ₹210 cash and the shift closes
- **Then** the bill is taxable ₹200.00, CGST ₹5.00, SGST ₹5.00; 48 rice left worth ₹2,880.00; Sales −200.00, output CGST −5.00, output SGST −5.00, cost of goods sold 120.00, stock 4,280.00, cash in hand 210.00.

### A11.2 Return
- **When** 1 of the 2 comes back for ₹105 cash
- **Then** the return is −100.00 / −2.50 / −2.50; 49 rice at ₹2,940.00; Sales −100.00, cost of goods sold 60.00, cash in hand 105.00.

### A11.3 Exchange
- **When** a soap goes back and a rice goes out, ₹13 refunded
- **Then** the soap credit is at 18% (−100.00 / −9.00 / −9.00) and the rice sale at 5% (100.00 / 2.50 / 2.50); output CGST −2.50 overall.

### A11.4 Negative-stock sale at the till
- **When** 52 rice are sold with 50 on the shelf
- **Then** the bill is flagged; stock −2 worth −120.00; cost of goods sold 3,120.00, stock 1,280.00.

### A11.5 Shift closed ₹2 short
- **Then** cash short or over 2.00, cash in hand 103.00, cash in till 0.00.

### A11.6 Card and UPI at the till
- **Then** card settlement 105.00, UPI settlement 118.00, cash untouched; output CGST −11.50; cost of goods sold 130.00.

### A11.7 Return without the bill (11.8 in full)
- **Then** refused without a manager PIN, offline, or by a method that does not allow refunds; with them, −105.00, stock 51 worth ₹3,060.00, cash in hand −105.00.

### A11.8 E-way bill stops clearing (A7.2)
- **Then** with a generated e-way bill, clearing the trial data is refused and nothing is deleted.

### A11.9 Year-end with stock and accounts apart (11.9)
- **Then** a ₹500 stock movement in March with no ledger entry stops the year-end closing, naming the store and the difference.

### A11.10 The till hears of late saves
- **Then** the till's "changes since" download reaches back 5 minutes, so an item saved by a change that began before the download still reaches the till next time.

## Audit 11, part 2: routes no test called (30 October 2026; automated in `module21-audit11b.e2e-spec.ts`)

### A11.11 The till and the server price alike
- **Then** an offer, a typed discount and a return, a bill discount shared over 3 lines, and a Karnataka business buyer (IGST) are priced by the till's own code and by the server to the same paisa, line by line; a bill whose total the till got wrong is refused and not saved.

### A11.12 Balance sheet
- **Then** after a sale, a supplier bill, a part payment and rent, the balance sheet balances (assets = liabilities + capital + profit not yet closed); as of yesterday it is empty.

### A11.13 Payment links and opening bills
- **Then** undoing a ₹600 link on a ₹1,000 bill leaves ₹1,000 owed and ₹600 unused; a second undo is refused. An opening bill with a payment linked cannot be cancelled; once unlinked it is cancelled by a reversing entry, once only.

### A11.14 Points and gift cards
- **Then** they are paid only with their own buttons: a till cannot tick them, a bill paid with them as a plain method is refused, and a gift card cannot be bought on account or with points.

### A11.15 Box sizes
- **Then** changing a box from 12 to 10 leaves goods already received at 24 pieces; boxes received on an order made before the change come in at 12 a box; new receipts without an order use 10.

### A11.16 Reports and draft edits
- **Then** the purchase register, by supplier and by item agree; received-not-billed and order follow-up show what is pending; till hourly, by cashier and shifts add up to the day; returns show as minus; draft bills, receipts, payments and journals can be changed until posted, never after.
