# Plan: Module 7, Accounting (basic accounts)

Status: **approved by the project owner on 15 October 2026** with these answers to section 11:
1. The standard chart is built now and usable for testing; going live needs the CA's approval, recorded by the Owner.
2. Credit sales at the till are added now (section 1a).
3. A cancellation carries the same date as the original document.
4. Year-end closing is built now, in a simple form.
5. Cash in / out during a shift moves money between the till drawer and the store's cash in hand.

Sources: `docs/blueprint/11-accounting.md`, `12-accounting-effects-map.md`, the accounting parts of `05-customers.md` and `06-suppliers.md`, `docs/decisions.md` questions 2, 5, 6, 22, 25, 35, 36, 39, 50–55, 62, the launch scope row "Basic accounts", CLAUDE.md rules 1–15.

## 1. What this module gives the shop

1. **Chart of accounts.** A ready-made India-retail chart (decision 55) arranged as a tree in five families: assets, liabilities, capital, income and expenses. The accountant can add, rename, switch off and lock accounts. The chart is a **proposal until the Chartered Accountant approves it**, like the GST rates in module 6: everything works for testing, and going live needs the approval (question 1).
2. **Automatic posting from everything already built.** Every earlier module already writes, on each line, *which kind of account* its money belongs to (stock, goods received not billed, supplier balance, input GST, cash in till, card settlement and so on). This module turns those labels into real double-entry ledger lines:
   - stock movements, goods receipts and freight added to stock post as they happen;
   - supplier bills post when they are posted;
   - **till bills post once per shift, when the shift closes** (decision 39). Stock already leaves at each sale.
3. **Payments:**
   - **money received** from a customer;
   - **money paid** to a supplier, settling one or more bills oldest first or by hand;
   - **transfers** between the shop's own accounts (cash to bank, card or UPI payout to bank, bank to bank).
   - Small deductions (bank charges, card commission, a few rupees short) go to an expense account.
   - Anything paid or received beyond the bills stays as an **advance**, used against later bills.
4. **Journals** for everything else:
   - petty-cash expenses, rent and salaries, the owner's drawings;
   - corrections and write-offs;
   - credit or debit notes without goods;
   - opening balances.
5. **Bank and cash accounts:** the shop's bank accounts (bank, account number, IFSC) linked to ledger accounts. Each store has its own **cash in till** and **cash in hand** accounts.
6. **Going live (opening balances):**
   - an opening journal for every balance;
   - one opening bill per unpaid customer or supplier bill, so ageing works from day one;
   - opening stock, which already exists in module 4.
   - A check shows the temporary opening account must end at zero.
7. **Protecting the books:**
   - posted entries are never edited (decision 50); a mistake is cancelled with equal and opposite entries;
   - a **books locked up to** date that only the Accountant can post before;
   - **year-end closing** (question 4).
8. **Reports:**
   - general ledger, day book, trial balance;
   - profit and loss by store and month, balance sheet;
   - customer and supplier statements with ageing (30/60/90/120 days);
   - stock against accounts;
   - opening check and book health check.
   - All can be downloaded for Excel.
9. **Profit by shop** (decision 52): every income and expense line carries its store, so profit and loss can be run for one store or all.

## 1a. Credit sales at the till (answer 2, decision 22)

- A new payment method kind, **On account**, which can be ticked for a till like cash or card.
- It can only be used:
  - with a named customer (not walk-in) who is **approved for credit**: status active and a credit limit above zero (module 3: 0 = no credit);
  - **online**, because the balance must be checked on the server. Offline the till refuses it with a plain message.
- **Hard block:** the bill is refused if the customer's balance plus this bill would go over their credit limit, or if their overdue amount is above their overdue limit. A store manager's PIN can override; the override is logged with who, when and how much (approval action `credit_over_limit`).
- Each credit bill becomes an unpaid bill for that customer, with a due date from the customer's payment terms. Their balance and ageing show it, and a receipt settles it.
- A return of a credit bill can refund **on account**, which reduces what the customer owes against that bill.
- In the shift entry, credit bills debit the customer's balance (named customer) instead of cash.

## 2. Not built now (launch scope and decisions)

| Left out | Why |
| --- | --- |
| Bank statement import and matching, matching rules | Deferred (launch scope, decision 53) |
| Card/UPI settlement matching (bills against payouts) | Deferred (decision 54). The payout itself can be recorded as a transfer with a commission deduction |
| Budgets, several sets of books, deferred income, revaluation | Removed (decision 52) |
| Foreign currency | Not needed; everything is in rupees |
| TDS and TCS | Deferred (decision 62) |
| Loyalty and gift-voucher accounts | Deferred with loyalty and gift cards (decisions 14, 15) |
| Automatic payment matching on a schedule | Matching is done by hand on the payment screen |
| Cash flow statement | Built with the reports module (module 9) |
| Sales invoices outside the till (wholesale) | Not in the build order yet; the accounts are ready for them |

## 3. The ledger (how every posting works)

```
Document posted (supplier bill, stock movement, shift close, payment, journal)
  → the document lists its lines: account kind or account, store, customer/supplier, debit or credit
  → each account kind is turned into an account (company default, or the store's own account for cash)
  → checks:
      - the account is a bottom-level account in use, not locked (unless Accountant);
      - customer/supplier balance lines name the party;
      - income and expense lines name a store;
      - the date is in an open financial year;
      - the date is after the books-locked date (unless Accountant) and after the last year-end closing.
  → lines with the same account, store and party are combined
  → debits must equal credits; a difference of up to 50 paise on bills (5 paise on journals and payments) goes to Rounding; more is refused
  → saved in the SAME database transaction as the document (rule 5)
```

- **Never edited, never deleted.** The database refuses updates and deletes on ledger lines.
- **Cancelling** writes equal and opposite lines. These are dated the same day as the original, to match how stock cancellations already work (question 3).
- **Stock re-costing.** A late landed cost or a back-dated entry changes the stock value of later movements. Earlier ledger lines are never rewritten: the system posts **only the difference** as a new correction entry, so the stock account always equals the stock value. Each stock movement remembers how much has been posted for it.
- **Customer and supplier balances come from the ledger** (decision 51). Which payment settled which bill is kept as a separate list of links, so linking or unlinking never rewrites the ledger:
  - what is still owed on a bill = bill amount − linked payments and credit notes;
  - a party's balance = their ledger balance.
  - The book health check confirms the two agree.

## 4. How each earlier document posts (from the accounting effects map)

| Document | Debit | Credit | When |
| --- | --- | --- | --- |
| Goods receipt (module 5) | Stock (receiving store) | Goods received not billed; freight added to stock → Freight inward | On posting |
| Freight and charges added later (module 5) | Stock (each line's share) | Freight inward | On posting |
| Supplier bill against receipts | Goods received not billed; input CGST/SGST/IGST; price difference; rounding | Supplier balance (named supplier) | On posting |
| Supplier bill for expenses/services | The expense account; input GST | Supplier balance | On posting |
| Return to supplier / debit note | Supplier balance | Stock or goods received not billed; input GST reversed | On posting |
| Stock in: found, free goods, other | Stock | Stock adjustment | On posting |
| Stock out: damage, expiry, theft | Stock write-off | Stock | On posting |
| Stock out: samples, shop use | Samples / shop-use expense | Stock | On posting |
| Opening stock count | Stock | Temporary opening | On posting |
| Stock count difference | Stock or stock adjustment | Stock adjustment or stock | On posting |
| Transfer sent / received | Goods in transit, then the receiving store's stock | The sending store's stock, then goods in transit | On sending and on receiving |
| **Till shift closed** | Cash in till (store); card settlement; UPI settlement; cost of goods sold | Sales; output CGST/SGST/IGST; rounding; stock | When the shift closes: one entry per shift |
| Change given | (reduces the cash in till debit) | | Inside the shift entry |
| Cash short or over at closing | Cash short/over (short) or cash in till (over) | Cash in till (short) or cash short/over (over) | Inside the shift entry |
| Cash in / out during a shift | Cash in till ↔ cash in hand of the same store (drawer to safe) | | Inside the shift entry (question 5) |
| Starting float and counted cash | Cash in till (float) / cash in hand (counted cash) | Cash in hand (float) / cash in till (counted cash) | Inside the shift entry: the drawer's account is zero after every shift |
| Till bill cancelled after its shift closed | Opposite of its share, in the shift where it is cancelled | | When cancelled |
| Receipt from customer | Bank or cash | Customer balance (per bill, or as an advance) | On posting |
| Payment to supplier | Supplier balance (per bill, or as an advance) | Bank or cash; deductions to their accounts | On posting |
| Transfer (cash to bank, card payout) | The receiving account; commission expense | The sending account | On posting |

**Already in the database:** test documents made before this module (for example the bills from this morning's check) are posted once by a catch-up step that runs with the migration. After go-live the test-data wipe (decision 72, built later) clears them anyway.

**Input GST** is posted as claimable, exactly as written on the supplier's bill. Which tax can be claimed is a GST-module question for the CA (decisions 56–64).

## 5. Data model (Prisma, all with created/updated by and at)

| Table | What it holds |
| --- | --- |
| `Account` | Company, parent, number (unique in company), name, folder or bottom-level, family (asset, liability, equity, income, expense; inherited from the folder), kind (cash, bank, receivable, payable, stock, transit, grni, cogs, tax, rounding, temporary opening, income, expense, other), store (for per-store cash accounts), must-be debit/credit, locked, active, system key for the standard accounts |
| `AccountDefault` | For each account kind used by earlier modules (stock, goods received not billed, supplier payable, gst input/output per head, card settlement, sales, COGS…): the company's account. Cash in till and cash in hand are separate accounts per store; other per-store overrides are left for later |
| `LedgerEntry` | One posting: company, date, financial year, document type and id, number, store, opening flag, cancels (the entry it reverses), remark. Never updated |
| `LedgerLine` | Entry, account, store (cost centre), customer or supplier, debit, credit, the bill it is against (if any), remark. Never updated or deleted (database trigger) |
| `Settlement` | A link: which payment, journal or credit note settles how much of which bill, for which party; undone flag. Undone links stay for the history |
| `Journal` + `JournalLine` | Number, kind (general, cash, bank, contra, credit/debit note, write-off, opening), date, reference and date, status (draft, posted, cancelled), lines |
| `Payment` + `PaymentDeduction` + settlements | Number, kind (receipt, payment, transfer), date, party, from and to accounts, amount, method, reference and date, cleared on, status, the bills it settles, deductions |
| `OpeningBill` | Party, original number, date, due date, amount (posted against the temporary opening account) |
| `BankAccount` | Bank, account number (shown masked), IFSC, branch, ledger account, default |
| `YearEndClosing` | Financial year, closing account (retained earnings), entry, status |
| `AccountingSettings` | Chart approved by / on, rounding tolerances, ageing bands |
| Changes to earlier tables | `StockLedgerEntry.postedValue` (for re-costing differences); `Shift.ledgerEntryId`; `SupplierBill`, `GoodsReceipt` and stock documents get their ledger entry link; `Company.lockDate` becomes "books locked up to" |

Numbers: `JV-2026-27-00001` (journals), `RCT-…` (receipts), `PAY-…` (payments), `TRF-…` (transfers), from the existing number series.

## 6. Screens (Accounts area, indigo like Parties)

1. **Chart of accounts:** a tree with balances; add, rename, move, lock, switch off; the approval banner until the CA approves.
2. **Default accounts:** which account each kind posts to, per company and per store.
3. **Bank accounts.**
4. **Journals:** a list, and a journal form that shows total debits, credits and the difference, with a "balance against…" button. Post and cancel.
5. **Receipts and payments:** choose the party; their unpaid bills are listed with amounts owed; settle oldest first or by hand; deductions; advance shown. Post, cancel, and "link advances to bills" for an existing payment.
6. **Transfers:** cash to bank and card/UPI payouts, with a commission field.
7. **Opening balances:** the opening journal, opening bills, and the opening check (temporary opening = 0).
8. **Reports:** general ledger, day book, trial balance, profit and loss (by store and month), balance sheet, customer and supplier statements and ageing, stock against accounts, book health check.
9. **Closing:** the books-locked date, year-end closing and cancelling a closing.
10. **Links from other screens:** each posted document shows "View ledger entry". Customer and supplier pages show the balance and the statement.

## 7. API endpoints (all check permission and store on the backend)

- `GET/POST/PATCH /accounts`, `/accounts/:id/lock`, `POST /accounts/approve-chart` (Owner records the CA's approval)
- `GET/PUT /accounting/defaults`, `GET/POST/PATCH /bank-accounts`
- `GET/POST/PATCH /journals`, `POST /journals/:id/post`, `POST /journals/:id/cancel`
- `GET/POST/PATCH /payments`, `/payments/:id/post`, `/payments/:id/cancel`, `GET /parties/:type/:id/open-items`, `POST /settlements`, `POST /settlements/:id/undo`
- `GET/POST /opening-bills`, `GET /accounting/opening-check`
- `GET /ledger/entries?documentType=…&documentId=…`, `GET /reports/general-ledger`, `/reports/cash-book`, `/reports/day-book`, `/reports/trial-balance`, `/reports/profit-and-loss`, `/reports/balance-sheet`, `/reports/party-statement/:type/:id`, `/reports/ageing`, `/reports/stock-vs-accounts`, `/reports/book-health`
- `PATCH /accounting/lock-date`, `GET/POST /year-end-closings`, `POST /year-end-closings/:id/cancel`

## 8. Permissions (new keys and who gets them)

| Key | Owner | Accountant | Store manager | Cashier | Stock | Auditor |
| --- | --- | --- | --- | --- | --- | --- |
| `accounts.view` (chart, ledger, statements) | ✓ | ✓ | own store's reports | – | – | ✓ |
| `accounts.manage` (chart, defaults, bank accounts) | ✓ | ✓ | – | – | – | – |
| `journals.post` / `payments.post` | ✓ | ✓ | – | – | – | – |
| `cash.deposit` (cash to bank, petty-cash journal for own store) | ✓ | ✓ | ✓ | – | – | – |
| `books.lock` (locked date, year-end closing, post before the lock) | – | ✓ | – | – | – | – |
| `chart.approve` (record the CA's approval) | ✓ | – | – | – | – | – |

As in every module, the Owner / Admin role holds every permission. A store manager's ledger and statements show only their own stores.

## 9. Acceptance scenarios (added to `docs/acceptance-tests.md` "Module 7" before building)

1. **Sale at the till:** a shift with a ₹186 cash sale, a ₹62 return and a ₹5 sale closes. One ledger entry is created and it balances:
   - Dr cash in till ₹129;
   - Dr cost of goods sold ₹104;
   - Cr sales ₹122.85;
   - Cr output CGST ₹3.07 and SGST ₹3.08;
   - Cr stock ₹104.
   Cash short ₹9 posts to cash short/over.
2. **Card/UPI:** a ₹899 bill paid by card and UPI goes to the card and UPI settlement accounts, not cash. A card payout of ₹500 less ₹9 commission moves ₹491 to the bank and ₹9 to commission expense.
3. **Purchase receipt and bill:**
   - the receipt debits stock and credits goods received not billed;
   - the bill clears goods received not billed to zero and credits the supplier with GST;
   - a price difference goes to the difference account.
4. **Supplier payment:** paying two bills with one payment, oldest first, leaves ₹0 owed on both. Overpaying leaves an advance that the next bill uses. A supplier on hold cannot be paid.
5. **Stock movements:**
   - a transfer between shops goes through goods in transit;
   - damage goes to write-off;
   - a stock count difference goes to stock adjustment.
   - Stock against accounts shows no difference for every store.
6. **Re-costing:** freight added after a sale posts only the difference to stock and cost of goods sold. Earlier entries are unchanged and stock against accounts is still zero.
7. **Cancelling:** cancelling a posted supplier bill writes equal and opposite lines on the same date. The trial balance is as if it never happened, and both entries stay visible.
8. **Locking:** after the books are locked to 30 September, a cashier's or store manager's posting dated 30 September is refused; the Accountant's is accepted.
9. **Journals:** an unbalanced journal is refused. A supplier line without a supplier is refused. A line against a bill for more than it owes is refused.
10. **Opening balances:** an opening journal, two opening customer bills and opening stock leave the temporary opening account at zero; the customers' ageing shows the original dates.
11. **Year-end closing:** income and expense accounts start the new year at zero; retained earnings moved by the year's profit, per store.
12. **Book health:** after all the above, total debits equal total credits, and every party's ledger balance equals their unpaid bills minus advances.

## 9c. Decisions made while building (for the project owner to confirm)

1. **Automatic postings with no store** use the company's first store as the cost centre. An example is a supplier bill for a service with no store chosen. Hand-made journals must always name a store for income and expenses.
2. **Overdue limit:** an overdue limit of ₹0 means any overdue amount needs a manager's PIN before selling more on account. A limit above zero allows that much to be overdue.
3. **Deductions:**
   - On a receipt, a deduction (bank charges, discount allowed) settles more of the customer's bills than the cash received.
   - On a payment, a deduction (a discount the supplier gave) settles more of the supplier's bills than the cash paid.
   - On a transfer, a deduction (card commission) comes out of the amount that arrives.
   - Bank charges on top of a payment are recorded as a separate journal.
4. **Till shift posting:** one entry per business date of its bills (usually one), plus one "drawer" entry. The drawer entry moves:
   - the float from cash in hand to the till;
   - cash in/out;
   - the counted cash back to cash in hand;
   - the shortage or excess to cash short or over.
   - Card and UPI counted differences are shown on the closing but not posted; the bills decide those amounts.
5. **Locked books and the till:** a shift whose date falls in locked books posts on the first open day, so a till is never stopped. Other documents dated in locked books are refused unless the user is the Accountant.
6. **Settling oldest first:** bills due the same day are settled in bill-number order.
7. **Stock value corrections** (re-costing) after the books are locked post on the first open day. They are filed under the stock document that changed, so cancelling that document later reverses everything it posted.
8. **Earlier documents:** test documents made before the books existed are posted once, automatically, when the server starts. These are receipts, stock movements, supplier bills and closed till shifts.
9. **Payment method "On account"** is created for every company but must be ticked for each till that may sell on credit.

## 10. Order of building

1. Shared calculations (posting balance and rounding, ageing bands, statement balances) with tests.
2. Chart of accounts, defaults, the ledger service (checks, combining, rounding, triggers) with unit tests.
3. Connect modules 4, 5 and 6 to the ledger in the same transaction, including the re-costing difference and the catch-up step.
4. Journals, payments, settlements, opening balances.
5. Locking, year-end closing.
6. Reports, then screens.
7. Acceptance tests 7.1–7.12, then a hands-on check in the browser.

## 11. Questions for the project owner

1. **Chart of accounts approval (decision 55):** build the standard chart now, usable for testing, with going live needing the CA's approval (recorded by the Owner), like the GST rates? *Recommended.*
2. **Credit sales at the till (decision 22):** module 6 left "on account" sales for this module. Add them now, for approved customers with a hard block above the credit limit and a logged manager override? Or later with wholesale sales? *Recommended: now, because otherwise customer balances only come from opening bills.*
3. **Which month a cancellation shows in:** the same date as the original (stock and accounts stay in step; cancelling something in a locked month needs the Accountant), or today's date? *Recommended: same date, matching how stock already works.*
4. **Year-end closing:** build it now (needed after 31 March 2027), or with the reports module? *Recommended: now, in a simple form.*
5. **Cash in / out during a shift:** treat it as moving cash between the till drawer and the store's cash in hand (safe or petty cash), with expenses paid from cash in hand recorded by journal? *Recommended.*
