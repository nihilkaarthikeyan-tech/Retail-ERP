# Accounting effects map

## Purpose

One place that answers, for every transaction a retailer records, which accounts go up and which go down. A developer building the posting logic and an accountant checking it should both be able to read a row and agree.

## How to read the tables

- **Debit** increases assets and expenses and decreases liabilities, capital and income. **Credit** does the opposite.
- **Stock account** means the stock account of the store or location on the line (or the item's or company's default).
- **Customer balance** and **supplier balance** mean the account that holds what customers owe the shop and what the shop owes suppliers. The line always names the customer or supplier.
- **Goods received not billed** is a holding account: credited when goods arrive, debited when the supplier's bill arrives.
- Amounts are in rupees. Foreign-currency documents convert at the document's rate, and the party line also keeps the foreign amount.
- Every row balances. Where several lines appear on one side, their sum equals the other side.
- Cancelling any transaction writes the exact opposite lines, dated the same day, or dated today when the unchangeable-ledger setting is on.
- Rounding: when the two sides differ by less than the tolerance after rounding, the difference goes to the rounding account. A rounded invoice total posts its rounding adjustment to the same account.
- Rows marked (if switched on) depend on a setting described in the relevant module.

## 1. Buying

| Transaction | Debit | Credit | Notes |
|-------------|-------|--------|-------|
| Purchase order finalised | nothing | nothing | No accounting entry. Only the ordered quantity and the budget check change. |
| Goods received, stock items | Stock account at stock value | Goods received not billed for the net line amount | Stock value = net amount + charges added to stock + landed costs. |
| Goods received, charges added to stock (freight, duty) | Stock account (included above) | Each charge's account (freight, customs duty) | The charge account is credited so the carrier's bill later debits it back to zero. |
| Goods received, rounding of per-unit value | Cost of goods sold | Stock account | Only the tiny difference between line value and ledger value. |
| Goods received, rejected quantity | nothing | nothing | Rejected goods go to the rejected location at zero value. If switched on, at cost: debit stock account, credit goods received not billed. |
| Goods received, service or non-stock item with provisional accounting (if switched on) | The item's expense account | Provisional expense liability | Reversed when the bill arrives. |
| Supplier bill against a receipt, stock items | Goods received not billed (clears the receipt); input GST per tax line | Supplier balance | Any difference between receipt and bill value goes to the stock account if the goods are still in stock, otherwise to cost of goods sold. |
| Supplier bill that also brings in the stock (no separate receipt) | Stock account; input GST | Supplier balance | Receipt and bill in one. |
| Supplier bill, service or expense item | The item's expense account; input GST | Supplier balance | For non-stock items. |
| Supplier bill with TDS withheld | Supplier balance (reduced by the TDS) | TDS payable | The supplier is paid the net amount. TDS is paid to the government later. |
| Supplier bill, extra charges not added to stock | The charge's expense account | Supplier balance | Charges that affect only the bill total. |
| Supplier bill paid on the spot | Supplier balance | Cash or bank | Posted on the bill itself. Otherwise a separate payment does this. |
| Supplier bill, small amount written off | Supplier balance | Write-off account (income side) | Small amounts the supplier waived. |
| Supplier bill, rounding adjustment | Rounding account or supplier balance | Supplier balance or rounding account | Side depends on whether the total was rounded up or down. |
| Foreign-currency supplier bill against a receipt at a different rate | Expense or goods received not billed, or exchange difference | Exchange difference, or expense or goods received not billed | Only the rate difference. |
| Goods returned to supplier | Goods received not billed | Stock account at the original incoming rate | Mirror of the receipt. |
| Debit note to supplier | Supplier balance | Stock account (if stock moved) or expense; input GST reversed | Mirror of the bill. |
| Landed costs added later | Stock account (each received line's share) | Each charge's expense account | The receipt's entries are rewritten with the new value. Later sales are re-costed. |
| Payment to supplier | Supplier balance (per bill) | Bank or cash | |
| Payment to supplier with bank charges or other deductions | Deduction account (bank charges) | Bank (already in the bank credit) | The deduction reduces what reaches the supplier. |
| TDS on an advance to a supplier (if switched on) | Supplier balance | TDS payable | Withheld at payment when there is no bill yet. |
| Payment to supplier at a different rate from the bill | Exchange loss (or credit exchange gain) | Supplier balance (or debit) | Added automatically. |
| Advance to supplier (payment not yet against a bill) | Supplier balance (shows a debit balance), or a separate advance-paid account if switched on | Bank or cash | Moved against the bill when matched. |

## 2. Selling and point of sale

| Transaction | Debit | Credit | Notes |
|-------------|-------|--------|-------|
| Customer order finalised | nothing | nothing | No entry. Only stock reservation and the credit check. |
| Delivery to customer | Cost of goods sold | Stock account | At stock value per unit × quantity. |
| Sales invoice (after delivery, or a service) | Customer balance (invoice total) | Sales income per line (net amount); output GST per tax line | Income account comes from the item, item group, brand or company default. |
| Sales invoice that also moves the stock | Customer balance; cost of goods sold | Sales income; output GST; stock account | Delivery and invoice in one. |
| Sales invoice with separate discount accounting (if switched on) | Discount allowed (line and bill discounts) | Sales income (before discount) | Shows gross sales and discounts separately instead of net sales. |
| Sales invoice, settlement discount on the total | Discount account | Customer balance | Bill discount treated as a discount for paying. |
| Sales invoice, delivery charge | Customer balance (in the total) | Delivery income account | A fixed charge added to the bill. |
| Sales invoice, TCS collected (if it applies) | Customer balance | TCS payable | Collected from the customer and paid to the government later. |
| Sales invoice, rounding adjustment | Customer balance or rounding account | Rounding account or customer balance | |
| Credit note to customer | Sales income; output GST | Customer balance | If the goods come back on the same note: debit stock account, credit cost of goods sold. |
| Goods returned by customer (separate return delivery) | Stock account at the original outgoing rate | Cost of goods sold | |
| Till bill when bills are summarised at day-end | nothing | nothing | No entry until the shift closes. Stock is only held for the till. |
| Day-end summary invoice (one per customer per shift) | Cash in till; card settlement; UPI or wallet settlement; customer balance for any unpaid amount; cost of goods sold | Sales income; output GST; stock account | All the shift's payments are added up per payment method. |
| Change given from the till | Customer balance (so the customer's line nets to the bill) | Cash (change) | If change is not posted separately, the cash debit is simply reduced by the change. |
| Small leftover written off at the till (within the limit) | Write-off expense | Customer balance | Automatic on the summary invoice. |
| Loyalty points used on a bill | Loyalty expense | Customer balance | Earning points posts nothing. Whether to set aside a liability is an open question. |
| Till bill posted straight away (no day-end summary) | Same as the summary invoice, per bill | | |
| Payment from customer | Bank or cash | Customer balance (per invoice) | |
| Payment from customer, short payment written off | Discount allowed or write-off expense | Customer balance | A deduction on the payment. |
| Payment from customer at a different rate | Exchange loss (or credit exchange gain) | Customer balance (or debit) | |
| Advance from customer (not yet against an invoice, or against an order) | Bank or cash | Customer balance (shows a credit balance), or a separate advance-received account if switched on | Matched to the invoice later. |
| Gift voucher sold (proposed) | Cash | Gift-voucher liability | When used: debit gift-voucher liability, credit customer balance, as a payment method. |

## 3. Inventory

| Transaction | Debit | Credit | Notes |
|-------------|-------|--------|-------|
| Stock coming in without a purchase (found stock, free goods) | Stock account | The line's other account (stock adjustment, or temporary opening for opening stock) | |
| Stock going out without a sale (damage, expiry, theft, own use) | The line's other account (write-off, damages, consumables) | Stock account | At stock value. |
| Transfer between locations | Stock account of the receiving location | Stock account of the sending location | No entry if both locations use the same account. |
| Transfer with extra costs (freight between stores) | Stock account of the receiving location (includes the cost) | Stock account of the sending location; freight expense | The cost becomes part of the moved stock's value. |
| Repacking (for example a bulk bag into small packs) | Stock account for the new packs | Stock account for the bulk item; extra-cost accounts | New packs' value = bulk value used + extra costs. |
| Stock count, quantity or value up | Stock account | Stock adjustment | |
| Stock count, quantity or value down | Stock adjustment | Stock account | |
| Opening stock count | Stock account | Temporary opening account | Must be a balance-sheet account. |
| Value-only correction | Stock account or stock adjustment | Stock adjustment or stock account | Quantity unchanged. |
| Re-costing after a back-dated entry | Rewrites the stock and cost-of-goods entries of later documents | | Later cost of goods sold and stock values change. |
| Rounding gain or loss on internal transfers | Cost of goods sold | Stock account (or the reverse) | Tiny amounts. |

## 4. Accounting

| Transaction | Debit | Credit | Notes |
|-------------|-------|--------|-------|
| Journal | Whatever the lines say | Whatever the lines say | Must balance. Customer and supplier balance lines name the party. |
| Petty-cash expense | Expense account | Cash | A cash journal, or a payment to an expense account. |
| Cash deposited in the bank | Bank | Cash | A transfer between own accounts. |
| Bank charges or interest from the bank statement | Bank charges expense, or bank | Bank, or interest income | Created while matching the bank statement. |
| Card settlement received net of commission | Bank (net); card commission expense | Card settlement account (gross) | Clears the day's card takings. |
| Writing off a customer's unpaid balance | Write-off or bad-debt expense | Customer balance | A write-off journal or a deduction on a payment. |
| Opening balance journal | Each asset account | Each liability and capital account | The temporary opening account takes the difference. It must be zero after all openings. |
| Opening unpaid customer bill | Customer balance | Temporary opening account | Keeps the real age of the debt. |
| Opening unpaid supplier bill | Temporary opening account | Supplier balance | |
| Revaluing foreign-currency balances (optional) | Customer or supplier balance, or unrealised exchange difference | Unrealised exchange difference, or customer or supplier balance | Month-end or year-end only. |
| Year-end closing | Every income account (its credit balance); the closing account for a net loss | Every expense account (its debit balance); the closing account (retained earnings) for a net profit | Per store cost centre. Income and expenses start the new year at zero. |
| Cancelling any document | Opposite of the original lines | Opposite of the original lines | Same date, or today under the unchangeable ledger. |

## 5. Tax (summary; rules in the Tax module)

| Transaction | Debit | Credit | Notes |
|-------------|-------|--------|-------|
| Output GST on a sale | Customer balance (part of the total) | CGST payable and SGST payable (same state) or IGST payable (other state) | One tax line per head. |
| Input GST on a purchase | CGST input, SGST input or IGST input | Supplier balance (part of the total) | Only when credit can be claimed. Otherwise the tax is added to the cost of the goods. |
| Purchase under reverse charge | Input GST (if claimable) and expense or stock | Supplier balance (without tax) and GST payable under reverse charge | The shop pays the tax itself. |
| Monthly GST set-off | GST payable heads | GST input heads; bank for the balance paid | A journal based on the return. |
| TDS deducted on a supplier bill or advance | Supplier balance | TDS payable | Paid to the government later: debit TDS payable, credit bank. |
| TCS collected on a sale | Customer balance | TCS payable | Paid to the government the same way. |

## 6. Quick checks a developer can run against these tables

1. After any sale: sales income + output GST + rounding (credits) = customer balance, cash or card (debits).
2. After any delivery or stock-moving sale: the fall in the stock account equals the rise in cost of goods sold.
3. After a receipt and its bill: goods received not billed is zero for that receipt, and the stock account rose by the bill value plus charges added to stock.
4. After a shift closes: cash in till + card settlement + UPI or wallet settlement + unpaid customer balances = total of the shift's bills − change given.
5. At any time: the stock account balance per location = the stock value per location in the stock records (the stock-against-accounts report).
6. At the start of a year: every income and expense account is at zero, and the closing account moved by last year's profit.
7. After go-live openings: the temporary opening account is at zero.
