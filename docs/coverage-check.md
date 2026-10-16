# Coverage check — 16 October 2026

Every blueprint chapter was checked against what is actually built, and the product was compared with what
clothing, footwear and fancy stores in India usually expect. Read-only check of our own files only.

**Overall:** everything in the launch scope is built except the GST module (8), which waits for the CA.
The gaps below are of four kinds, from most to least urgent.

---

## A. Built, but not working as it should (fix before go-live)

These look finished on screen but are not. Checked in the code, not just reported.

| # | Problem | Why it matters |
| --- | --- | --- |
| A1 | An item's basic unit, batch/serial tracking and stock/service flag can still be changed after the item has stock. | Changing PCS to BOX would silently make every past quantity wrong. |
| A2 | Three catalogue settings ("block selling below cost", "save typed prices", "allow price change on bill") are on the screen but nothing uses them. | An owner who turns on "block selling below cost" thinks they are protected and is not. |
| A3 | Supplier bills only ever show draft, unpaid or cancelled. A bill paid in Accounts still shows unpaid or overdue. | Staff may chase or pay a supplier twice. |
| A4 | The general ledger screen stops at 5,000 lines (day book at 2,000 entries) without saying so, and works out balances from the lines shown. | A busy account's balance on screen can be wrong with no warning. |
| A5 | A stock count over about 2,000 items cannot be finalised (60-second limit; found by the speed test). Opening stock for a full shop is imported as one count. | Loading opening stock for a 20,000-item shop at go-live would fail. |
| A6 | A blocked customer can still be billed for cash at the till; only "on account" is refused. | Against the blueprint's block rule. |
| A7 | Credit limits from the customer group, and the group's "skip credit check", are ignored at the till. | Changing a group's limit has no effect. |
| A8 | Supplier flags "bill without order / without receipt allowed" are stored but nothing checks them. | They look active but do nothing. |
| A9 | Return without a bill: the server allows it with a manager PIN, but the till sends staff to a back-office screen that does not exist. | Staff cannot do it at all. |
| A10 | Year-end closing does not check that stock value equals the books or that the last month is locked. | Wrong opening figures for the new year. |

## B. In the blueprint, not deferred, but not built (owner decides: launch or later)

**Most relevant to clothing and fancy stores**
- Importing sizes and colours (variants) from Excel. Today they are created on the item page only, so a clothing shop cannot load its catalogue from Excel at go-live.
- Changes to a parent style (MRP, HSN, brand) are not copied to its sizes and colours. Each variant must be fixed one by one.
- Offers: a different free item ("buy shirt, get belt"), and "any 3 from this group" counted across lines.
- Park and recall: parked bills stay on one till computer only; there is no "old parked bills" report.
- Reopening a wrongly closed shift.
- E-receipt by email.

**Customer orders and delivery (decisions 46, 47 and 49 describe them, but nothing is built and no plan exists)**
- Customer orders with advances, home-delivery address, delivery charges, invoice at dispatch.

**Reports**
- Customer reports: credit position, inactive and never-bought customers, ledger summary.
- Expected stock (on hand + on order) and shortages; serial number report; price comparison.
- Profit and loss compared with last year.
- Scheduled emails for any report (only the owner's daily summary exists).

**Smaller**
- Count that corrects value only; freight added to a transfer between shops; debit note with no original bill that moves stock.
- Per-till screen switches (hide groups, auto-add); supplier's own item code and delivery time; scanning a serial number to find the item.
- Bulk customer statements by email; "billing this year" on customer and supplier pages; locking periods per document kind.

## C. Not in the blueprint, but clothing and fancy stores usually expect it (owner and manager decide)

| # | Feature | Why shops want it |
| --- | --- | --- |
| C1 | Salesperson on each bill or line, with a salesperson sales report | Clothing and footwear staff are paid incentives on what they sell; the cashier is often someone else. (Decision 48 deferred commissions, not salesperson tagging.) |
| C2 | Size × colour grid when buying and receiving | One style in 5 sizes × 4 colours is 20 lines; a grid is far faster. |
| C3 | Sales and stock by size, colour and style | Shows which sizes sell out, for the next season's buying. |
| C4 | Season or collection tag on items | Season sell-through, and marking down the old season as a group. |
| C5 | Bulk markdown / clearance tool | End-of-season sales are routine. |
| C6 | Supplier consignment (sale or return) | Common in fancy and some garment buying. |
| C7 | Combo pricing ("any 3 for ₹999") | Very popular in fancy and apparel stores. |
| C8 | Simple "add expense" form and a cash book screen | Rent, salary and electricity need a journal today, which is hard for an owner without an accountant. |
| C9 | Purchase history tab on the customer page | Today only through a report filter. |
| C10 | Birthday and anniversary on customers | Greetings and offers. |
| C11 | Tally export | Many shops' outside accountants use Tally. |
| C12 | Alteration / tailoring job tracking | Common in clothing stores. |

## D. Waiting or deferred (no action now)

- **Waiting for the CA (module 8, GST):** GST invoices and credit/debit notes for business customers, e-invoice and e-way bill data, GST registers and HSN summary, return figures per GSTIN, reverse charge, set-off journal. Already prepared: GST registrations per store, GSTIN on customers and suppliers, HSN codes, dated GST rates, CGST/SGST/IGST on every line, GST ledger accounts.
- **Deferred by decision:** loyalty points, gift cards, quotations, WhatsApp and SMS, customer display, weighing-scale barcodes, bank statement matching, card/UPI settlement matching, Tally/Marg/Busy import, label designer, budgets, TDS/TCS, supplier ratings.
