# Launch check

A hands-on test of every screen in the browser before launch, started 27 October 2026.
Each screen is used the way a shop would use it (add, change, save, cancel, wrong input), and the effect on
stock, accounts and GST is checked. Problems found are listed at the bottom with what was done.

Before the video: switch "Print the receipt automatically" back on for till T1 (switched off for testing on 27 October).

Test shop: "Sri Lakshmi Fashions" on localhost (made-up data, see `docs/dev-sample-data.md`).
Optional features (variants, batches, seasons, offers and so on) are switched on under **My modules** to test them.

Status: ☐ not yet · ✅ works · ⚠️ problem found (see list) · ✔️ problem fixed

## 0. Start and account

| Screen | Status | Notes |
| --- | --- | --- |
| Landing page, contact form | ✔️ | All links and pictures work, no sideways scrolling; empty and short-phone sends refused, a real one saved and thanked; problem 81 |
| Sign up, set-up guide | ✅ | Done in the walkthrough of 27 October |
| Log in, wrong password, log out | ✅ | Problems 5, 9, 19 |
| Forgot password, confirm email | ✔️ | Same answer for an unknown and a real email; reset by link works, the new password logs in, a used link is refused, both kept in the history; problems 82, 83 |
| My sessions | ✔️ | Browser shown as "Chrome on Windows" (was the raw identifier) |
| Quick search (Ctrl+K), menu, light/dark, phone layout | ✔️ | Screens, items, customers and bills found; dark mode readable (contrast 7 to 1); phone has no sideways scrolling; problems 84, 88 |

## 1. Administration

| Screen | Status | Notes |
| --- | --- | --- |
| Company | ✔️ | Problems 3, 6, 7, 8 |
| Stores | ✔️ | Problems 4, 8 |
| Financial years | ✅ | Overlap and wrong length refused; lock and reopen work (problem 16) |
| Document numbering | ✔️ | Problem 11; pattern check, store series, counter change with reason all work |
| Users | ✅ | Create, weak password and duplicate email refused, forced password change, reset, switch off and on |
| Roles (and a limited user really is limited) | ✔️ | Problems 12, 18; a cashier of Anna Nagar is refused T. Nagar data by the server |
| Change history, Login history | ✔️ | Everything recorded; problem 20 |
| Settings | ✅ | Wrong value refused, save survives reload, back to default, search |
| My modules | ✅ | All 19 switched on and kept |
| Going live | ✅ | Checks agree; "Clear trial data" to be tried at the very end |
| Download all my data | ✅ | Zip of 122 lists, no session/PIN files; user columns checked in the code audit |

## 2. Catalogue

| Screen | Status | Notes |
| --- | --- | --- |
| Items (add, change, deactivate) | ✔️ | Problems 1, 22, 23, 24; style with 6 sizes and colours, barcodes (check digit, duplicates), season copied to all sizes |
| Item groups | ✅ | Sub-group under a group with items refused; HSN checked |
| Brands | ✅ | Duplicate code refused (any case); problem 25 |
| Units | ✅ | Wrong-kind, repeated and zero conversions refused |
| Attributes and variants (sizes, colours) | ✔️ | Problems 21, 28 |
| HSN codes | ✅ | Wrong code refused; problem 27 |
| Seasons, Markdowns | ✔️ | Problems 29, 30, 31, 32; 20% off a season: ₹799 → ₹639 for 1–15 Nov, back to ₹799 after |
| Price lists, Prices | ✅ | List for neither selling nor buying refused; a dated price takes over on its date |

## 3. Customers and suppliers

| Screen | Status | Notes |
| --- | --- | --- |
| Customers | ✔️ | Wrong mobile refused; same mobile warned with "add anyway"; business customer GSTIN state and check digit (problem 6) |
| Birthdays this week | ✅ | Priya's birthday shown "in 2 days" |
| Suppliers | ✅ | Created with GSTIN and terms |
| Customer groups, Supplier groups | ✅ | |
| Payment terms | ✅ | 90% refused, 50% + 50% saved |

## 4. Stock

| Screen | Status | Notes |
| --- | --- | --- |
| Stock on hand | ✅ | |
| Stock documents (count, move, adjustment) | ✅ | Write-off ₹160 to "Stock written off"; count 5 → 4, ₹1,400 to "Stock adjustment"; not enough stock refused with the reason |
| In transit (transfer between shops) | ✅ | 2 sent T. Nagar → Anna Nagar and received; both shops' stock agrees with the books; problem 39 |
| Stock history | ✔️ | Every movement explained; problem 37 |
| Batches | ✔️ | Cosmetics item received in two batches with expiry; Batches screen lists earliest expiry first and filters by days left; the till sold from the earliest batch (AL-2401 10 → 9); problems 85, 86, 89 |
| Negative stock | ✅ | Empty, explains what to do; filled from the till test |
| Locations | ✅ | Each store got its back room, shop floor and rejected goods |
| Reorder levels | ✅ | Level 6 for Red S gives a suggestion of 10; problems 40, 41 |

## 5. Purchases

| Screen | Status | Notes |
| --- | --- | --- |
| Purchase orders | ✔️ | Size grid, 24 pieces, ₹9,600 + ₹480 GST; 87.5% received shown; problem 33 |
| Goods receipts | ✅ | Part receipt; stock and "goods received not billed" ₹8,400; return of 1 (too many refused) |
| Supplier bills | ⚠️ | Bill from the receipt ₹8,820 with input CGST/SGST ₹210 each, due 26 Nov; debit note ₹420; problem 34 |
| Freight and charges | ✅ | ₹210 shared by quantity: ₹400 → ₹410 a piece; stock and books agree |
| Sale or return | ✅ | Screen; the full flow is covered by the automatic tests |
| Reorder suggestions | ✅ | |
| Purchase reports | ✅ | Order follow-up right |
| Purchase tax register, Input credit matching | ✅ | Bill and debit note at 5% with the right CGST/SGST; GSTR-2B upload needs a file and is covered by the automatic tests; problem 42 |

## 6. Billing counter

| Screen | Status | Notes |
| --- | --- | --- |
| Tills (make this computer a till) | ✅ | |
| Open the till: open shift, cash bill, change | ✅ | |
| Card and UPI, split payment | ✅ | ₹1,000 UPI + ₹842 card, references kept; UPI without reference refused |
| Return (F7), exchange | ✅ | Leggings back for a Blue M kurti: ₹405 paid, ₹95 change |
| Park and recall (F8, F9), customer (F6), discounts | ✔️ | Offer 10% applied; 10% manual discount approved with manager PIN (wrong PIN refused); customer by mobile, 18 points earned; problems 48, 49, 50 |
| Lock / switch cashier, cash in / out | ✅ | Cash out without a reason refused; switching cashier covered by the automatic tests |
| Close shift with cash count | ✅ | ₹24 short posted to "Cash short or over"; the shift's sales, GST, card, UPI, gift card and points all agree with the bills |
| Offline billing | ✅ | Server stopped: bill made ("Offline, 1 waiting"), server back: sent once, marked offline; crash: "Bill restored" |
| Till bills, cancel a bill, reprint | ⚠️ | Bill detail exact; problem 52 |
| Till reports | ✔️ | Register, payments, sync problems; problems 43, 44 |
| Offers and coupons | ✅ | KURTI10 on the kurti group applied at the till |
| Sales staff | ✅ | Screen; flow covered by the automatic tests |
| Home deliveries | ✅ | Screen; flow covered by the automatic tests |
| Customer orders | ✅ | Screen; flow covered by the automatic tests |
| Alterations | ✅ | Screen; flow covered by the automatic tests |
| Loyalty points | ✅ | 18 + 4 points earned, in the accounts as owed |
| Gift cards | ✔️ | Sold ₹1,000, spent ₹719; problem 47 |
| Payment methods | ✅ | Card and UPI need their reference |
| GST rates | ✅ | |
| My till PIN | ✅ | 1234 refused; PIN set with password check |

## 7. Accounts

| Screen | Status | Notes |
| --- | --- | --- |
| Chart of accounts | ✅ | |
| Journals | ✅ | Debits ₹5,000 against credits ₹4,000 refused with the difference |
| Expenses | ✅ | Electricity ₹1,200 from the bank, in the P&L |
| Receipts and payments | ✅ | ₹5,000 to the supplier by NEFT settles the bill, part paid |
| Bank accounts | ✅ | Wrong IFSC refused; number shown as ••••8901; problem 36 |
| Opening balances | ✅ | Explains the temporary opening clearly |
| Accounts reports (ledger, trial balance, P&L, balance sheet) | ✅ | P&L net profit ₹4,474.46; balance sheet balances (₹9,014); problems 34, 56 |
| Closing the books | ✅ | Lock up to 26 Oct and unlock, with reasons |
| Default accounts | ✅ | |
| Export to Tally | ✅ | Screen; file covered by the automatic tests |

## 8. GST

| Screen | Status | Notes |
| --- | --- | --- |
| GST returns: sales register | ✅ | |
| GSTR-1, GSTR-3B, credit and debit notes | ✅ | B2B invoice of Meena Textiles; totals ₹16,930.96 agree with the books; 3B net payable ₹446.54 after ₹400 input credit |
| E-invoices | ✅ | Off for this turnover; flow covered by the automatic tests |
| E-way bills | ✅ | Nothing above the limit; flow covered by the automatic tests |

## 9. Reports

| Screen | Status | Notes |
| --- | --- | --- |
| Dashboard | ⚠️ | Cash received counted the note, see problem 2 |
| All reports (each one opened) | ⚠️ | All 49 open without error and agree with the books; problems 53, 54 |
| Daily summary email | ✔️ | Problem 55 |

## 10. Printing and data

| Screen | Status | Notes |
| --- | --- | --- |
| Labels, Label templates | ✅ | Preview with name, price, MRP and code; print instructions |
| Import from Excel | ✔️ | Template, check before import, failed rows with reasons, matching columns on the screen; problems 57, 58 |
| Printed documents (bills, purchase orders) | ✅ | Print buttons on bills, orders, receipts; covered by the automatic tests |

## 11. Easy to use (checked last, across all screens)

| Check | Status | Notes |
| --- | --- | --- |
| A new shop owner can find each task without help | ✅ | Menu by area, quick search (Ctrl+K), Getting started checklist with ticks, Settings with search |
| Words are plain shop language, no computer or accounting jargon | ✔️ | Fixed: history, roles, numbering, form messages, sessions, stock history, summary email. Left: "the chart" (accounts), "Variant attributes", "Indian date" hints |
| Every error says what went wrong and what to do | ✔️ | Fixed: rules on two fields (problem 29), plain standard messages (3), discount limit (48), store at the till (12) |
| Empty screens say what to do first | ✅ | Most lists say what to do; "Could not load this list" now separate from empty (10) |
| Forms: clear labels, sensible defaults, nothing asked twice | ⚠️ | Codes typed as well as names (26); 0% maximum discount by default (49); "Hold Ctrl" multi-selects (31) |
| Billing counter works by keyboard and scanner alone, fast | ✅ | F2/F4/F6/F7/F8/F9, + and −, Enter to finish; scanner codes and barcodes; problems 46, 50 |
| Works on a phone and a small laptop | ⚠️ | No page wider than the phone; on phones item codes break across two lines and the filters fill the first screen |
| Light and dark both readable | ✅ | |
| Same look and same button places on every screen | ⚠️ | Two keypad layouts (52); values sometimes ₹1,400.00, sometimes 1400.0000 (fixed on stock screens, 37); dates sometimes 2026-10-01 (30) |

---

## Problems found

| # | Where | What was wrong | Done |
| --- | --- | --- | --- |
| 1 | Items | Every new item without batch tracking was refused ("Automatic batch numbers need batch tracking"): the form always sent automatic batch numbering. On the live site too. | ✔️ Fixed in the form, with a test |
| 2 | Dashboard | "Payments received today" showed the note handed over (₹2,000) instead of the money kept after change (₹1,597). | ✔️ Fixed, with a test |
| 3 | Every form | An empty required field said "Too small: expected string to have >=1 characters". Standard checks now speak plainly ("Please fill this in", "Use at most 160 characters", "Not a valid email address"). | ✔️ Fixed once for all forms, with tests |
| 4 | Stores | A Chennai store could be put under the Karnataka GSTIN, so its bills would report under the wrong state. Now refused with a plain message. | ✔️ Fixed, with a test |
| 5 | Whole back office | When the server was briefly unreachable (for example during an update), everyone was sent to the login page. Now a "Cannot reach the server, trying again" line shows and work carries on when it is back. | ✔️ Fixed, with tests |
| 6 | Company (extra GSTINs), customers, suppliers | Only the shape of a GSTIN was checked there, not its last character, so a typing mistake was accepted (shown in the launch check with customer Meena Textiles) and would only be found when the portal rejected the return. The set-up guide and the till already did the full check (plan 08 G4). | ✔️ Fixed: the same full check everywhere; 78 made-up GSTINs in the tests corrected, and the wrong examples in the set-up guide hint and the Excel import template too. State mismatch now says "is for Karnataka (29), not Tamil Nadu (33)" |
| 7 | Company | Header said "Financial year starts: month 4" instead of "April". | ✔️ Fixed |
| 9 | Whole back office | After the server came back, the page kept showing "Cannot reach the server" until reloaded by hand. Now it loads again by itself. | ✔️ Fixed, with a test |
| 10 | Every list | When a list failed to load it also said "No … yet", as if there were none. Now it says "Could not load this list." | ✔️ Fixed in the shared table |
| 11 | Document numbering | The list showed code names (stock_stock_in, landed_charge) and "Add series" made the owner type a code. Now plain names ("Stock in", "Freight and charges") and a pick-list; the preview names the store, uses plain headings and scrolls into view. | ✔️ Fixed |
| 12 | Billing counter | A cashier of another store (Arun, Anna Nagar) could open a shift on T. Nagar's till. The server refused it only when sent, so every bill after it would have failed too. Now the till says "Arun is not allowed to work at T. Nagar…" and does not start. | ✔️ Fixed, with a test |
| 13 | Billing counter | The red status said "1 bill could not be sent" when it was a shift opening; it now says "1 not sent: see why" and opens the list with the reason. A till without billing rights said "needs the right pos.sell"; now it says what to ask the owner. | ✔️ Fixed |
| 14 | Menu "Most used" | Remembered per computer, not per person: on a shared shop computer a cashier saw the owner's most used screens. | ✔️ Fixed: kept per person, with a test |
| 15 | Dashboard | "System status" (API address, database version, server time) showed to every user. | ✔️ Fixed: owner only. The public health check also shows the database version; checked in the code audit |
| 17 | Dashboard | A user with no role saw an almost empty page with no explanation. | ✔️ Fixed: "You have no role yet… ask the shop owner" |
| 18 | Roles | 82 rights in one long list, each headed by a code (company.view); the owner had to type a role code; built-in roles had no description; a "Code" column. | ✔️ Fixed: rights grouped under 9 shop headings in plain words, code made from the name, a one-line description per built-in role |
| 20 | Change history, Login history | Showed codes ("login_failed", "number_series", "allStores: false"), internal record numbers instead of names, "::1" as the address, a record-type box to type codes into, and a password reset without saying whose. | ✔️ Fixed: plain actions and record names ("Changed · User Arun · Active: no → yes"), "For Arun", "This server", a pick-list |
| 21 | Sizes and colours | Values could not be put in order: a size added later (XS) went after XXL, and that order is used in the size grid, the till and reports. | ✔️ Fixed: ↑ ↓ buttons in the list |
| 22 | Item (style) | Variants were listed L, M, S (by code). | ✔️ Fixed: by colour then size in the list's order, with a test |
| 23 | Item (style) | Every size and colour had to be priced one by one (30 times for a style in 5 sizes and 6 colours). | ✔️ Fixed: "Selling price for every size and colour" on the style; each variant still gets its own price (blueprint 04), with a test |
| 24 | Item form | The HSN hint said "the GST rate per code comes with the GST module" (written before GST was built). | ✔️ Fixed |
| 25 | Brands filter, other pick-lists | A switched-off brand is listed with the active one of the same name, with nothing to tell them apart. | ✔️ Fixed: filters show switched-off records last, marked "(switched off)"; forms for new work leave them out unless already chosen |
| 26 | Item groups, brands, stores, tills | The owner types a code as well as a name; the set-up guide makes codes from names, the other screens do not. | ✔️ Fixed for item groups, brands and stores: the code fills in from the name (ETHNIC-WEAR, ANNANAGAR) and can be changed; tills keep T1, T2 |
| 27 | HSN codes | The list starts empty; the GST return's HSN summary needs a description per code. | ✔️ Partly done (28 October 2026): the official HSN / SAC list of the GST portal (22,609 codes) is built in; the HSN box suggests official codes by code or words, warns about codes not in the list, the shop's own list and GSTR-1 take the official descriptions. ❓ Still yours: fill in each shop type's common codes at set-up (decisions L1) |
| 28 | Sizes and colours | The clothing template has no "Free size" (common for dupattas, sarees, some kurtis) and no XS. | ❓ Your decision: add them to the clothing template? |
| 29 | Every form (67) | A rule about two fields together (66 of them, such as "End date cannot be before start date", "A price is for a customer or a supplier, not both", "Choose a season, groups, brands or items") was shown nowhere: Save seemed to do nothing. | ✔️ Fixed once for all forms: shown at the top of the pop-up, or as a red note, with tests |
| 30 | Seasons, financial year messages | Dates shown as 2026-10-01 instead of 1 Oct 2026. | ✔️ Fixed: every message from the server shows dates as 01 Apr 2026 |
| 31 | Markdowns | Groups and brands are chosen with "Hold Ctrl to choose more than one": hard for most people, impossible on a phone. The preview lists sizes in code order. | ✔️ Fixed: tick boxes for groups and brands; the preview lists sizes in the order of their list (S, M, L, XL) |
| 32 | Markdowns | A markdown made by mistake cannot be withdrawn or ended early; each new price has to be ended by hand on Prices. | ❓ Your decision: add "Withdraw" (before it starts) and "End now"? |
| 33 | Purchase order | A new item's GST rate on a purchase order starts at 0% (it is copied from the item's last purchase, plan 05); the GST rate list (per HSN, built later in plan 08) is not used, so the buyer types 5% on every line of a first order. | ❓ Your decision: start from the GST rate list when the item has never been bought? |
| 34 | Return to supplier after freight | A returned piece leaves stock at its full cost including its share of freight (₹410), but the supplier's debit note clears only the goods (₹400): ₹10 stays in "Goods received not billed" for ever, so that account never comes back to zero. | ❓ Your (or your accountant's) decision: (a) the freight share goes back to "Freight inward" (recommended), or (b) the piece leaves at the supplier's rate and the freight stays in the remaining stock |
| 35 | Accounts on start-up | A closed shift with no bills and no cash was logged as "Posted 1 earlier documents to the ledger" at every start (nothing was posted; the books were right). | ✔️ Fixed: only real postings are counted |
| 36 | Payments, Bank accounts | A new store has no cash accounts until its first till shift, so its cash cannot be chosen on a payment before that. "Account in the chart" is accountant language. | Wording ✔️ fixed ("your list of accounts"). ☐ Low: make the cash accounts when the store is added (touches the accounts set-up; with your approval) |
| 37 | Stock history, Stock on hand, Stock documents | A return showed as "purchase_return"; goods receipts, till bills and freight linked to the stock documents page (wrong page); values showed as 1400.0000 and 14700.00. | ✔️ Fixed: plain names, the right page for each, ₹1,400.00 |
| 38 | Stock count | "Save the draft to see the expected quantities", but a draft cannot be saved until a counted quantity is typed, so even a normal (not blind) count is typed before seeing what is expected. | ✔️ Fixed: on a normal count, "Add all in stock" shows what is in stock now at once; a blind count keeps them hidden |
| 39 | In transit | For an owner with both shops, a transfer shows under "Coming to your stores" while "Sent from your stores" says "Nothing you sent is still in transit". | ✔️ Fixed: someone who looks after every store sees one list; others see "Sent to stores you do not look after" |
| 40 | Reorder suggestions | A returned damaged piece counts as "on order: 1" (expected from the supplier); "Usual supplier: None set" though the item was just bought from one supplier. | ✔️ Fixed: the page explains that on order includes pieces sent back for replacement; with no usual supplier, the last one it was bought from is offered, marked "(last bought from)" |
| 41 | Reorder levels | Says "nothing is ordered automatically yet", which sounds like a missing feature. | ✔️ Fixed: explains that low items appear in Reorder suggestions and nothing is ordered without you |
| 42 | Input credit matching | The switched-off Karnataka GSTIN is offered (same as problem 25). | ✔️ Fixed with 25 (kept for past months, marked and listed last) |
| 43 | Billing counter | A refused shift opening (Arun's) stayed on the till for ever as a red warning: "Try again" always failed and the server never listed it under Sync problems, so no manager could clear it. | ✔️ Fixed: a refused shift opening or cash entry can be removed on the till (a bill never), with a test |
| 44 | Till reports | The till register showed "Cash 2000.00" on a ₹1,597 bill, and "Payments by method" counted the ₹2,000 (same as problem 2). | ✔️ Fixed: "Cash 2000.00, change given 403.00", and payments count the cash kept, with a test |
| 45 | Billing counter, barcodes | A barcode added in the back office after the till's first download never reached the till (it only fetches items whose record changed, and a barcode is its own record), so it did not scan. | ✔️ Fixed: adding or changing a barcode marks its item changed, with a test |
| 46 | Billing counter, scanning | The till refreshes its copy every 15 minutes, so a new item or barcode could not be sold meanwhile ("Nothing found"). | ✔️ Fixed: when a scan finds nothing and the till is online, it fetches the latest changes once and scans again, with a test |
| 47 | Billing counter, gift card and points | "Check" on a gift card reloaded the whole till (the gift card and points rows were forms inside the payment form). The bill was restored, but the payment was lost. | ✔️ Fixed: plain groups with Enter; test that no form sits inside another |
| 48 | Item form, till | The item form said "Maximum discount … unless a manager allows it", but no one can go past it (blueprint 04, plan 06), and the till said only "above this item's maximum of 0.00%". | ✔️ Fixed wording: says what the limit is and where it is set |
| 49 | New shops, discounts | Every item starts with a 0% maximum discount (plan 06), so a new shop cannot give any typed discount until it sets a maximum on each item. | ❓ Your decision: let each shop type's template set a starting maximum (for example 10%)? |
| 50 | Billing counter, small points | The buyer box shows "From the GSTIN: 33" (not Tamil Nadu) and does not fill the name of a saved customer with that GSTIN; with a bill paid fully by gift card the pay screen says "Paid ₹0.00"; after Recall no line is selected, so + and − do nothing until one is clicked. | ✔️ Fixed: state shown by name (Karnataka (29)); a saved customer's GSTIN fills in the name; a bill fully paid by gift card or points says so; after Recall the last line is chosen |
| 51 | Billing counter, open shift | A shift can be opened with no starting cash typed (it becomes ₹0) without a question. | ✔️ Fixed: asks "Starting cash ₹0: is the drawer really empty?" once before opening |
| 52 | Till bills, cancel | "Cancel bill" is offered on a bill whose shift is closed, where it can never work (only a return can). The manager PIN pad there has 1-2-3 on top while the till's keypads have 7-8-9 on top. | ✔️ Fixed: no Cancel on a bill whose shift is closed, with a note to make a return; the manager PIN pad has 7-8-9 on top like the till |
| 53 | Cash flow report | The total is right (−₹2,503, as in the books), but the split is wrong: a till shift's one entry holds sales, GST, card/UPI, cost of goods and points together, and the report shares the cash across all of them, so "Cost of goods sold ₹598.58" and "Stock in hand ₹598.57" show as cash in. Misleading for an owner; the books themselves are right. | ✔️ Fixed (see 60) |
| 54 | Gross profit report | "Quantity sold" counts pieces later returned (Women tops 3) while its sales and cost are after the return (2 pieces); "Sales by group" says 2. | ✔️ Fixed by wording: "Pieces sold (before returns)" where returns are not taken off, "Quantity (after returns)" where they are |
| 55 | Daily summary email | When mail is off it told the shop owner to edit SMTP_HOST in the server's .env file and restart the server. | ✔️ Fixed: "Sending email is not switched on yet … Retail ERP support switches it on" |
| 56 | Balance sheet | "Temporary opening −₹25,000" shows as a minus under what the shop owns until the opening balances are entered. Correct, explained on Opening balances, but alarming on the balance sheet. | ✔️ Fixed: a note next to it explains it and links to Opening balances |
| 57 | Import from Excel | Rows went in without the screens' checks: an 8-digit mobile and a mistyped GSTIN were imported (customers; the same gap for suppliers, items, groups, brands and prices). | ✔️ Fixed: every imported row is checked with the same rules as its screen and fails with the reason ("Mobile: Mobile number must be 10 digits"), with a test |
| 58 | Import from Excel | A list exported from other billing software (headings such as "Party Name", "Contact No", "GSTIN/UIN", "HSN/SAC", "Rate", "Qty") had to be matched by hand, column by column. | ✔️ Fixed: common headings are recognised (a field's own name still wins); any column can still be matched on the screen; with tests |
| 59 | Printing (code audit) | Customer order and alteration slips printed the UTC date: an order at 00:30 on 1 April printed 31 March (the previous financial year). The same in two e-invoice / e-way bill fallbacks. | ✔️ Fixed: Indian date |
| 60 | Cash flow (code audit) | See 53. | ✔️ Fixed in the report: cash shared only over the accounts on the other side, without the stock / cost-of-goods and points pairs; with a test |
| 61 | GST price band (code audit) | The till picks the ₹2,500 clothing band from the price including GST; the limit may be on the value before GST (₹2,400 + 5% = ₹2,520 would wrongly go to the higher rate). | ❓ Your decision, with the official CBIC notification |
| 62 | GST paise (code audit) | Each line gives its odd paisa to CGST, so a bill with many lines can show CGST a few paise above SGST. | ❓ Your decision: split per bill and rate instead (e-invoice and GSTR-1 usually expect them equal) |
| 63 | Rounding tolerance (code audit) | A till day's entry may be up to ₹0.50 out and the difference goes to Rounding without notice, which could hide a mistake. | ❓ Your decision (it is about money): tighten to 1 paisa per bill, or keep ₹0.50 per day |
| 64 | Screens (code audit) | Four hints showed build notes: "(decision 25)", "(decision 21)", "(decision 74)". | ✔️ Fixed |
| 65 | Server image (code audit) | The Docker image ships the test files, sample data and developer tools along with the app (nothing runs them, but they should not be there). | ☐ On the next deploy, with care: copy only the built app and production packages |
| 66 | Copyright lines (code audit) | 13 early database migration files have no copyright line. Changing an applied migration would make the live server refuse to start. | Left as they are on purpose; recorded here |
| 67 | Security (code audit) | Someone given "Users" or "Roles" rights (not Owner) could make themselves Owner, reset the Owner's password and take over the login, or give a role rights they do not have themselves. | ✔️ Fixed: only an Owner can give the Owner role or change an Owner; nobody can give rights they lack; with a test |
| 68 | Security (code audit) | The system health check told any visitor the database version and connection details. | ✔️ Fixed: it now says only "connected" or "not connected"; details go to the server log |
| 69 | Security (code audit) | The one-step shop setup (kept for the tests) could create shops without sign-up's limit of 5 an hour. | ✔️ Fixed: same limit as sign-up |
| 70 | Security (code audit) | A specially made Excel file of a few kilobytes could unpack to gigabytes and stop the server ("zip bomb"). | ✔️ Fixed: files that unpack beyond 50 MB or 500 parts are refused with a plain message; with a test |
| 71 | Security (code audit) | A CSV export could carry an Excel formula (e.g. a customer named "=HYPERLINK(...)") that runs when the file is opened. | ✔️ Fixed on the server and screen exports: such text gets a leading ' ; plain numbers like -120.50 are untouched; with a test |
| 72 | Security (code audit) | A manager of one shop could mark another shop's till problem as solved, and it was not in the history. | ✔️ Fixed: only for tills of your own shops, and kept in the history with the reason; with a test |
| 73 | Security (code audit) | Wrong passwords or PINs sent all at the same moment were not all counted, so the lock after 5 could be dodged. | ✔️ Fixed: counted in the database itself; with a test |
| 74 | Security (code audit) | The web pages sent none of the standard browser protections (another site could show our screens inside its own page to trick a click). | ✔️ Fixed in the app: no framing, no file-type guessing, no address passed to other sites, no camera/microphone/location. ☐ On the next deploy: add HSTS (always HTTPS) in Nginx, and `listen [::]:80` if missing |
| 75 | Security (code audit) | Anyone can lock a person out for 15 minutes by typing their email with wrong passwords 5 times. | Accepted for now (this is how the lock works; the login limit of 20 tries per 10 minutes per connection slows it). ☐ Later: lock per connection as well as per person |
| 76 | Security (code audit) | Sign-up says "An account with this email already exists", so a stranger can learn who has an account. | Accepted (usual practice; sign-up is limited to 5 tries an hour) |
| 77 | Security (code audit) | The app connects to the database as its owner, so the shop-only protection in the database is not applied to it (the app's own checks still apply). | ☐ On the next deploy, with care: a separate database login without owner rights |
| 78 | Report filters (owner's screenshot) | On Cash book and Customer statement, a box with a hint under it (Cash account, Customer) stood higher than From and To. | ✔️ Fixed for every filter row: lined up by the top; tick boxes and buttons level with the boxes; checked on 13 screens |
| 79 | Cash book (owner's screenshot) | It opened on Anna Nagar's cash, which is ₹0 (correct: no cash there yet), not on the shop with money. | ✔️ Fixed: opens on your default store's cash, and after that on the cash account you chose last |
| 80 | Customer statement | The customer box said "Leave empty for none", though a statement needs a customer. | ✔️ Fixed: "…then pick from the list" |
| 81 | Contact form | A short phone number got only "Enter a phone number". | ✔️ Fixed: "Enter your phone number with at least 8 digits, for example 98400 12345" |
| 82 | Confirm email | "One moment while we check your link" stayed on the page after "your email is confirmed". | ✔️ Fixed: a line that is true before and after |
| 83 | Reset password | A link cut short (copied in part from the email) showed nothing at all when saving. | ✔️ Fixed: says the link has expired or been used, with "Ask for a new link"; with a test |
| 84 | Quick search | "cash book", "trial balance" and other report tabs found nothing. | ✔️ Fixed: every tab of Accounts, Till and Purchase reports is found by its own name and opens on that tab |
| 85 | New item | The group's HSN code was used only on saving, unseen on the form. | ✔️ Fixed: it fills in as soon as the group is chosen |
| 86 | New item | An item whose HSN code has no GST rate was saved without a word; the cashier found out at the till with the customer waiting. | ✔️ Fixed: the item screen says "No GST rate is set for HSN 3304 yet, so the till cannot sell this item", with a link |
| 87 | Till top bar | The shift showed as 2026-10-27. | ✔️ Fixed: 27 Oct 2026 |
| 88 | Menu | An owner sees 84 links in 9 sections, all open. | ✔️ Fixed (owner chose folding, decisions L11): groups start folded with their number of screens, the current screen's group stays open, opened groups are remembered; 84 links became 6 for the owner; with tests |
| 89 | Batches | "Number batches automatically" is ticked by default on every new batch item; cosmetics shops usually need the batch number printed on the pack (for recalls). | ❓ Your decision (decisions L12) |
| 90 | Security (library check, 27 October 2026) | Next.js 16.4.0 had two critical holes (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr) that let a stranger run code on the server without logging in, plus high-risk holes in the upload (multer), request (body-parser) and email (nodemailer) libraries: 18 in all. | ✔️ Fixed locally: Next.js 16.4.3, NestJS 12.3.2 (multer 2.5.0, body-parser 2.4.0), nodemailer 10.2.1, Prisma 7.10.1. ☐ **The live server still runs 16.4.0: deploy as soon as possible** |
| 91 | Security (library check) | 3 left, all inside Prisma Studio (a database viewer for developers, never run by the shop): lodash and deepmerge-ts. No fixed Prisma release yet. | ☐ Take the next Prisma release that fixes them |
| 19 | Log in | A switched-off user with the right password is told "Wrong email or password". Deliberately cautious (the check is before the password); a clearer message needs the order of login checks changed. | ☐ Ease-of-use list, low priority |
| 16 | Financial years | "Lock" works at once with no "Are you sure?"; locking the current year by mistake stops all billing. The overlap message shows dates as 2026-04-01. | ✔️ Fixed: locking asks first, and says plainly when it is the current year; dates show as 01 Apr 2026 |
| 8 | Stores list, GST registrations | A store on the company default GSTIN showed "—" instead of the GSTIN it uses; the GSTIN added in the set-up guide got no address (needed on e-invoices). | ✔️ Fixed: shows "(company default)"; the set-up guide copies the shop address |
