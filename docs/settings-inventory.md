# Settings inventory (plan 12 §5)

**What this is:** every setting the product has today, area by area: where it lives, what it does in plain words,
and its default. After each area, 2–5 **proposed additions** for the owner to choose from.
**Nothing proposed here is built.** The owner marks which to add; each then goes into a plan as usual.

**Where settings are shown now:** the new **Settings** page (`/settings`) lists every company-wide setting below with
its label, a one-line explanation, its default and a "back to default" button, and hides the areas of modules that
are switched off. The older screens still work and are linked from it. Settings marked *(own screen)* are shown on the
Settings page but changed only on their own screen, because they need a picker or extra checks there.

## Summary

| Area | Settings today | Proposed additions |
| --- | --- | --- |
| 1. Company and shops | 8 | 4 |
| 2. Items | 4 | 4 |
| 3. Prices | 6 | 4 |
| 4. Customers | 4 | 4 |
| 5. Credit sales | 1 | 3 |
| 6. Suppliers and buying | 8 | 4 |
| 7. Purchase orders | 5 | 3 |
| 8. Stock | 4 | 3 |
| 9. Batches and expiry | 1 | 3 |
| 10. Billing counter (till) | 12 | 5 |
| 11. Salesperson, home delivery, alterations, customer orders, offers, seasons | 4 | 10 |
| 12. GST | 9 | 3 |
| 13. E-invoice and e-way bill | 5 | 3 |
| 14. Accounts | 6 | 4 |
| 15. Expenses, Tally | 1 | 4 |
| 16. Reports and summary email | 4 | 3 |
| 17. Printing and labels | 6 | 4 |
| 18. Users and security | 8 | 4 |
| 19. Numbering | 1 | 3 |
| **Total** | **97** | **75** |

"Settings today" counts each separate thing an owner can set (a list such as GST rates or payment methods counts once).
Of these, **61 company-wide settings** are on the Settings page; the rest are per shop, per till, per supplier or lists,
reached from the links on the Settings page.

---

## 1. Company and shops

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Company details (legal and trade name, PAN, address, phone, email) | Company | Printed on documents; the trade name shows on bills | From first-time setup |
| GST registrations (one or more GSTINs) | Company | Each shop bills under one GSTIN | From setup, or none |
| Shops (name, code, address, GSTIN) | Shops | Where stock is kept and bills are made | One shop from setup |
| Each shop's delivery charge, and "free above" | Shops | Charge added for home delivery at that shop | ₹0; no "free above" |
| Financial years | Financial years | The accounting years; documents are numbered per year | Current Indian year, 1 April – 31 March |
| Go-live date | Going live | After it, trial data can never be cleared; set once by the Owner | Not set |
| Shop type | Setup / My modules | Starting modules and lists for the kind of shop | Chosen at setup |
| Getting-started checklist shown | Dashboard | The owner can hide it | Shown |

**Proposed additions**
1. Shop opening and closing time — the till warns about bills made after closing, and the day's figures use it.
2. A "main shop" that new purchase orders and reports start with.
3. Business type (proprietor, partnership, company) printed on documents.
4. Each shop's own phone and email printed on its receipts when different from the company's.

## 2. Items

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Number items automatically | Catalogue settings | A new item without a typed code gets ITM-000001, … | On |
| Default item group | Catalogue settings | The group a new item starts in | None |
| Default unit | Catalogue settings | The unit a new item is counted in | PCS (pieces) |
| Lists kept: item groups, brands, units, HSN codes, attributes (sizes, colours) | Their own screens | What items are described with | Starting lists from setup and shop type |

**Proposed additions**
1. HSN code required on every new item (off / warn / required) — useful before GST goes live.
2. A default HSN code and GST rate per item group, filled in for new items of that group.
3. Make a shop barcode automatically for an item that has none.
4. Item names in capitals or as typed.

## 3. Prices

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Default selling price list | Catalogue settings | Used by the till and for an item's first price | Standard Selling |
| Default buying price list | Catalogue settings | Used for prices on purchase orders | Standard Buying |
| Fall back to the default selling list | Catalogue settings | When a customer's list has no price, use the default list | On |
| Allow changing the price on a bill | Catalogue settings | Off: only a manager with a PIN changes a price | Off |
| Block selling below cost | Catalogue settings | A line under cost needs a manager's PIN | Off |
| Save typed prices into the price list | Catalogue settings | A price typed for an item with none becomes its price | Off |

**Proposed additions**
1. Price ending for new and marked-down prices (for example ₹9 or ₹99 endings).
2. Warn when a price leaves less than a set margin over cost.
3. Selling price may never be above MRP: warn or block (the law forbids selling above MRP; the choice is how the till reacts).
4. Show the "you save" amount (MRP less price) on receipts.

## 4. Customers

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Default customer group | Party settings | Group for customers added at the till or without a group | Retail |
| Default payment terms | Party settings | Terms when neither the party nor its group names any | Cash |
| Address that decides same-state or other-state GST | Party settings | Billing or delivery address sets CGST+SGST or IGST | Billing address |
| Walk-in customer | Made automatically | The customer on bills without a named customer | "Walk-in customer" |

**Proposed additions**
1. Ask for the customer's mobile number on every bill: off / optional / required.
2. Same mobile number on two customers: allow, warn or block.
3. Birthday and anniversary reminders on the dashboard (days ahead).
4. A customer number pattern per shop (for example CUS-ANNA-…).

## 5. Credit sales (optional module)

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Default credit limit | Party settings | What a new customer may owe; 0 = no credit until set | ₹0 |

Each customer's own credit limit is on the customer's page.

**Proposed additions**
1. Over the credit limit at the till: warn, manager PIN, or refuse.
2. Reminder on the dashboard when a customer is overdue by more than N days.
3. Interest or a late fee on overdue amounts (off by default; the CA confirms the accounting).

## 6. Suppliers and buying

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Default supplier group | Party settings | Group for a new supplier when none is chosen | Local suppliers |
| Extra allowed when receiving (%) | Purchase settings | How much more than ordered may be received | 0% |
| Extra allowed when billing (%) | Purchase settings | How much more than received may be billed | 0% |
| When the bill price differs from the order | Purchase settings | Allow, warn, or refuse | Warn |
| Check supplier bill numbers | Purchase settings | Stops one supplier's bill number being entered twice | On |
| A bill for goods needs a goods receipt | Purchase settings | Goods must be received before billing | Off |
| Fill in the last purchase price | Purchase settings | New lines start with the last price paid | On |
| Per-supplier exceptions to the order/receipt rules | Supplier's page | Lets one supplier skip the rules above | None |

**Proposed additions**
1. Reminder N days before a supplier bill falls due.
2. A copy (photo or PDF) of the supplier's bill required on every supplier bill.
3. Default GST input-credit choice for a new supplier.
4. Goods receipt quantity checked against the supplier's delivery note (warn on difference).

## 7. Purchase orders (optional module)

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Approval limit | Purchase settings | Orders above it need a Store Manager or the Owner | ₹50,000 |
| Extra allowed when ordering (%) | Purchase settings | How far an order may go above the suggestion | 0% |
| Goods must come against a purchase order | Purchase settings | Off: a manager may receive without an order, with a reason | Off |
| A bill for goods needs a purchase order | Purchase settings | Every goods line must come from an order | Off |
| Order number pattern | Document numbering | PO-{shop}-{year}-000001 | PO-{STORE}-{FY}- |

**Proposed additions**
1. Orders close by themselves after N days if not received.
2. Email the finalised order to the supplier.
3. A second, higher approval limit that only the Owner can approve.

## 8. Stock

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Stock locked up to | Inventory settings | Month-end lock: nothing posted or cancelled on or before it | Not locked |
| Allow selling below zero at the till | Inventory settings | A sale is never stopped; it is flagged on the Negative stock list | On |
| Stock locations per shop | Locations | Shop floor, back room, rejected goods | Made with each shop |
| Reorder levels | Reorder levels | When an item is suggested for ordering | None |

The goods-in-transit place is made automatically and has no setting.

**Proposed additions**
1. A stock-count difference above ₹N needs the Owner's approval before it is posted.
2. Lock stock automatically on day N of the next month.
3. Reorder suggestions on or off per shop.

## 9. Batches and expiry (optional module)

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Batch the till sells first | Inventory settings | Earliest expiry first, or oldest batch first | Earliest expiry first |

**Proposed additions**
1. Warn at the till when a batch expires within N days.
2. Selling an expired batch: warn, manager PIN, or refuse.
3. A default shelf life per item group, to fill in expiry dates at receipt.

## 10. Billing counter (till)

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Cash difference needing a manager | Till settings | A bigger difference at closing needs a manager's PIN | ₹100 |
| Receipt copies | Till settings | Receipts printed per bill | 1 |
| Tills bill for real (live) *(own screen)* | Till settings | Owner only, after the accountant approves GST | Off |
| Each till: cashier discount allowed | Till's page | Discount a cashier gives without a manager | 5% |
| Each till: price change allowed | Till's page | Lets the till change prices (still subject to §3) | Off |
| Each till: print automatically | Till's page | Prints the receipt when the bill is saved | On |
| Each till: receipt footer | Till's page | Text at the foot of the receipt | None |
| Each till: invoice number prefix | Till's page | PREFIX/2627/000001 (within GST's 16 characters) | From shop and till codes |
| Each till: payment methods taken, and the default | Till's page | What the till accepts | Cash (default), card, UPI |
| Payment methods: refund allowed, reference needed | Payment methods | Per method | Refund on; reference for card and UPI |
| Manager PINs | My till PIN | Approvals at the till | Each manager sets their own |
| Till computers | Till's page | Which computer is the till | Registered per till |

**Proposed additions**
1. Round the bill total to the nearest rupee or 50 paise (the rounding rule itself stays in the core; the choice of step is the setting).
2. Highest discount per role (cashier, manager) instead of one per till.
3. Print a gift receipt without prices on request.
4. A held (parked) bill is cleared after N hours.
5. Ask "Print receipt?" instead of always printing.

## 11. Smaller optional modules

| Module | Setting | Where | Default |
| --- | --- | --- | --- |
| Home delivery | Item the delivery charge is billed as *(own screen)* | Till settings | Not set |
| Home delivery | Each shop's delivery charge and "free above" | Shops | ₹0; none |
| Alterations | Item alteration charges are billed as *(own screen)* | Till settings | Not set |
| Salesperson, customer orders, offers, seasons | — (lists only: sales staff, orders, offers, seasons) | Their screens | — |

**Proposed additions**
- Salesperson: (1) salesperson required on every bill; (2) commission % per salesperson for the sales report.
- Home delivery: (3) delivery time slots; (4) delivery charge by distance band.
- Alterations: (5) default promised days; (6) alteration slip printed with the bill.
- Customer orders: (7) smallest advance as a % of the order; (8) days goods stay set aside before the customer is reminded.
- Offers: (9) whether two offers may apply to one line. Seasons: (10) reminder when a season ends with stock left.

## 12. GST

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| GST scheme | GST settings | Regular (tax invoices) or composition (bills of supply) | Regular |
| Returns filed | GST settings | Quarterly (up to ₹5 crore) or monthly | Quarterly |
| Turnover band | GST settings | Decides HSN digits and e-invoicing | Up to ₹5 crore |
| HSN digits on invoices | GST settings | 4, 6 or 8 | 4 |
| GST table on till receipts | GST settings | Tax by rate at the foot of the receipt | On |
| Combine sales under ₹200 in reports | GST settings | One daily line in the GST reports; bills are all kept | On |
| Free samples | GST settings | How samples are taxed; the CA decides | Not set |
| Approved by the Chartered Accountant *(own screen)* | GST settings | Until approved every bill is provisional | Not approved |
| GST rates by HSN code (list) | GST rates | Rate by HSN, date and price band | None |

**Proposed additions**
1. Reminder before each return's due date (GSTR-1, GSTR-3B), with the period's figures.
2. Warn when an item's HSN code has no rate in the rate list.
3. A check that the shop's GSTIN state matches the shop's address state.

## 13. E-invoice and e-way bill (optional modules)

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| E-invoicing applies | GST settings | Business invoices are registered on the e-invoice portal | Off (on at setup above ₹5 crore) |
| E-way bill needed above | GST settings | Value above which moving goods need an e-way bill | ₹50,000 |
| Own limits of some states | GST settings (no screen yet) | Same-state limits set by states | None |
| Usual transporter's GSTIN or id | GST settings | Filled in on new e-way bills | None |
| Usual transporter's name | GST settings | Filled in on new e-way bills | None |

**Proposed additions**
1. A screen to set the states' own e-way limits (the value exists but cannot be changed on a screen today).
2. Make the e-invoice file for the day's business invoices at day close.
3. Default vehicle type and approximate distance per destination shop.

## 14. Accounts

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Default accounts (one per kind of money) | Default accounts | Which account sales, stock, tax and payments post to | Standard chart |
| Bank accounts | Bank accounts | Banks money is paid into and out of | None |
| Books locked up to | Closing the books | Nothing dated on or before it can be posted | Not locked |
| Chart of accounts approved by the accountant *(own screen)* | Chart of accounts | The CA's check of the chart | Not approved |
| Age bands for unpaid bills | No screen yet | Columns of the ageing reports | 30, 60, 90, 120 days |
| Accounting document number patterns | Document numbering | JV-, RCT-, PAY-, TRF-, EXP- with the year | As listed |

**Proposed additions**
1. A screen to change the age bands.
2. Warn when cash in a shop's till or cash in hand goes above ₹N (bank it).
3. Reminder to deposit the day's cash by a set time.
4. Lock the books automatically N days after each month ends.

## 15. Expenses and Tally (optional modules)

| Module | Setting | Where | Default |
| --- | --- | --- | --- |
| Tally export | Our account → Tally ledger names | Export to Tally | Same names as ours |
| Expenses | — | — | — |

**Proposed additions**
1. Expense categories with a limit above which the Owner approves.
2. A photo of the expense bill required above ₹N.
3. Tally company name and voucher type names used in the export.
4. Export to Tally automatically every month end.

## 16. Reports and summary email

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Send the daily summary email | Daily summary email | On or off | Off |
| Send at (Indian time) | Daily summary email | Evening = that day; morning = the day before | 21:00 |
| Who receives it *(own screen)* | Daily summary email | Picked from the users | Nobody |
| Figures in the email *(own screen)* | Daily summary email | Which figures it carries | All of them |

**Proposed additions**
1. A weekly and a monthly summary email as well as the daily one.
2. Which tiles each person's dashboard shows.
3. Send the email only on days the shop was open.

## 17. Printing and labels

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Paper size | Printing settings | A4 or A5 for printed documents | A4 |
| Print the logo at the top | Printing settings | Uses the uploaded logo | On |
| Each shop's own name, address and GSTIN | Printing settings | Off: the company's on every shop's documents | On |
| Logo *(own screen)* | Printing settings | PNG or JPEG | None |
| Standard terms (list) | Printing settings | Footer texts, default per document kind | None |
| Label templates (list) | Label templates | Price label sizes and what they show | Standard templates |

**Proposed additions**
1. A signature line ("For Lakshmi Fancy Stores, Authorised signatory") on chosen documents.
2. A footer line printed on every document (for example a website or thank-you note).
3. Print the bank details for payment on customer statements.
4. Default label template per item group (for example small labels for jewellery).

## 18. Users and security

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Shortest password | No screen yet (shown read only) | Shorter passwords are refused | 10 characters |
| Wrong passwords before a lock-out | No screen yet | Then the login is locked for a while | 5 tries |
| Lock-out lasts | No screen yet | How long a locked login waits | 900 seconds |
| Log out after no use for | No screen yet | An unused login ends by itself | 30 minutes |
| Longest a login lasts | No screen yet | A login ends after this even in use | 12 hours |
| One login per person at a time | No screen yet | A second login ends the first | Off |
| Roles and their rights | Roles | What each role may do | Standard roles |
| Users, their roles and shops | Users | Who may log in, and where | The owner from setup |

**Proposed additions**
1. A screen for the six security settings above (Owner only, every change in the history).
2. Change passwords every N days (off by default).
3. Hours in which staff may log in (the Owner always may).
4. A second step at login for the Owner (a code by email).

## 19. Numbering

| Setting | Where | What it does | Default |
| --- | --- | --- | --- |
| Number pattern and counter length per document kind | Document numbering | How each document's number looks | ITM-, CUS-, SUP-, PO-{STORE}-{FY}-, GRN-{STORE}-{FY}-, SIN-/SOT-/MOV-/TRR-/CNT-{STORE}-{FY}-, JV-/RCT-/PAY-/TRF-/EXP-{FY}-, CO-/ALT-{FY}-; till bills PREFIX/2627/ |

**Proposed additions**
1. A separate customer and supplier number pattern per shop.
2. Show the next number a pattern will give before saving it (a preview).
3. Start item numbers per item group (for example JEW-0001 for jewellery).
