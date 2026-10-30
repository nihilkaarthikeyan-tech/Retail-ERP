# Plan 11 — Fixes and extras for clothing and fancy stores

**Status:** part 1 approved by the owner on 16 October 2026 (salesperson from a simple staff list; all three new offer types). Part 2 to be confirmed later.
**Why:** the coverage check of 16 October 2026 (`docs/coverage-check.md`) found defects in built modules (part A),
blueprint features never built (part B), and features clothing and fancy stores expect that are not in the blueprint (part C).
The owner asked on 16 October 2026 to build them now and leave GST (module 8) for last.

Items marked **(new rule)** are not in the blueprint; once approved they are recorded in `docs/decisions.md`
as owner decisions. Each rule below is our own design.

---

## Part A — Defects in built modules (no new business rules; fixing what the blueprint already says)

| # | Fix |
| --- | --- |
| A1 | Basic unit, batch tracking, serial tracking and stock/service flag cannot be changed once the item has any stock movement. |
| A2 | The three catalogue settings start working. **Block selling below cost:** a till sale line's net price per basic unit may not be below the last purchase price or the current cost (returns and free lines exempt; a manager PIN can override; offline bills are accepted and flagged). **Allow price change on bill:** a company-wide master switch; when off, no till may change prices whatever its own switch says. **Save typed prices:** when a typed price is used for an item with no price in the list, it is saved as the item's price from that day. |
| A3 | Supplier bills show **paid**, **part paid** or **unpaid** from what is still open in the accounts; "overdue" only while something is still owed; a fully paid bill cannot be put on hold. |
| A4 | General ledger and day book: page through all lines instead of stopping silently; opening, running and closing balances always come from all lines, not only the lines shown. |
| A5 | Finalising a count works for any size: the count is processed in bulk instead of line by line, so a 20,000-item opening count finishes well inside the time limit. |
| A6 | A blocked customer is refused at the till (online). Offline bills for a blocked customer are accepted and flagged for checking. A switched-off customer is refused everywhere. |
| A7 | Credit limit and overdue limit fall back to the customer group when the customer has none; the group's "skip credit check" is honoured. |
| A8 | New purchase settings "a bill needs a purchase order" and "a bill needs a goods receipt" (both off by default, so nothing changes today); the supplier's exceptions let that supplier skip them. |
| A9 | Return without the original bill, at the till: online only, manager PIN, refund only by refund-allowed methods, stock back at current cost (blueprint 09, decision 40). The till's message pointing to a back-office screen is removed. |
| A10 | Year-end closing refuses when stock value and stock accounts differ, or the year's last month is not locked; the Accountant sees which check failed. |

## Part B — In the blueprint, not built yet

| # | Feature | How it works |
| --- | --- | --- |
| B1 | Import sizes and colours from Excel | New import kind **Styles and variants**: one row per variant — style name, group, brand, HSN, unit, MRP, then attribute values (e.g. Size = M, Colour = Red), barcode and selling price. Rows with the same style are grouped; a missing style is created; variant codes are made as today (`SHIRT-RED-M`). Same preview, failed-rows file and background run as other imports. |
| B2 | Style changes reach its variants | Editing a style's MRP, HSN, brand, group, maximum discount or description offers "also change all its sizes and colours" (ticked by default). Codes, barcodes and prices are never copied. Each variant change is in the history. |
| B3 | More offers | **Buy X, get Y free** (a different free item). **Mix and match:** any N items from the listed items, groups or brands, counted across the bill's lines, for a set price (*any 3 for ₹999*, also covers C7) or with the cheapest one free (*buy 2 get the cheapest free*). The till applies the best offer as today; the offer and its saving are shown on the bill. |
| B4 | Home delivery on a till bill (decisions 46, 47) | Optional delivery details on a bill: address, phone, delivery date, and a delivery charge (fixed, or by bill value, from the store's settings) added as a service line. A "deliveries" list per store shows pending and delivered. No delivery trips or pick lists (decision 46). |

## Part C — Not in the blueprint (new rules)

| # | Feature | How it works |
| --- | --- | --- |
| C1 | **Salesperson on bills (new rule)** | A simple **sales staff** list per store (name, short code, active); staff need no login. At the till the cashier picks or scans the salesperson for the bill, and can change it per line. Returns stay with the original line's salesperson. Report: sales by salesperson (net of returns), by day or month. No commission calculation (decision 48 still applies to commissions, teams and targets). |
| C2 | **Size × colour grid when buying (new rule)** | On purchase orders, goods receipts and supplier bills: pick a style, type quantities in a grid (sizes across, colours down); one line per variant is added. Screen only; the documents themselves do not change. |
| C3 | **Sales and stock by size, colour and style (new rule)** | Item-wise sales and stock balance can be grouped by style, by size or by colour; a style's stock shows as a size × colour grid per shop. |
| C4 | **Season or collection (new rule)** | A season list (code, name, from and to dates); an item or style can carry one season. Reports filter by season; a season sell-through report shows bought, sold, in stock and percentage sold. |
| C5 | **Markdown tool (new rule)** | Choose items by season, group, brand or a list; set a new price as a percentage off or a fixed price, from a start date (and optional end date). New dated prices are added to the selling price list (never above MRP); the old price stays in the history. Price labels can be printed showing the old and new price. Needs the `prices.manage` right; logged. |
| C7 | **Combo pricing (new rule)** | Covered by mix and match in B3. |
| C8 | **Simple expense entry and cash book (new rule)** | "Add expense": date, store, expense head (from the expense accounts), amount, paid from (the store's cash in hand or a bank account), remark. Behind it, a normal posted payment entry; cancelling reverses it. Cash book and bank book screens: day by day, opening, money in, money out, closing. |
| C9 | **Purchase history on the customer page (new rule)** | A "Purchases" tab: bills and returns with date, store, amount and items; totals this year and last year. |
| C10 | **Birthday and anniversary (new rule)** | Optional fields on the customer (also at the till's quick add); a "birthdays and anniversaries this week" list. Promotion consent already exists. |

## Later (part 2, after part 1 is done; plan to be confirmed then)

- **C6 Supplier consignment (sale or return):** stock that belongs to the supplier until sold; periodic statement of sold quantities becomes the supplier bill; unsold goods go back. Needs its own accounting rules.
- **C11 Tally export:** daily sales, purchases, payments and journals in Tally's import format, with a ledger-name mapping.
- **C12 Alterations and tailoring jobs:** job slip, promised date, charge, status, delivered.
- **Customer orders with an advance:** an order and advance taken today, billed when collected.
- Remaining small part-B items: reopening a closed shift, e-receipt by email, per-till screen switches, customer and stock reports listed in `docs/coverage-check.md`.
- **Module 8, GST: last**, after the CA approves questions 43 and 55–64.

---

## Data model (part 1)

| Change | Fields |
| --- | --- |
| `SalesStaff` (new) | `storeId`, `code` (unique per store), `name`, `active`, created/updated by and when |
| `PosBill`, `PosBillLine` | `salesStaffId` (nullable) |
| `Season` (new) | `code` (unique), `name`, `startsOn`, `endsOn`, `active` |
| `Item` | `seasonId` (nullable) |
| `Customer` | `birthday`, `anniversary` (day and month, optional year) |
| `Offer` | new kinds `buy_get` (with `freeItemId`, `freeQuantity`) and `mix_match` (with `setQuantity`, `setPrice` or `cheapestFree`) |
| `PosBill` delivery | `PosDelivery` (new): `billId`, `address`, `phone`, `deliverOn`, `status` (pending / delivered / cancelled), `deliveredAt`; store settings `deliveryChargeFixed`, `deliveryChargeFreeAbove` |
| `PurchaseSettings` | `billNeedsOrder`, `billNeedsReceipt` (both default off) |
| `Markdown` (new) | who, when, rule (percent or price), dates, item count; its prices link back to it |

All changes through Prisma migrations, with created/updated fields and audit history, as for every module.

## Main screens

Till: salesperson picker, return without bill (manager PIN), delivery details, new offers shown on the bill ·
Items: style "apply to variants", season field · Seasons · Sales staff · Markdown tool · Size × colour grid on purchase documents ·
Reports: by salesperson, by style/size/colour, season sell-through · Customer: purchases tab, birthdays list ·
Accounts: add expense, cash book, bank book · Imports: styles and variants · Deliveries list.

## API endpoints (main)

`/sales-staff`, `/seasons`, `/markdowns` (preview, apply), `/expenses`, `/reports/cash-book`, `/pos/reports/by-salesperson`,
`/reports/season-sell-through`, `/customers/:id/purchases`, `/customers/birthdays`, `/pos/deliveries`,
`/items/:id/apply-to-variants`, import kind `styles_variants`, new offer kinds on `/pos/offers`.

## Tests

Each fix and feature gets automated tests, and the money and stock ones get acceptance scenarios in
`docs/acceptance-tests.md` (section "Module 11") before building: below-cost block, offers (buy X get Y, any 3 for ₹999,
cheapest free, with returns), delivery charge, markdown prices, expense entry posting and cancelling, salesperson
credit on returns, count finalise of 20,000 lines, supplier bill paid status.
