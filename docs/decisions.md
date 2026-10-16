# Decisions — Version 1 Baseline

This file records the agreed answers to the 81 open questions in `docs/blueprint/99-open-questions.md`.

**Rules for using this file**

- Where this file and the blueprint differ, **this file wins**.
- Items marked **OPEN** are not decided yet. Do not build those parts until the project owner records a decision here.
- Items marked **CA APPROVAL REQUIRED** (questions 43 and 55–64) must be formally approved by the company's Chartered Accountant or tax consultant **before the GST module is built**.
- Any later change to a decision is recorded in the change log at the end, with the date and the reason.

Baseline agreed: 14 October 2026.

---

## Launch scope (version 1)

Build **only** what is in the launch column. Items in the "later" column are **deferred**: do not build them, even where an answer below describes how they should work.

| Launch version (build now) | Later updates (deferred) |
| --- | --- |
| Users, roles, shops, audit history | Loyalty points (15, 16) |
| Products, prices, barcodes | Gift cards (14) |
| Customers and suppliers | Wholesale quotations (45) |
| Buying stock and receiving goods | Weighing-scale barcodes (9), unless the first sector is grocery |
| Stock, inter-shop transfers, stock counts | Bank statement matching (53) |
| Billing counter with offline queue, returns, exchange, shift close, card/UPI payment recording | Card/UPI settlement matching (54) |
| Basic accounts | Direct e-invoice provider connection (63); launch with JSON/Excel export only |
| GST invoices and GST return data (after CA approval) | WhatsApp receipts (67, 74), label designer (73) |
| Key daily reports, Excel import | Tally, Marg and Busy imports (77) |

---

## Still OPEN (business decisions for the project owner)

| Topic | Questions |
| --- | --- |
| First retail sector to launch with (fashion, grocery, electronics, etc.) | — |
| Which shops need true offline billing | 1 / 38 |
| Number of legal companies and GST registrations at launch | 2, 4, 64 |
| Weighing-scale barcodes (depends on first sector) | 9 |
| Reloadable gift cards (depends on launch plan) | 14 |
| Card terminal and UPI providers | 44 |
| Bank statement formats | 53 |
| Old software to import from | 77 |
| Final list of launch integrations | 79 |

---

## General

**1 / 38. Offline billing.** Online-first billing counter with a **local offline queue**: if the connection drops, bills are saved on the till and sent to the server when it returns. Full offline selling (local-first) only for shops with genuinely unreliable internet, because it makes syncing, stock and offers much more complex. Which shops need it: **OPEN**.
*Note: question 1 in the blueprint wrongly says the reference system's till works offline. It does not (see question 38).*

**2. Companies.** One legal company = one company and one set of accounts. Shops are branches within it. Create a separate company only where the business is legally separate.

## Company and stores

**3.** Yes. Each shop is one record that owns its stock, tills, users and reports.

**4.** Design for **multiple GSTINs from the start**, even if only one is active initially.

**5.** Normal commercial rounding: ₹0.50 and above rounds up.

**6.** Create the next financial-year structure automatically. Only the accountant may open or lock a year.

**7–8.** No last-in-first-out valuation. No factory-style stock locations.

## Items

**9.** Weighing-scale barcodes: support them if the first sector sells grocery, produce, meat or loose goods; otherwise defer. **OPEN** until the sector is chosen.

**10.** Readable variant codes (for example `SHIRT-RED-M`), plus a separate barcode.

**11.** Block fractions for piece-based products. Allow fractions only where the unit is weight, length or volume.

**12.** Remove factory and asset product details.

**13.** Block expired batches completely. **No manager override** for food, cosmetics or medicines.

## Pricing and promotions

**14.** Reloadable gift cards: only if part of the launch plan; otherwise defer. **OPEN**.

**15.** Track loyalty points as a loyalty liability in the accounts.

**16.** On a return, reverse points earned on the returned lines **and** restore points redeemed against those lines.

**17.** Apply the best eligible offer automatically. Never block a sale because offers clash.

**18.** Skip offers that depend on sales history while offline.

**19.** Large discounts require manager approval.

## Customers

**20.** Duplicate mobile number: warn and show the existing customer. Never merge automatically.

**21.** Yes, store a GSTIN per business-customer address.

**22.** Credit only for approved customers. Hard-block above the credit limit, with a **logged** manager override.

**23.** Remove commissions and the customer portal for now.

## Suppliers

**24.** Supplier ratings: later version.

**25.** A party may be both customer and supplier, but keep separate balances. Offset balances only through an authorised accounting entry.

**26.** Remove the supplier portal.

## Purchasing

**27.** Free goods: spread the supplier's total cost across paid and free units (correct average unit cost).

**28.** Remove requests for quotation. Keep a supplier quotation number/reference field.

**29.** Received-goods checks record: who checked, date and time, result, quantities and remarks.

**30.** Rejected goods are **not** valued at zero immediately. Hold them in a rejected/quarantine location until a supplier return, credit note or approved write-off.

**31.** Allow receiving goods without a purchase order, but require a manager reason and keep an audit trail.

## Inventory

**32. Negative stock (corrected).**
- **At the billing counter:** allow the sale automatically and flag it.
- **Daily:** every negative-stock item appears on an exception report for the manager to resolve.
- **Back office** (transfers, adjustments): block negative stock.

**33–34.** Moving average cost. No batch-level valuation in version 1.

**35.** Back-dated stock entries: accountant role only, current month only, full audit history kept.

**36.** Remove advanced warehouse features. Keep a month-end stock lock.

**37.** Every inter-shop transfer creates an "in transit" record, even for nearby shops. Receipt can be confirmed immediately on arrival.

## Point of sale

**39.** Reduce stock immediately on every sale. Post summarised accounting entries at day end.

**40.** Manager PIN for sensitive actions (price overrides, large discounts, returns without receipt, voids).

**41.** Count notes and coins at shift close. Record cash in and cash out during each shift.

**42.** One exchange screen that nets the return and the new sale.

**43. CA APPROVAL REQUIRED.** GST receipt and invoice layouts are configurable and approved by the accountant. Required fields include supplier GSTIN, unique serial number, date, item and HSN, quantity, taxable value, tax rate and tax amounts; further fields apply to B2B and inter-state invoices. Source: [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html).

**44.** Payment providers: choose based on terminals the shops already use. Keep payment integration modular so providers can be replaced. Which providers: **OPEN**.

## Sales (non-POS)

**45.** Include simple quotations for wholesale customers.

**46.** Include simple home-delivery details. No pick lists or delivery trips in version 1.

**47.** Delivery charges: fixed or by order value. No weight-based charges in version 1.

**48.** Remove sales teams, commissions and targets.

**49.** Normally invoice at dispatch. Delivery-before-invoice only for customers who need an acceptance or consignment flow.

## Accounting

**50.** Never edit posted entries. Correct them with reversals, credit notes or adjustment entries.

**51.** The main accounting ledger is the single source of truth, with customer and supplier sub-ledgers derived from it. No duplicate balance records.

**52.** Remove budgets and advanced accounting. Track cost and profit by shop.

**53.** Import only the bank statement formats the business actually uses. Which banks: **OPEN**.

**54.** Yes, include card and UPI settlement matching (gross bills versus net payout plus fees).

**55. CA APPROVAL REQUIRED.** Start with a standard India-retail chart of accounts; the accountant approves it before use.

## Tax (GST) — all CA APPROVAL REQUIRED before the GST module is built

**56.** Never hard-code GST rates. Keep an effective-dated HSN tax master approved by the tax consultant. Major rate changes took effect from 22 September 2025; the applicable rate remains product/HSN-specific. Source: [GST Council release (PIB)](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555&lang=2&reg=3).

**57.** E-invoicing applies at ₹5 crore aggregate annual turnover, subject to exclusions and accountant confirmation. The turnover test is across all GSTINs under the same PAN. Source: [Official IRP e-invoice mandate](https://einvoice6.gst.gov.in/content/einvoice-mandate/).

**58. E-way bill validity (corrected).** One day for up to 200 km, plus one additional day for every further 200 km or part thereof (other than over-dimensional cargo), as amended by Notification 94/2020-Central Tax. Sources: [Official e-way bill system](https://docs.ewaybillgst.gov.in/), [Notification 94/2020 summary (TaxHeal)](https://www.taxheal.com/notification-no-94-2020-central-tax-cgst-fourteenth-amendment-rules-2020.html).

**59.** Support HSN-wise summaries in GST reporting: 4-digit HSN up to ₹5 crore aggregate annual turnover, 6-digit above. Source: [GSTN advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf).

**60.** Record every retail bill in the system, even where GST rules permit consolidating certain very small B2C invoices.

**61.** Treat true free samples separately from "buy one, get one" offers. Free samples generally need input tax credit handling; buy-one-get-one is normally a single supply at one price. The tax consultant configures the rules before go-live. Source: [CBIC Circular 92/11/2019](https://cbic-gst.gov.in/pdf/circular-cgst-92.pdf).

**62.** Defer TDS/TCS unless the business sells through e-commerce marketplaces or deals with entities that deduct GST TDS.

**63.** Use a certified e-invoice / GSP provider integration where required, with JSON/Excel export as a fallback. Not manual-only.

**64.** Each GSTIN needs separately identifiable return data and statutory reporting.

## Reports

**65.** Fixed reports plus Excel/PDF export. Self-service report builder in a later version.

**66.** Priority reports: hourly sales, best and worst sellers, stock variance and loss, stock cover, and a loyalty report if loyalty is enabled.

**67.** Daily summaries by email by default. WhatsApp only for opted-in managers and customers, after a provider is chosen.

## Users, roles and permissions

**68.** Quick cashier switching by PIN on one terminal.

**69.** Simple approval limits (value and discount ceilings with an approver role). Full workflows in a later version.

**70.** Hide cost price, margin, supplier details and stock valuation from cashiers.

**71.** Starting roles: Owner/Admin, Accountant, Store Manager, Cashier, Stock/Receiving, Viewer/Auditor.

**72.** Include a pre-go-live test-data wipe, with a deliberate confirmation step, permanently locked after go-live.

## Printing and documents

**73.** Standard label templates with basic editing. Full visual label designer in a later version.

**74.** Paper, email and WhatsApp receipts. Capture customer consent for digital messages.

**75.** Each bill uses that shop's own address and GSTIN.

**76.** Store MRP on products, print it where needed, and block selling above MRP unless a legally permitted exception applies.

## Data import and export

**77.** Start with Excel imports. Add Tally, Marg or Busy imports only after receiving real sample exports from a customer. Which systems: **OPEN**.

**78.** File upload only. No public online-sheet links.

## Integrations

**79.** Priority: payment terminal and UPI, receipt printer and cash drawer, SMS/WhatsApp, e-invoice, bank imports. Defer marketplace and online-store integration unless it is already a key sales channel. Final launch list: **OPEN**.

**80.** Automatically retry safe failed connections, using idempotency so a payment or invoice is never duplicated.

**81.** Use a small local connector at the till for USB, serial and network devices: receipt and label printers, cash drawer, customer display and weighing scale. Keep device drivers separate from ERP business logic.

---

## Change log

| Date | Question | Change | Reason |
| --- | --- | --- | --- |
| 2026-10-14 | 32 | Negative stock allowed automatically at the till (flagged and reported daily); blocked in back office | Requiring manager permission per sale would slow billing, since stock receipts are often entered late |
| 2026-10-14 | 58 | E-way bill validity set to one day per 200 km (not 100 km) | Notification 94/2020-Central Tax changed the distance from 100 km to 200 km per day |
| 2026-10-14 | 14, 15, 16, 45, 53, 54, 63, 67, 73, 74, 77 | Launch scope added; these features deferred to later updates | Version 1 was too large; deferring them gets a usable product to shops sooner |
| 2026-10-16 | Plan 11 | Owner approved `docs/plans/11-shop-extras.md` part 1: fixes A1–A10; Excel import of styles and variants; style changes copied to variants; offers "any N for a set price", "buy N, cheapest free" and "buy X, get Y free"; simple home delivery with a fixed or value-based charge (46, 47); salesperson on bills from a simple sales-staff list with no login; size × colour grid when buying; sales and stock by style, size and colour; seasons; markdown tool; simple expense entry with cash and bank books; customer purchase history; birthdays and anniversaries | Coverage check of 16 October 2026: needed by clothing and fancy stores, the first target sector |
| 2026-10-16 | 48 | Salesperson recorded on bills and lines, with a sales-by-salesperson report. Commissions, teams and targets stay removed | Clothing and footwear shops pay floor staff on what they sell |
| 2026-10-16 | — | Part 2 (supplier consignment, Tally export, alterations, customer orders with advance) after part 1; GST module 8 last | Owner's order of work |
| 2026-10-16 | Plan 11 part 2 | Owner approved `docs/plans/11-shop-extras-part2.md`: customer orders with an advance, collected on a till bill that uses the advance, ordered goods set aside once ready; alteration jobs with the charge paid with the bill or on collection; supplier sale-or-return held as our stock with a separate consignment balance owed, settled by statement into a supplier bill; Tally export for TallyPrime with a ledger-name map | Clothing and fancy stores take orders and do alterations; many buy on sale-or-return; outside accountants use Tally |
