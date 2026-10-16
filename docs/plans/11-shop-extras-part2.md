# Plan 11, part 2 — Customer orders, alterations, supplier sale-or-return, Tally export

**Status:** approved by the owner on 16 October 2026, with these answers: sale-or-return goods count as our stock with a separate "owed to supplier on consignment" balance; ordered goods are set aside once ready; the alteration charge is paid with the bill or on collection, as the cashier chooses; the Tally export targets TallyPrime.
**Why:** part 2 of `docs/plans/11-shop-extras.md`, started by the owner on 16 October 2026. GST (module 8) stays last.

Items marked **(new rule)** are not in the blueprint; once approved they are recorded in `docs/decisions.md`.
Every rule below is our own design.

---

## 1. Customer orders with an advance (blueprint 10, decision 49)

A customer orders something not in stock (a size, a colour, a gift item), pays an advance, and collects it later.

- **Order:** customer (named, not walk-in), store, items with quantity and agreed price, expected date, remarks.
  Statuses: open → ready (goods have arrived) → collected, or cancelled.
- **Advance:** taken at the till or in the back office, by any payment method. It is recorded as money received
  from that customer against the order. In the accounts the customer's balance shows a credit, as decision 22 and
  the effects map (blueprint 12) already describe for advances.
- **Collecting:** at the till the cashier opens the order. Its items come onto a normal till bill at the agreed
  prices, and the advance is used as part of the payment; the customer pays only the rest. The order is then
  "collected", and the advance is linked to the bill so nothing stays open in the accounts.
- **Cancelling:** the advance is refunded (refund-allowed methods only, manager PIN) or kept as credit for the
  customer's next purchase, as the manager chooses.
- **Stock:** an order does not move stock. Stock leaves on the till bill when the customer collects, as for any sale.
  See question 2 on setting stock aside.
- **Lists:** open orders by expected date, overdue orders, and advances held. The order slip prints with the
  advance received.
- Full sales invoices and deliveries for business customers stay with the GST module.

## 2. Alterations and tailoring jobs (new rule)

- **Job slip:** customer (walk-in allowed, with name and phone), the till bill it came from (optional), the items and
  the work on each (e.g. "shorten sleeves 2 cm"), tailor (from the sales-staff list or a name), promised date, charge.
- **Statuses:** received → with the tailor → ready → delivered (or cancelled). Each change records who and when.
- **Charge:** billed at the till as a service line, from a service item chosen in settings. See question 3 on when
  it is paid.
- **Lists:** jobs due today, overdue jobs, and ready-but-not-collected jobs. The job slip and a tag for the garment
  can be printed.
- No stock moves unless materials are sold on the bill as normal items.

## 3. Supplier sale-or-return (consignment) (new rule)

The supplier gives goods that the shop pays for only when they sell. Unsold goods go back.

- **Consignment receipt:** like a goods receipt, but marked "sale or return", into the shop's normal shelves at the
  agreed cost. The supplier is not owed anything yet.
- **Selling:** consignment goods are sold at the till like any item.
- **Settlement:** a "consignment statement" for a supplier and period lists the quantity received, sold, returned
  and still in the shop. It becomes a supplier bill for the sold quantity at the agreed cost; from then on it is
  owed and paid as usual.
- **Returning unsold goods:** a return to the supplier at the agreed cost, which reduces what is held.
- **Accounts:** see question 1.
- **Lists:** consignment stock by supplier, and sold-but-not-settled amounts.

**As built (rules for which sales are the supplier's):**

- Sale-or-return goods are our stock at the agreed rate; the receipt credits "Owed to suppliers on consignment"
  (account 2150), not "Goods received not billed", and never the supplier's own balance.
- Each sale-or-return receipt line is a batch of that supplier's goods at its agreed rate (taxable amount ÷ units).
- **Till sales of an item at a store use up that store's sale-or-return goods of the item first, oldest receipt
  first**, before any of the shop's own stock of the same item. Only accepted goods can be sold.
- A till return (or a cancelled till bill) gives back the most recently used-up units first: they count as
  sale-or-return goods again.
- A return to the supplier takes goods from its own receipt line first, then from the same supplier's newer
  receipts of the item; only goods still held can go back on sale-or-return terms.
- A statement bills every sold unit that no earlier billed statement has billed (so late till bills are not lost and
  nothing is billed twice). A new statement starts the day after the last billed one; a draft whose period overlaps
  a billed statement cannot be billed.
- Making the bill creates a finalised supplier bill (one line per receipt line, at the agreed rate, GST as on the
  receipt) that moves the amount from the consignment balance to the supplier's balance, paid as usual. A debit note
  on such a bill is refused: cancel the statement (which cancels the bill) and make it again.
- Sale-or-return receipts take no purchase order (so no "received without an order" reason) and no freight on their
  cost (freight is an expense). Goods should be sold at the store that received them: stock transfers are not
  followed.
- Check: the consignment balance from the goods (received − returned − billed, at the agreed rates) must equal
  account 2150 (`GET /purchase/consignment/check`, also on the consignment stock list).

## 4. Tally export (new rule)

For shops whose outside accountant keeps the books in Tally.

- **Export:** for a period, a file Tally can import (Tally's XML import format), containing:
  - daily sales per store, from the till shift postings;
  - supplier bills;
  - receipts, payments and transfers;
  - journals and expenses.
- **Ledger names:** a mapping screen sets which Tally ledger each of our accounts goes to (pre-filled with our
  account names). Customers and suppliers go to their own names.
- **Re-exporting** the same period gives the same vouchers with the same numbers, so the accountant can see
  whether something changed.
- GST details on the vouchers are added with the GST module.
- Every export is recorded in the history, as for other exports.

---

## Data model (outline)

| New | Main fields |
| --- | --- |
| `CustomerOrder`, `CustomerOrderLine` | customer, store, number, status, expected date; item, quantity, agreed price |
| (advance) | a customer receipt `Payment` linked to the order (`orderId`) |
| `AlterationJob`, `AlterationJobLine` | customer or name/phone, bill, tailor, promised date, status, charge; item, work description |
| `ConsignmentStatement` | supplier, period, lines (received, sold, returned, held), supplier bill made from it |
| Goods receipt | `isConsignment` flag |
| `TallyLedgerMap` | our account → Tally ledger name |

All changes go through Prisma migrations, with audit fields and history, as for every module.

## Tests

The acceptance scenarios are written in `docs/acceptance-tests.md` ("Module 11, part 2") before building: order and
advance, collection using the advance, cancellation with refund and with credit kept, alteration job flow and
charge, consignment receipt, sale, statement and bill, return of unsold goods, and a Tally export of a sample day
that balances.
