# Plan: Module 9, Reports and dashboards

Status: **approved by the project owner on 16 October 2026** with these answers to section 11:
1. The daily summary email is built now, with Nodemailer (MIT-0). The mail account is set up in the server's `.env`.
2. Excel export is CSV for now.
3. All the reports in section 1.2 are built in this module.

**Build order:** module 8 (GST) waits for the Chartered Accountant's approval of questions 43 and 55–64 (CLAUDE.md §6.1). The project owner asked on 16 October 2026 to build module 9 first. GST reports are left for module 8.

Sources: `docs/blueprint/14-reports-and-dashboards.md`, the Reports sections of blueprints 05, 07, 08, 09 and 11, `docs/decisions.md` questions 39, 51, 52, 65, 66, 67, 70, 79, the launch scope row "Key daily reports", and CLAUDE.md rules 1–15.

## 1. What this module gives the shop

1. **Dashboards on the home page.** Each person sees the ones their role allows.
   - **Store** (store manager; own store only): today's sales, bills, average bill, returns, cash expected in the tills and items below reorder level. Charts: sales by hour today, sales over the last 30 days, payment mix, and the top 10 items this week.
   - **Owner** (all stores): month-to-date sales, gross margin %, stock value, what customers owe and what the shop owes suppliers. Charts: sales by store per month, margin by item group, stock value trend, and customer dues by age.
   - **Purchasing:** value of open purchase orders, late deliveries and items short. Charts: purchases by supplier, and reorder suggestions by group.
   - **Accounts:** bank and cash balances, cash in tills and overdue customer dues. Charts: income against expenses by month, and cash flow.
   - Every headline figure shows the change against the previous period of the same length, and every dashboard shows when it was worked out.
2. **New reports** (decision 66 priorities first):

   | Report | Question it answers |
   | --- | --- |
   | Daily sales by store | How did each store do? Bills, quantity, net sales, tax, discounts, returns, average bill. |
   | Item-wise sales | What sold, by item, group or brand, with quantity and value. |
   | **Best and worst sellers** ★ | The top and bottom items by quantity, sales or margin. |
   | Sales by group or brand | Which categories sell, week by week. |
   | Returns and cancelled bills | What came back or was cancelled, with the reason and cashier. |
   | Discounts given | Line and bill discounts, offers, coupons and manager approvals. |
   | Gross profit | Sales, cost and margin by item, group, customer or store. |
   | Stock movement for a period | Opening, in, out and closing quantity and value per item. |
   | **Stock cover and sell-through** ★ | Days of stock left at the current rate of sale, and how much of what came in has sold. |
   | Stock age | How long the stock on hand has been sitting, in age bands. |
   | **Stock variance and loss (shrinkage)** ★ | Write-offs and count shortfalls by reason, as value and as % of sales. |
   | Cash and bank position | The balance of every cash, till and bank account on a date. |
   | Cash flow | Money in and out, from trading, investing and financing (left for this module by plan 07). |

   ★ = decision 66 priority. **Hourly sales**, also a priority, already exists as a till report and moves into the dashboard.
3. **Report centre** (`/reports`): one page listing every report in the product, grouped as daily, weekly and monthly. That includes the till, stock, purchase and accounts reports already built in modules 4–7. Each shows only to roles that may run it.
4. **The same tools on every report:**
   - filters with sensible defaults; the store is limited to the user's own stores;
   - a totals row and the time it was worked out;
   - **Download for Excel (CSV)**; each download is recorded in the history;
   - **Print / save as PDF** with the company name and address at the top (decision 65).
5. **Owner's daily summary email** (decision 67). Once a day at a chosen time, an email goes to the chosen people with:
   - yesterday's sales per store, against the same day last week;
   - month-to-date sales and gross margin;
   - cash in tills and bank;
   - customer and supplier dues, with the overdue amounts;
   - items below reorder level;
   - negative stock;
   - till sync problems.
   - It is sent once per day even if the server restarts. People who are switched off get nothing. A failed send is recorded and shown to the Owner.
   - It needs a mail account to send from (question 1).

## 2. Not built now

| Left out | Why |
| --- | --- |
| A report builder and saved views | Decision 65: fixed reports plus export; a builder comes later |
| WhatsApp or SMS summaries | Decision 67: later, after a provider is chosen |
| GST return figures, input credit matching | Module 8, after the CA's approval |
| Bank matching statement | Deferred (decision 53) |
| Loyalty points report | Loyalty is deferred (decisions 15, 16) |
| Supplier rating | Decision 24 |
| Parked bills from earlier days | Parked bills stay on the till computer and never reach the server (plan 06) |
| Running reports in the background | Not needed at this size: reports are capped at 100,000 rows on screen, and export covers more |

## 3. Where the figures come from (so every report agrees)

- **Sales** are read from the till bills directly, so they are current before a shift closes (blueprint 14 edge case). Returns count on the day they happen, so a day's net sales can be negative. Cancelled bills are left out. Net sales means **before GST** (taxable value). GST is shown separately.
- **Cost of goods sold and margin** use the stock records for each sale line. This is the cost at the time of sale plus any later correction such as freight added afterwards, so margins agree with the accounts. Cashiers never see cost or margin (decision 70). Those columns need the cost-price permission.
- **Stock figures** come from the stock records (module 4). **Money figures** (cash, bank, dues, cash flow) come from the ledger (module 7, decision 51).
- **Stock age** assumes the oldest stock leaves first. The stock on hand is matched against the most recent goods that came in, and its age is counted from those dates.
- **Cash flow:**
  - Every movement in a cash, till or bank account is put under the kind of account on the other side:
    - **trading:** sales, purchases, customers, suppliers, expenses, tax, stock;
    - **investing:** fixed assets, investments;
    - **financing:** capital, drawings, loans.
  - Moves between the shop's own cash and bank accounts are left out.
  - Opening cash plus the three totals equals closing cash.

## 4. Calculations (shared code, with tests)

- **Change %** = (this period − previous period) ÷ previous period × 100. The previous period has the same length and ends just before this one. Shown as "new" when the previous period is zero.
- **Average bill** = net sales ÷ number of sale bills. Returns are not counted as bills but reduce the value.
- **Items per bill** = quantity sold ÷ number of sale bills.
- **Gross margin %** = (net sales − cost of goods sold) ÷ net sales × 100.
- **Sell-through %** = quantity sold in the period ÷ (opening stock + received in the period) × 100.
- **Days of stock left** = stock on hand ÷ average daily quantity sold over the last N days (default 30). Shown as "no sales" when nothing sold.
- **Stock turnover** = cost of goods sold ÷ average stock value, where average stock = (opening + closing) ÷ 2.
- **Shrinkage %** = value of write-offs and count shortfalls ÷ net sales × 100.
- **Stock age bands:** 0–30, 31–60, 61–90, 91–180 and over 180 days.
- All money uses Decimal and the one rounding rule (CLAUDE.md rules 1 and 2). All dates are Indian business dates (rule 15).

## 5. Data model

| Table | What it holds |
| --- | --- |
| `SummaryEmailSettings` | Company; switched on or off; send time (Indian time); the users who receive it; which figures to include |
| `SummaryEmailRun` | Company, business date, sent at, recipients, error. One row per company per date, so the email is never sent twice |
| New indexes | For fast reports: till bills by company + business date, bill lines by item, stock entries by document type + date |

Downloads are recorded in the existing history (audit log) as "export", with the report and filters. The mail server address and password live in the server's `.env` file, never in the database (rule 12).

## 6. Screens

1. **Home page:** the dashboards the user may see, as tabs, with tiles and simple charts. Charts are drawn with our own code; no chart library.
2. **Report centre** (`/reports`).
3. One page per new report under `/reports/…`, with filters, a table, totals, CSV and Print.
4. **Daily summary email** settings (Owner): switch on or off, time, recipients, figures, "Send a test now", and the last sends with any errors.

## 7. API endpoints (every one checks permission and store on the backend)

- `GET /dashboards/store`, `/dashboards/owner`, `/dashboards/purchasing`, `/dashboards/accounts`
- `GET /reports/daily-sales`, `/reports/item-sales`, `/reports/best-sellers`, `/reports/sales-by-group`, `/reports/returns`, `/reports/discounts`, `/reports/gross-profit`, `/reports/stock-movement`, `/reports/stock-cover`, `/reports/stock-age`, `/reports/shrinkage`, `/reports/cash-position`, `/reports/cash-flow`
- `POST /reports/export-log` (records a download)
- `GET/PUT /summary-email/settings`, `POST /summary-email/test`, `GET /summary-email/runs`

## 8. Permissions

| Key | Who | What |
| --- | --- | --- |
| *(existing)* `pos.reports` | Owner, Accountant, Store manager, Auditor | Sales, returns and discounts reports, store dashboard |
| *(existing)* `cost_price.view` / `stock.cost.view` | Not cashiers (decision 70) | Margin, cost and stock value columns and tiles |
| *(existing)* `purchase.view`, `accounts.view`, `stock.view` | As today | Purchasing and accounts dashboards and reports |
| `reports.summary_email` (new) | Owner | Set up the daily summary email |

A store manager's reports and dashboards quietly cover only their stores, and the totals cover only what they may see.

## 9. Acceptance scenarios (added to `docs/acceptance-tests.md` "Module 9" before building)

1. **Daily sales by store:**
   - MAIN sells 3 bills worth ₹1,000 net and ANNA 1 bill worth ₹500.
   - The report shows MAIN 3 bills, average ₹333.33, and ANNA 1 bill.
   - A ₹200 return the next day shows on that day as −₹200 with 0 bills.
2. **Best sellers and gross profit:**
   - Items rank by quantity and by sales.
   - Margin uses cost at the time of sale. After freight is added to a receipt, the item's margin falls by its share, matching cost of goods sold in the accounts.
   - A cashier gets no cost or margin.
3. **Discounts given:** a manual 5% line discount, a manager-approved 12% discount, an offer and a coupon each show with who gave or approved them.
4. **Stock cover and sell-through:** 60 in stock, 90 sold over 30 days → 20 days left. 100 opening + 50 received with 90 sold → 60% sell-through.
5. **Stock age:** 40 units received 100 days ago and 20 received 10 days ago, with 30 on hand → 20 in 0–30 days and 10 in 91–180.
6. **Shrinkage:** ₹180 damage plus a ₹270 count shortfall against ₹9,000 sales → ₹450, 5.00%.
7. **Cash position and cash flow:**
   - Balances match the ledger.
   - For the period, opening cash + trading + investing + financing = closing cash.
   - Cash taken to the bank appears in none of them.
8. **Store limits:** a store manager of MAIN sees only MAIN on every report and dashboard; the totals equal MAIN's own.
9. **Dashboards agree with reports:** today's sales tile = the daily sales report for today; month-to-date margin = the gross profit report for the month.
10. **Daily summary email:**
    - it contains the agreed figures;
    - it is sent once per day even if triggered twice;
    - a switched-off user gets nothing;
    - a mail failure is recorded and shown.
11. **Downloads are recorded** in the history with the report name and filters.

## 9c. Decisions made while building (for the project owner to confirm)

1. **Discounts are shown as charged, including GST.** For example, 5% off a ₹105 soap is ₹5.25. Net sales, cost and margin are always **before GST**.
2. **The daily email's day:** sent at or after 12 noon (Indian time) it covers that day; sent in the morning it covers the day before. The default time is 9 pm.
3. **"Came in" for sell-through** counts every document that raised stock in the period: goods receipts, transfers in, stock-ins, counts that found more and opening stock. Till returns are not counted, and a cancelled document counts as nothing.
4. **Stock age:** stock with no receipt on record (for example from before the system) is put in the oldest band.
5. **Cash flow for a store manager** shows "To or from other accounts" for cash taken to the bank, because they cannot see the bank accounts. Opening + all sections = closing still holds.
6. **The owner dashboard** is shown only to users who can see every store and either cost prices or accounts.
7. **The daily email is worked out with company-wide rights** (the Owner's view), whoever receives it. Only the Owner chooses the recipients.
8. **Mail account:** set in the server's `.env` (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, MAIL_FROM; see `.env.example`). Until it is set, the settings can be saved, and a test send records "No mail account is set up".

## 10. Order of building

1. Shared calculations with tests.
2. Report queries in the API, each with the store limit and Decimal totals; then the acceptance tests.
3. Dashboards API.
4. Summary email (sender, schedule, once-per-day guard).
5. Screens: report centre, report pages, dashboards, email settings.
6. A hands-on check in the browser on the sample data.

## 11. Questions for the project owner

1. **Daily summary email (decision 67).** Sending email needs a mail account, such as your company mail, Gmail or Zoho, set up once by whoever runs the server. Sending also needs a small mail library, **Nodemailer** (licence MIT-0, a permissive licence like MIT). Approve building it now with Nodemailer? *Recommended.* Or build the email later?
2. **Excel export (decision 65).** CSV files open directly in Excel and need no new library. A true Excel file (.xlsx) needs the ExcelJS library (MIT licence). *Recommended: CSV now; .xlsx later if your staff need formatted sheets.*
3. **Report priorities.** Build all the reports in section 1.2 now? *Recommended.* Or only the decision 66 priorities (best and worst sellers, stock cover, shrinkage) and the dashboards first?
