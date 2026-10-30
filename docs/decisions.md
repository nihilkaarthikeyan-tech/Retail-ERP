# Decisions — Version 1 Baseline

This file records the agreed answers to the 81 open questions in `docs/blueprint/99-open-questions.md`.

**Rules for using this file**

- Where this file and the blueprint differ, **this file wins**.
- Items marked **OPEN** are not decided yet. Do not build those parts until the project owner records a decision here.
- Questions 43 and 55–64 were first marked **CA APPROVAL REQUIRED**. **Changed 22 October 2026:** there is no separate accountant approval step. GST settings and rates apply as soon as they are saved, and bills are never provisional. The Chartered Accountant may still review the settings, but nothing waits for it. See the change log.
- Any later change to a decision is recorded in the change log at the end, with the date and the reason.

Baseline agreed: 14 October 2026.

---

## Launch scope (version 1)

Build **only** what is in the launch column. Items in the "later" column are **deferred**: do not build them, even where an answer below describes how they should work.

| Launch version (build now) | Later updates (deferred) |
| --- | --- |
| Users, roles, shops, audit history | — |
| Products, prices, barcodes | — |
| Customers and suppliers | Wholesale quotations (45) |
| Buying stock and receiving goods | Weighing-scale barcodes (9), unless the first sector is grocery |
| Stock, inter-shop transfers, stock counts | Bank statement matching (53) |
| Billing counter with offline queue, returns, exchange, shift close, card/UPI payment recording | Card/UPI settlement matching (54) |
| Basic accounts | Direct e-invoice provider connection (63); launch with JSON/Excel export only |
| GST invoices and GST return data | WhatsApp receipts (67, 74), label designer (73) |
| Key daily reports, Excel import | Tally, Marg and Busy imports (77) |
| Loyalty points and reloadable gift cards (14–16; added 21 October 2026, plan 13) | |

---

## Still OPEN (business decisions for the project owner)

| Topic | Questions |
| --- | --- |
| ~~First retail sector~~ **Decided 28 October 2026:** fancy, clothing and general shops | — |
| ~~Which shops need true offline billing~~ **Decided 28 October 2026:** none at launch | 1 / 38 |
| ~~Number of companies and GST registrations~~ **Decided 28 October 2026:** one company and one GSTIN per shop at launch (several stay possible) | 2, 4, 64 |
| ~~Weighing-scale barcodes~~ **Decided 28 October 2026:** deferred (no grocery at launch) | 9 |
| Card terminal and UPI providers | 44 |
| Bank statement formats | 53 |
| Old software to import from | 77 |
| ~~Final list of launch integrations~~ **Decided 28 October 2026:** receipt printer, cash drawer, UPI and WhatsApp bills (WhatsApp built after launch) | 79 |
| ~~Points from the launch check~~ **Decided 28 October 2026:** all recommendations accepted | L1–L12 below |

### Decided: points from the launch check (27 October 2026)

Found while testing every screen and auditing the code before launch (`docs/launch-check.md`, problem numbers in brackets). The owner decided all twelve on 27 and 28 October 2026 (see the change log), and all are built.

| No. | Topic | The question | Recommendation |
| --- | --- | --- | --- |
| L1 | HSN codes (27) | The HSN list starts empty, but the GST return's HSN summary needs a description per code. Fill in the common codes of each shop type at set-up, with the official CBIC descriptions? | **Partly decided 28 October 2026:** the official HSN / SAC list of the GST portal is built in (owner asked for it). Decided 28 October 2026: each shop-type template also adds its common codes to the shop's own list at set-up |
| L2 | Sizes (28) | The clothing template has no "Free size" (dupattas, sarees, some kurtis) and no XS. Add them? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes |
| L3 | Markdowns (32) | A markdown made by mistake cannot be withdrawn or ended early; each new price is ended by hand. Add "Withdraw" (before it starts) and "End now"? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes |
| L4 | Purchase order GST (33) | An item never bought before starts at 0% GST on a purchase order. Start from the GST rate list (per HSN) instead? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes |
| L5 | Freight on goods returned to a supplier (34) | A returned piece leaves stock at full cost including its freight share, but the supplier's debit note clears only the goods, so a few rupees stay in "Goods received not billed" for ever. (a) The freight share goes back to "Freight inward", or (b) the piece leaves at the supplier's rate and the freight stays in the remaining stock? Ask the accountant if unsure. | **Decided 28 October 2026 (owner accepted the recommendation).** (a) |
| L6 | Starting discount limit (49) | Every item starts with a 0% maximum discount, so a new shop cannot give any typed discount until it sets one per item. Let each shop-type template set a starting maximum (for example 10%)? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes, 10% for clothing and fancy shops |
| L7 | GST price band for clothing (61) | The till decides the ₹2,500 clothing band on the price including GST; the official rule may be on the value before GST. Which one? Answer from the official CBIC notification. | **Decided 28 October 2026 (owner accepted the recommendation).** the band uses the value **before GST**, after any discount, per piece. Source: CBIC GST Rates FAQ, question 33 ("sale value … refers to the transaction value"), and CGST Act section 15 (the transaction value does not include the GST itself). A till price includes GST, so each band is tried with its own rate taken out; a price that fits neither (₹2,625.01 to ₹2,950 for the ₹2,500 band) takes the higher rate, so the tax is never too low |
| L8 | CGST and SGST paise (62) | Each line gives its odd paisa to CGST, so a long bill can show CGST a few paise above SGST. Split per bill and rate instead, so they are always equal? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes: e-invoice and GSTR-1 usually expect them equal |
| L9 | Rounding at the till (63) | A till day's accounts entry may be up to ₹0.50 out, and the difference goes to Rounding without notice, which could hide a mistake. Tighten to 1 paisa per bill, or keep ₹0.50 per day? | **Decided 28 October 2026 (owner accepted the recommendation).** Tighten to 1 paisa per bill |
| L10 | Cash accounts of a new store (36) | A new store gets its cash accounts only at its first till shift, so its cash cannot be chosen on a payment before that. Make them when the store is added? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes |
| L11 | The menu on the left (88) | Every screen the person may use is listed: for an owner, 84 links in 9 sections, all open. Keep it, or fold the sections? | **Decided 27 October 2026: fold** (built). "Most used" and the section of the screen you are on stay open; the rest fold to one line each with the number of screens; a section you open stays open on that computer; quick search (Ctrl+K) still finds every screen and report tab |
| L12 | Batch numbers for cosmetics (89) | Every new batch item starts with "Number batches automatically" ticked. Cosmetics shops usually record the batch number printed on the pack (for recalls). Should the cosmetics template start with it off? | **Decided 28 October 2026 (owner accepted the recommendation).** Yes: off for cosmetics, on for the rest |

---

## General

**1 / 38. Offline billing.** Online-first billing counter with a **local offline queue**: if the connection drops, bills are saved on the till and sent to the server when it returns. Full offline selling (local-first) only for shops with genuinely unreliable internet, because it makes syncing, stock and offers much more complex. Which shops need it: **decided 28 October 2026: none at launch**; every shop uses the offline queue.

**2. Companies.** One legal company = one company and one set of accounts. Shops are branches within it. Create a separate company only where the business is legally separate.

## Company and stores

**3.** Yes. Each shop is one record that owns its stock, tills, users and reports.

**4.** Design for **multiple GSTINs from the start**, even if only one is active initially.

**5.** Normal commercial rounding: ₹0.50 and above rounds up.

**6.** Create the next financial-year structure automatically. Only the accountant may open or lock a year.

**7–8.** No last-in-first-out valuation. No factory-style stock locations.

## Items

**9.** Weighing-scale barcodes: support them if the first sector sells grocery, produce, meat or loose goods; otherwise defer. **Decided 28 October 2026: deferred**; the first sectors are fancy, clothing and general shops.

**10.** Readable variant codes (for example `SHIRT-RED-M`), plus a separate barcode.

**11.** Block fractions for piece-based products. Allow fractions only where the unit is weight, length or volume.

**12.** Remove factory and asset product details.

**13.** Block expired batches completely. **No manager override** for food, cosmetics or medicines.

## Pricing and promotions

**14.** Reloadable gift cards: **decided 21 October 2026** — in scope as an optional module (plan 13): prepaid cards held as a liability, reloadable, usable in parts, 12-month validity by default.

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

**43.** (Was "CA approval required"; no separate approval step since 22 October 2026.) GST receipt and invoice layouts are configurable. Required fields include supplier GSTIN, unique serial number, date, item and HSN, quantity, taxable value, tax rate and tax amounts; further fields apply to B2B and inter-state invoices. Source: [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html).

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

**55.** (Was "CA approval required"; no separate approval step since 22 October 2026.) Start with a standard India-retail chart of accounts, ready to use as soon as the company is set up.

## Tax (GST)

Questions 56–64 were first marked "CA approval required". Since 22 October 2026 there is no separate approval step: GST settings and rates apply as soon as they are saved.

**56.** Never hard-code GST rates. Keep an effective-dated HSN tax master (no separate approval step; see above). Major rate changes took effect from 22 September 2025; the applicable rate remains product/HSN-specific. Source: [GST Council release (PIB)](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555&lang=2&reg=3).

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

*What is built (for the owner to note):* the daily summary email is built, but it starts **switched off** for every shop. The Owner switches it on and picks who receives it in Settings. This differs from "by default" above; tell us if it should start switched on.

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

**79.** Priority: payment terminal and UPI, receipt printer and cash drawer, SMS/WhatsApp, e-invoice, bank imports. Defer marketplace and online-store integration unless it is already a key sales channel. Final launch list: **decided 28 October 2026: receipt printer, cash drawer, UPI payment recording and WhatsApp bills** (WhatsApp after launch, plan first).

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
| 2026-10-18 | 43, 55–64 | GST module may be built now from the blueprint and official government sources; bills stay provisional and no real shop uses GST until the CA approves the GST settings | Owner wants GST ready; the CA reviews before go-live instead of before building |
| 2026-10-18 | — | Design principle added to CLAUDE.md: one common core for all businesses; everything that differs is a setting with a sensible default, filled in by shop-type templates | Owner: one product for all retail shop types, no per-industry versions |
| 2026-10-18 | 43, 56–64 | Owner approved `docs/plans/08-gst.md`: GST core built once from official sources, everything that differs as settings; business tax invoices at the till only; GSTR-1 as Excel and portal JSON; e-invoice and e-way bill as portal files with response import, provider connection later (63) | GST needed before any shop goes live; CA approves the settings before production use |
| 2026-10-21 | — | Owner approved `docs/plans/12-setup-modules-settings.md`: core modules always on, optional modules switched on or off per company (hiding never deletes data), shop-type templates, step-by-step setup, getting-started checklist, one settings centre; existing companies start with every optional module on; AI setup helper later | One product for every retail shop type, simple for each |
| 2026-10-21 | 14, 15, 16 | Owner approved `docs/plans/13-loyalty-gift-cards.md`, bringing loyalty points and gift cards into scope as optional modules: points kept as a liability (15), returns reverse earned and restore spent points (16); gift cards decided (14): reloadable prepaid cards held as a liability, no GST at sale and GST on the goods when spent (CA to confirm); starting values ₹100 = 1 point, 1 point = ₹1 | Clothing and fancy shops expect both |
| 2026-10-22 | 43, 56–64 | No separate accountant approval step for GST: GST settings and rates apply as soon as they are saved; new bills are never provisional; the Owner switches the tills live without any GST approval; GST rates can be edited (every change kept in the history; saved bills keep their own rate); the "Approve GST rates" right is removed. Bills saved as provisional before this date keep that mark as history | The GST rules come from official government sources; the owner wants the GST module production ready now |
| 2026-10-22 | — | Owner approved `docs/plans/14-saas.md`: the Retail ERP is offered as a service (SaaS) at retailerp.52digit.com: landing page, self sign-up with email confirmation, each shop's data kept strictly apart (server rule plus database row-level security), a Rademics platform admin screen; 14-day free trial with "Contact us" (no online payment yet); name stays "Retail ERP"; email service decided before launch | Many shops on one system |
| 2026-10-23 | — | Owner asked for "Download all my data": the Owner downloads one zip with a CSV file per list of their own shop (row-level security keeps it to that shop); passwords, PINs and sessions left out; recorded in the history. Changes no money, stock or tax, so no separate plan | Owners trust a system more when they can take their data with them any time |
| 2026-10-23 | — | The product's look is "F" (owner's choice after comparing six directions and real retail software sites): white pages, black type, one blue for actions, thin lines, pill buttons, Geist type; dark mode in soft charcoal with white main buttons; the same look on the landing page, login, sign-up and inside. Marketing pages show a made-up sample shop, never real names or test data. Six ease-of-use improvements built the same day (quick search, folding menu with most-used screens, "Needs your attention", short saved notes, helpful empty lists, one page header) | Earlier designs looked machine-made and untrustworthy to the owner; this one reads as a real product |
| 2026-10-26 | — | Owner asked for "Forgot password?" and email confirmation: one-time emailed links (password 30 minutes, confirm 7 days, three an hour at most, only a hash kept); a reset ends every session and is followed by a "your password was changed" email; the reset page never tells whether an email has an account; existing users count as confirmed; contact-form messages are emailed to editor.publicationmart@gmail.com; mail is sent from no-reply@rademics.ai (Gmail until its password is set) | A shop owner locked out has no other way back in; the standard for any login |
| 2026-10-27 | L11 | The menu on the left starts folded: "Most used" and the section of the current screen stay open, every other section is one line with its number of screens, and a section the person opens stays open on that computer | An owner saw 84 links in 9 open sections; most shopkeepers use a handful of screens |
| 2026-10-28 | L1 (part) | The official HSN / SAC list of the GST portal (HSN_SAC.xlsx, published 26 October 2026) is built in, the same for every shop: codes and descriptions only, never rates. The HSN box suggests official codes by code or by words and warns (does not refuse) when a code is not in the list; the shop's own list and the GSTR-1 HSN summary take the official description when the shop gave none | Owner asked for it; fewer wrong HSN codes on bills and returns |
| 2026-10-28 | — | Typing checks: mobile numbers 10 digits starting 6–9; a customer's or supplier's PIN code must be in the address's state (India Post's first-digit zones, so a genuine address is never refused); a supplier's PAN shown as wrong next to its box when it does not match the GSTIN | Owner asked for them |
| 2026-10-28 | — | Plan 15 approved and built: GSTINs of customers and suppliers are checked with the GST network through gstinapi.in (provider switchable); a cancelled, suspended or unknown GSTIN is warned about but never refused; checked again every 90 days at night (owner may change, 30–365); one Rademics key on the server only | Owner: proceed and launch as soon as possible, following the recommendations |
| 2026-10-28 | L1–L12, 1/38, 9, 79, sector | Owner accepted every recommendation: L1 shop-type templates add their common HSN codes; L2 "Free size" and "XS" for clothing; L3 markdowns can be withdrawn before they start and ended early; L4 a purchase order line starts at the GST rate list's rate; L5 a returned piece's freight share goes back to "Freight inward"; L6 clothing and fancy templates start items at a 10% maximum discount; L7 the ₹2,500 clothing band is measured before GST (CBIC FAQ 33, CGST Act s.15); L8 CGST and SGST split per bill and rate so they are equal; L9 till rounding at most 1 paisa per bill; L10 cash accounts made when a store is added; L12 cosmetics starts with manual batch numbers. First sectors fancy, clothing and general; no full offline billing; one company and GSTIN per shop at launch; weighing scales deferred; launch connections receipt printer, cash drawer, UPI recording, WhatsApp bills | Owner: launch as soon as possible |
| 2026-10-28 | Audit 4 (T1–T15) | Owner accepted every recommendation of GST audit 4, each from official sources (IGST Act s.10 and s.7(5)(b), CGST Act s.10, s.15, s.16, s.31, s.34, CGST Rules 46, 46A, 49, 52, 53, 55, GST portal advisories): T1 a buyer without a GSTIN taking goods at the counter is taxed by the shop's state (IGST s.10(1)(ca) is not yet in force); T2 a "deliver to someone else on the buyer's behalf" choice makes the buyer's own state the place of supply (s.10(1)(b)); T3 a composition shop cannot sell to another state (s.10(2)(c)); T4 delivery charges take the rate of the goods (composite supply, s.8(a)); T5 no "exempt buyer" (exemption follows the goods), only SEZ buys without tax; T6 SEZ supplies with IGST or without tax under LUT, always inter-state (s.7(5)(b), s.16); T7 a credit note after 30 November of the next year (or the annual return) refunds the customer but does not reduce GST (s.34(2)); T8 a till return to a walk-in asks the customer's name and state (Rule 53(1A)(f)); T9 a return without the original bill is a return note without GST reduction (Rule 53(1A)(g)); T10 exempt and taxable goods: invoice-cum-bill of supply for unregistered buyers (Rule 46A), separate documents for registered buyers (s.31(3)(c)); T11 input credit only when in the imported GSTR-2B (s.16(2)(aa)) and not after the s.16(4) limit, with a reminder for suppliers unpaid after 180 days (Rule 37); T12 buy-one-get-one shares the price over both pieces (CBIC circular, checked first); T13 composition quarterly statement (CMP-08 figure); T14 reverse-charge self-invoice and payment voucher (s.31(3)(f),(g), Rule 52); T15 months can be marked as filed; bills arriving later go into the next open month's GSTR-1 | Owner: "accept all … seek the official govt platforms if any doubt" |
| 2026-10-29 | Audit 5 (C1–C9) | Owner accepted every recommendation of the billing counter audit: C1 the till warns after 24 hours offline and stops billing after 48 hours; C2 offline past midnight the till carries on into the next day on the open shift (bills dated by their sale time, flagged), and closes and counts once back online; C3 a shift cannot close while a bill on the till could not be sent; the office can post such a bill into its shift with a flag; C4 a No-sale / open drawer button needs a manager PIN, and every drawer opening is recorded; C5 cash out above a set amount (default ₹2,000) needs a manager PIN; C6 the Receipt copies setting works (0 = no automatic print, 1–3 copies); C7 the opening float is suggested from the last close's counted cash; C8 a blind count setting (count before seeing the expected cash), off by default; C9 the Till Helper asks a network printer whether it has paper and tells the cashier (a Windows-shared USB printer cannot report it) | Owner: "Accept all" |
