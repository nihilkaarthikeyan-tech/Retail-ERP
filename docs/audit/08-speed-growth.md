# Audit 08: Speed and growth    Date: 29–30 October 2026

Scope: the slowest screens, reports and jobs at the size of a busy shop; the database; what breaks with more shops or a second copy of the API; outside services (GST network, email); running limits (email per day, disk, logs).

How:
- Two read-only helpers: slow queries and lists, and growth and outside services.
- A test shop with two years of data, timed screen by screen.
- The speed-test kit (`apps/api/perf`) first traded two weeks through the real system: 3 shops, 6 tills, 9,523 bills, purchases, transfers and payments.
- A new step (`perf/amplify.perf.ts`) then copied that inside the database back over two years. The result:

| Item | Size |
| --- | --- |
| Items | 53,200 |
| Customers | 20,001 |
| Till bills (24 Oct 2024 – 28 Oct 2026) | 504,719 |
| Bill lines | 1,192,500 |
| Stock movements | 1,204,690 |
| History rows | 535,981 |
| Database | 1.9 GB |

Each screen was asked three times (the table shows the usual time).

## Findings

| # | Severity | Where | What was wrong | What a shop would see | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | High | `modules/module-map.ts` | The "modules on and off" map was kept in memory once for the whole server, not per shop | For up to 15 seconds after another shop's request, a shop's features could be refused as "switched off", or a switched-off one allowed | ✔️ Fixed: one entry per shop; test 14.9 |
| 2 | High | sales reports, dashboards, summary e-mail | Every bill line of the period was read into the server and added up there | A report over two years ran the API out of memory: **the system went down for every shop** | ✔️ Fixed: totals added up by the database (`totalsBy`); the same figures (all report tests pass) |
| 3 | High | "Download all my data" | The whole shop was built in memory as one file | A large shop's download (hundreds of MB) could stop the server for everyone | ✔️ Fixed: written to a temporary file piece by piece and streamed, one download at a time |
| 4 | High | `accounting/catch-up.service.ts` | At every start the API read every stock movement ever made, and retried every empty shift | Each update and restart got slower (minutes, then out of memory) | ✔️ Fixed: only movements still to post (with an index); empty shifts are not retried |
| 5 | High | `purchasing/reorder.service.ts` | The nightly reorder run had 5 seconds | A shop with a few hundred reorder levels got no suggestions; "Run now" failed | ✔️ Fixed: 10 minutes, items read in one query, one run per shop at a time |
| 6 | High | `auth/rate-limit.ts` | 1,200 requests a minute per address | 20 tills behind one shop's internet connection, scanning at peak, would be refused | ✔️ Fixed: 6,000 a minute; login, sign-up and PIN limits unchanged |
| 7 | High | `reports/mailer.service.ts` | No daily count against the mailbox's allowance (Hostinger about 100 a day) | Late in the day, password resets would silently not arrive | ✔️ Fixed: counted per recipient per day; the last 25 are kept for password and sign-in e-mails; "Send a test" limited to 5 an hour |
| 8 | High | database | No index on bill payments, ledger lines, barcodes, returns, a customer's bills, the GST month, stock by place; "contains" search read whole tables | Bill save, shift close, day book, item list, returns and searches slowed down as the shop grew | ✔️ Fixed: 17 indexes and fast "contains" search (pg_trgm) on item and customer names, codes, mobiles and bill numbers |
| 9 | Medium | `reports/stock-analysis.service.ts` | Stock age compared every item with every delivery; stock cover and stock movement added up every movement ever made | 4–10 seconds | ✔️ Fixed: grouped once; worked out from today's stock less later movements |
| 10 | Medium | `ledger.service.ts` | "Who owes what" asked the database twice per customer and supplier (dashboards, ageing, book health) | Slow with many customers on account | ✔️ Fixed: two queries in all |
| 11 | Medium | `inventory/stock-engine.service.ts` | Re-costing a busy item a year back wrote one update per later movement | A slow save while the tills selling that item waited (audit 3 #14) | ✔️ Fixed: written 2,000 rows per statement |
| 12 | Medium | `inventory/stock-reports.service.ts` | Stock on a past date sorted every movement of the shop | It never finished on two years of data | ✔️ Fixed: each item's last movement through the index, 1.6 s |
| 13 | Medium | `pos/pos-reports.service.ts` | Till payments, hourly and cashier reports read every bill; with no dates, every bill ever made | 14 seconds for two years | ✔️ Fixed: added up by the database; no dates means the last 31 days |
| 14 | Medium | `prisma/prisma.service.ts` | A request waited for ever for a free database connection; no time limit on a statement | One stuck job could hold up every shop | ✔️ Fixed: 15 s wait, 5-minute statement limit, 2-minute idle-transaction limit, pool size set |
| 15 | Medium | GSTIN check | A person waited up to 48 s when the GST network was down; an import waited on each row | Slow saves and imports during an outage | ✔️ Fixed: one 6-second try while someone waits; no tries for 2 minutes after the network was found down; the nightly re-check catches up |
| 16 | Medium | mail | No time limits on the mail server (2 and 10 minutes) | "Forgot password" hung | ✔️ Fixed: 10–30 seconds |
| 17 | Medium | sessions, e-mail links | Never deleted | Tables grow for ever | ✔️ Fixed: nightly clean-up (sign-ins 90 days after they end, used links after 30 days) |
| 18 | Medium | `deploy/` | Docker logs had no limit; the backup ran at 02:30 with the nightly jobs and did not check the disk | A full disk stops every site on the server | ✔️ Fixed: logs 5 × 20 MB per service; backup at 04:00, stops when the disk is short |
| 19 | Medium | Nginx | Answers passed through from the API were not compressed; the site listened on IPv4 only | The till's item list travels as tens of MB of plain JSON; Airtel customers cannot reach IPv4 | ✔️ Fixed: gzip for JSON, CSS and scripts; IPv6 lines added (server rule) |
| 20 | Low | reorder-levels screen | One request per item for names | Thousands of requests | ✔️ Fixed: 200 items per request |
| 21 | Low | billing screen | Looked items up one by one in the 50,000-item list on every redraw | Lag with a long bill | ✔️ Fixed: the index the till already keeps |
| 23 | High | `imports/kinds.service.ts` | Exporting items read 50,000 items with their units and barcodes in one query (more values than the database takes) and searched the whole price list once per item; customer, supplier, price and reorder exports passed every id | "Export to Excel" failed for a shop with over about 30,000 items or customers | ✔️ Fixed: 5,000 items at a time, prices looked up, the shop's lists read whole |
| 22 | Low | owner dashboard | Six months of lines for the chart | — | ✔️ Fixed: by month and store in the database |

## Timings (two years, 504,719 bills, 53,200 items)

"Before" is the code before this audit on the same data (with the new indexes). It shows "crash" where the API ran out of memory.

| Screen or report | Before | After |
| --- | --- | --- |
| Item list, item search, barcode scan, stock of one item | 45–200 ms | 45–200 ms |
| Customer search (name or part of a mobile) | 70 ms | 40–55 ms |
| Today's bills, find a bill by number, find a bill to return | 150–250 ms | 160–400 ms |
| Store dashboard | 0.7–1.2 s | 0.3 s |
| Owner dashboard | 3.6–4.2 s | 1.4 s |
| Sales reports for a day | 0.1 s | 0.1–0.3 s |
| Sales reports for a month (daily, item-wise, by group, best sellers, gross profit) | 1.5–3.1 s | 0.5–1.7 s |
| Sales reports for two years | crash, then 13–15 s | 4.3–6 s |
| Till payments by method, two years | 14 s | 1.7 s |
| Shrinkage, two years | 11 s | 3.9 s |
| Stock movement (a day / a month / two years) | 2.1–3.5 s | 1.5 / 1.7 / 2.5 s |
| Stock balance of a shop | 1.6–2.2 s | 1.4 s |
| Stock on a past date | never finished | 1.6 s |
| Stock cover | 4 s | 2.1 s |
| Stock age | 1.5 s | 1.4 s |
| Accounts reports (day book, ledger, P&L, balance sheet, ageing, cash) | 50–800 ms | 40–600 ms |
| GSTR-1 / GSTR-3B for a month | — | 3.4 s / 3.6 s |
| Export all items to Excel (53,200 items) | failed (too many values for one query) | 5.5 s |
| Download all my data (306 MB zip) | built in memory | 88 s, written to disk as it goes; the server stays up |

At the till (6 tills, the most the test shop has):

| Step | Usual | Slowest |
| --- | --- | --- |
| Scan a barcode (looked up on the till itself) | 40 ms | 85 ms |
| Save a 3-item bill, one till busy | 281 ms | 409 ms |
| Save a bill, all 6 tills at the same moment | 472 ms | 745 ms |
| Close a shift (posts it to the accounts) | 217 ms | 293 ms |
| Start of day: download the item list for offline use (54 MB as plain JSON; compressed by Nginx now) | 4.7–5.3 s | |

The API used 2.6 GB of memory at its peak in the test process, which also held the 306 MB download in the test client.

## Accepted, with the reason

- **Reports over two years take 4–6 seconds.** They are added up by the database and no longer endanger the server; a month takes under 2 seconds. A daily sales summary table would make long periods instant; worth it only when a shop needs year-on-year reports often (Session 14).
- **GSTR-1 and GSTR-3B take about 3.5 seconds for a month of a busy shop.** They read each bill to classify it under the GST rules (audit 4); a once-a-month filing screen. Rewriting that is a GST change, not done for speed alone.
- **Lists of every item in stock** (stock balance, stock movement, stock cover): about 2–3 seconds for 50,000 items, mostly sending 50,000 rows. Paging needs the screens changed (Session 9).
- **One copy of the API.** With two copies the nightly jobs would run twice (reorder now takes a lock; the GSTIN re-check would pay twice) and each copy keeps its own flood counts. Updates stop the old copy before the new one starts. A second copy needs job locks and shared counts first.
- **20 tills at once**: the test shop has 6 tills; 6 saving at the same moment took under 0.75 s each, with no lock waits. 20 tills is three such shops on one server; measured on the live server in Session 12.
- **Container memory and CPU limits** are a server setting: Session 12.
- **The summary e-mail check every 5 minutes walks every shop**: about 1,000 small queries at 500 shops; fine until then.

## Needs the owner

- Nothing new. Still open from audit 7: where the nightly backup copy goes (Session 12).

## Tests

- New `module19-audit8.e2e-spec.ts`:
  - stock movement opening, in, out and closing before, during and after the period;
  - the e-mail allowance keeps room for password e-mails;
  - the nightly clean-up.
- New test 14.9: each shop has its own modules map.
- New unit test: the piece-by-piece zip reads back the same.
- The sales totals now come from the database; all 79 report tests give the same figures as before.
- Speed kit: `pnpm perf:seed` (real trading), `pnpm perf:amplify` (to two years), `pnpm perf:measure` (timings, written to `perf/out/progress.log` as it goes).

## Result

The High findings, every Medium and the Lows fixed with tests. On two years of a busy shop (504,719 bills, 53,200 items): every screen staff use daily, every report for a day or a month, and the till are under 2 seconds (the till under half a second per bill); nothing takes the server down. Reports over two years, the GST returns for a busy month and full-stock lists take 2–6 seconds (accepted above). Session 8 is **done** (30 October 2026).
