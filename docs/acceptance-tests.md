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
- **Then** its state is recorded as 29 and the GST treatment helper answers "other state" for its billing address; a GSTIN whose state digits differ from the typed state is refused.

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
- **Then** total ₹372.00. Basmati: taxable ₹228.57, CGST ₹5.72, SGST ₹5.71. Surf: taxable ₹111.86, CGST ₹10.07, SGST ₹10.07. Change ₹128.00. Stock Basmati 98, Surf 49. Cost of goods sold stored: ₹180.00 and ₹95.00.

### 6.2 A return ★
- **When** 1 Basmati from 6.1 comes back
- **Then** the refund is ₹120.00 in cash (taxable ₹114.29, CGST ₹2.86, SGST ₹2.85), and stock is 99 at the original cost of ₹90.00. Returning 2 more is refused: only 1 is left to return.

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
