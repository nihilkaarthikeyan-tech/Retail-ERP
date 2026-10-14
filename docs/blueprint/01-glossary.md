# Glossary

Business terms as used throughout this blueprint, in plain words.

## General

- **Master record** — a long-lived record that describes something, such as an item, a customer or a store. Master records are in use or switched off. They are never finalised or cancelled.
- **Transaction** — a record of something that happened, such as a sale, goods arriving or a payment. A transaction starts as a draft, is finalised, and may later be cancelled. It writes ledger entries when finalised.
- **Finalise** — to confirm a transaction. After that it cannot be edited, and its effects on stock and accounts are written.
- **Cancel** — to reverse a finalised transaction. The record stays visible, and equal and opposite ledger entries are written.
- **Corrected copy** — a new version of a cancelled transaction, numbered as a revision of the original.
- **Ledger entry** — one line in the stock ledger or the accounts ledger. Balances are always worked out by adding up ledger entries, never stored on their own.
- **Posting date** — the business date a transaction counts from, which may differ from the day it was typed in.
- **Financial year** — the twelve-month accounting period. In India, 1 April to 31 March.
- **Company** — the legal business that owns the books. One company has one chart of accounts, one main currency and one set of financial years.
- **Store or branch** — a physical shop. Many stores can belong to one company.
- **Stock location** — any place where stock is counted, also called a warehouse. A store has one or more locations, such as the sales floor and the back room.
- **Till** — a point-of-sale counter. A store may have several.
- **Shift** — the time from a cashier opening a till with opening cash to closing it with a cash count.
- **Till settings** — what a till works with: its store location, payment methods, accounts, price list and what the cashier may change.
- **Till bill** — a sale made at the till. It is either posted at once or added into a day-end summary invoice.
- **Day-end summary** — combining a shift's till bills into one sales invoice (and one credit note) per customer at closing, which is when stock and accounts are posted in that mode.
- **Opening cash** — the cash placed in the drawer at the start of a shift.
- **Bill on hold** — an unfinished bill set aside to serve another customer and picked up again later.
- **Number series** — a prefix, which may include the year, month or store code, with its own running counter, used to number one kind of document.
- **Cost centre** — a label, usually the store, put on every income and expense line so reports can be split by it.
- **Locking date** — a date up to which no accounting entries may be added or changed, except by one trusted role.
- **Automatic stock accounting** — every stock movement writes matching accounting entries at once, so the stock account always equals the stock value.

## Stock

- **Item** — anything bought, sold or stocked.
- **Variant** — a sellable version of a parent item that differs by size, colour or similar.
- **Parent item** — an item that exists only to group its variants. It is never stocked or sold itself.
- **Variant attribute** — a characteristic such as size or colour, with its allowed values and short codes, or a number range.
- **Unit** — what a quantity is counted in, such as piece, kilogram or box. An item has a stock unit and may have conversions to other units.
- **Batch** — a lot of an item received together, sharing an expiry or manufacture date.
- **Serial number** — a unique number for one physical unit.
- **Stock ledger** — the dated record of every quantity movement per item per location.
- **Stock value per unit** — the cost per unit used to value stock in hand and to work out cost of goods sold.
- **FIFO** — first in, first out. Stock is treated as sold in the order it arrived, so cost of goods sold uses the oldest purchase prices first.
- **Moving average** — every arrival recalculates one average cost for the item at that location, and everything going out uses that average.
- **Reorder level** — the quantity at which the system suggests buying more.
- **Stock movement** — a document for stock coming in, going out, moving between locations or being repacked, other than purchases and sales.
- **Stock count** — a document that records counted quantities and values and posts the difference.
- **Goods on the way** — a holding location for goods travelling between two stores in a two-step transfer.
- **Reserved stock** — stock set aside for a particular customer order that other documents cannot use.
- **Expected quantity** — in stock + on order + requested − reserved: what will be available if everything in progress happens.
- **Re-costing** — the background recalculation of later entries after a back-dated entry.
- **Stock lock** — a date up to which stock balances are frozen.
- **Fallback cost** — the cost used for stock going out when no cost is known yet, for example when stock is negative.
- **Kit** — a non-stock sellable item that turns into its stocked parts when sold.
- **Substitute item** — an item allowed to replace another when it is out of stock.
- **Stock summary** — the running totals per item per location of stock in hand, reserved, ordered, expected and value.
- **HSN code** — see Tax. Stored on the item.

## Parties

- **Customer group or supplier group** — trees used to pass down defaults (price list, payment terms, accounts, credit limits) and to filter rules and reports.
- **Area** — an optional tree of regions for customers, used by offers, loyalty and tax rules.
- **Payment terms** — one or more instalments, each a share of the bill with its own due-date rule and optional early-payment discount.
- **Credit limit** — the most a customer may owe, counting unpaid bills plus orders and deliveries not yet billed. Going beyond it needs the credit controller.
- **Overdue block** — stops new bills to a customer with bills past their due date.
- **Held party** — a customer or supplier blocked from new transactions, except by one allowed role.
- **Own-company party** — a customer or supplier record that stands for another of the owner's companies, for trade between them.

## Selling and buying

- **Price list** — a named set of prices per item, in one currency, for buying or selling.
- **Offer** — a discount, special price, mark-up or free item given when conditions are met (customer, group, item, quantity, amount, date, location).
- **Quantity scheme** — a set of quantity or amount steps, each giving its own discount or free item.
- **Coupon** — a code that unlocks one offer, with validity dates and a use limit.
- **Loyalty programme** — rules for earning points on spending, by tier, and using points as money at the till.
- **Mark-up** — a percentage or amount added to the list price before any discount.
- **Pack size** — the multiple a quantity must be bought in for a particular price to apply.
- **Customer order** — a confirmed customer order not yet delivered or invoiced.
- **Delivery** — a record of goods leaving stock for a customer.
- **Sales invoice** — the bill to a customer. It adds to what the customer owes.
- **Credit note** — a minus invoice against an original invoice, for a return or price correction.
- **Purchase order** — a confirmed order placed with a supplier.
- **Goods receipt** — a record of goods arriving from a supplier into a location.
- **Supplier bill** — the supplier's invoice. It adds to what the shop owes.
- **Debit note** — a minus supplier bill for goods returned to the supplier, or a note raising a sales invoice's price.
- **Quotation** — a priced offer with a validity date that may become a customer order.
- **Pick list and packing slip** — documents for collecting and boxing goods for a delivery.
- **Delivery trip** — a driver's planned run with stops, each linked to a delivery.
- **Delivery charge rule** — a formula (fixed, by order value or by weight) that adds a delivery charge to a document.
- **Advance** — money received or paid before the invoice, matched to it later.
- **Instalments** — the due dates and amounts an invoice or order is expected to be paid in.
- **Landed cost** — freight, duty and other charges added to the cost of goods received.
- **Internal request** — a request from a store for items, to be bought or moved from another store.
- **Goods received not billed** — the holding account for the value of goods received until the supplier's bill is recorded.
- **Charge added to stock** — a tax or charge line whose amount becomes part of the goods' cost.
- **Accepted and rejected quantity** — the split of goods received into usable stock and goods set aside for return.
- **Over-receipt and over-billing allowance** — how far, in percent, a receipt or bill may go beyond the order.

## Accounting

- **Chart of accounts** — the tree of accounts in five families: assets, liabilities, capital, income and expenses.
- **Debit and credit** — the two sides of every entry. Assets and expenses rise on the debit side; liabilities, capital and income rise on the credit side.
- **Customer balance** — money customers owe the shop (receivable). **Supplier balance** — money the shop owes suppliers (payable).
- **Journal** — a manual accounting entry not tied to a sale or purchase.
- **Payment** — a record of money received or paid, matched against bills.
- **Bank matching** — matching the bank statement lines against the payments recorded in the books.
- **Year-end closing** — moving the year's profit or loss to retained earnings and locking the year.
- **Posting rules** — the common checks that every document passes through before its ledger lines are written.
- **Rounding account** — where tiny differences from rounding are posted.
- **Temporary opening account** — the balance-sheet account that takes the other side of opening balances. It must be zero after go-live.
- **Cleared date** — the bank statement date on which a payment or journal was matched.
- **Locked period** — a date range in which chosen kinds of documents cannot be posted.
- **Unchangeable ledger** — a setting where cancellations post reversals dated today instead of marking old lines.
- **Settlement records** — the record of customer and supplier balances, bill by bill, from which amounts owed are read.

## Tax

- **GST** — Goods and Services Tax (India). **CGST and SGST** apply within a state; **IGST** applies between states.
- **HSN code** — the classification code required on invoices for goods (SAC for services).
- **Tax-inclusive price** — the shelf price already contains tax, which is worked out backwards at billing.
- **E-invoice** — an invoice registered with the government portal and given a reference number and QR code.
- **E-way bill** — a government document needed to move goods above a value limit.
- **Place of supply** — the state where a sale is treated as made. It decides same-state (CGST + SGST) or other-state (IGST).
- **Tax set** — a ready-made group of tax lines applied to a document.
- **GST rate per item** — the item's rate for each tax account, which overrides the tax set's rate.
- **Tax situation and tax-choice rule** — tags and matching rules that pick the right tax set for a party, address and item.
- **Bill of supply** — the invoice a composition dealer, or a seller of exempt goods, issues, showing no tax.
- **Composition scheme** — a simple GST option for small traders who pay a flat rate on turnover, do not collect tax and cannot claim input credit.
- **Input tax credit** — GST paid on purchases that can be set off against GST collected on sales.
- **Reverse charge** — purchases where the buyer, not the seller, pays the GST.
- **Business sale and consumer sale (B2B and B2C)** — sales to GST-registered businesses, and to consumers and unregistered buyers.
- **TDS and TCS** — income tax deducted on payments, or collected on sales, above set limits.

## Users and control

- **Role** — a named set of rights given to users.
- **Role bundle** — a set of roles given together.
- **Sensitive details** — details such as cost price or margin that need a separate right to see or change.
- **Record restriction** — a rule limiting a user to particular stores, locations, companies or other master records.
- **Approval steps** — stages and moves with roles that decide who can move a document forward.
- **Approval limit** — a value or discount ceiling above which only a named approver may finalise.
- **Change history** — the permanent log of every change to a record.
- **Print and export history** — the log of exports, prints and report downloads.
