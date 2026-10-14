# Open questions

Everything unclear, or needing a business decision by the project owner, grouped by module.
Each item says what is unclear and what decision is needed.

## General

1. **Which stores need offline tills?** The reference system's till has no offline mode (see question 38). How long offline is allowed and what is blocked offline depend on our shops' connectivity. Treated as one question with 38. Decision needed before module 8.
2. **Single company or multiple legal entities?** The reference system supports several companies with separate books. If every store is under one GST registration and one company, several features (inter-company transactions, consolidated statements) can be dropped. Decision needed before module 1 is finalised.

## Module-specific

### Module 1: Company and stores

3. **Store as a record of its own.** The reference system has no real store record; a store is a warehouse plus a cost centre plus tills plus an optional reporting dimension, kept in step by hand. Proposal: one Store record that owns these. Needs owner approval because it changes how permissions and reports are filtered.
4. **Several GST registrations under one company.** If stores sit in different states, each needs its own GSTIN while sharing one set of books. The reference system attaches the GSTIN to the address and picks tax by address, not by company. Confirm whether we need multi-GSTIN at all in version 1.
5. **Rounding method.** The reference system defaults to banker's rounding (half to even). Retail receipts in India conventionally use commercial rounding (half away from zero). Recommend commercial rounding as our only method; confirm.
6. **Financial year auto-creation.** Reference system creates next year automatically three days before year end. Do we want this, or a manual step by the accountant?
7. **Last-in-first-out valuation.** Offered by the reference system; not acceptable under Indian accounting standards for inventory. Recommend not offering it.
8. **Manufacturing warehouses created at setup** (work in progress, finished goods). Recommend not creating them for a retail product.

### Module 2: Items

9. **Price-embedded (weighing-scale) barcodes.** Supermarkets print barcodes that carry the item code and either weight or price. The reference system does not parse these. Decide whether version 1 needs a configurable prefix/weight/price barcode format at the till.
10. **Variant code format.** The reference builds a variant code from the parent code followed by a short code for each attribute value, joined by hyphens. Confirm this is acceptable or whether the owner wants a different code scheme (for example a numeric SKU with the attribute abbreviations only in the name).
11. **Whole-number units.** Should units such as pieces refuse fractions at the till by default? Reference leaves it as a per-unit flag.
12. **Which item fields are dropped?** Manufacturing, asset, subcontracting, deferred revenue, quality inspection and customer-provided-item fields exist on the reference item. Proposal: omit all of them.
13. **Expired batch at point of sale.** Hard block or warning with override role? To be settled in the Inventory and POS modules.

### Module 3: Pricing and promotions

14. **Gift cards with stored value.** The reference system's gift card is a one-use personal coupon, not a stored balance. Retailers usually want sellable gift cards with a balance that can be partly spent. Proposal: treat a gift card as a prepaid liability (sell it as a non-stock item posting to a gift-card liability account; redeem it as a payment method). Decide if version 1 needs this.
15. **Loyalty liability accounting.** Points earned create no accounting entry in the reference system; only redemption posts an expense. Accountants may want an accrued liability at earn time. Decide the policy.
16. **Points on returns.** Reference re-computes earned points net of returns but never refunds redeemed points. Decide what happens to redeemed points when a bill is returned.
17. **Conflicting rules at the till.** Reference blocks the sale when two rules tie. Proposal: never block at the till; pick the rule that gives the customer the larger benefit and log the tie. Owner to confirm.
18. **Cumulative and mixed rules offline.** They need sales history; decide whether offline tills simply skip them.
19. **Manual discount approval.** Reference caps discounts per item but has no manager-PIN style override. Decide whether a manager approval flow is needed for discounts above a store limit.

### Module 4: Customers

20. **Duplicate detection by mobile number.** Reference only de-duplicates by name (adds a suffix). Retail needs mobile number as the practical unique key at the till. Decide: block, warn, or merge on duplicate mobile.
21. **Address-level GSTIN.** The reference core keeps one tax id on the customer; a GSTIN per address is needed for B2B customers with branches in several states. Proposal: GSTIN on each address, with the customer-level one as default.
22. **Credit sales at the till.** Decide whether tills may bill credit customers at all in version 1, and if so whether the credit check blocks the sale or only warns the cashier.
23. **Sales team / commission and portal users.** Present on the reference customer; propose dropping both from version 1 unless the owner sells through commissioned agents.

### Module 5: Suppliers

24. **Supplier scorecards in version 1?** Useful for chains with many suppliers, heavy for a single shop. Proposal: keep the data model (measures are derived from receipts anyway) but ship the rating screen later.
25. **Common party (customer who is also a supplier).** Reference can link the two records and net balances. Decide if needed.
26. **Portal users for suppliers.** Propose dropping from version 1.

### Module 6: Purchasing

27. **Free goods valuation.** Scheme quantities arrive at zero cost, so later sales of them show 100% margin and the paid units carry full cost. Alternative: spread the invoice value across paid and free units. Decide the policy (affects margin reports).
28. **Quotation requests and supplier quotations.** Propose leaving them out of version 1; keep a free-text field on the order for the supplier's quotation number.
29. **Quality inspection.** Out of scope per instructions, but receipts can be gated by it. Decide whether simply recording who checked the goods and when is enough.
30. **Rejected goods value.** Reference defaults to zero value for rejected stock. Confirm this is acceptable (rejected goods are not an asset until accepted).
31. **Receipt without order.** Decide the default for our shops (allow, to cope with perishable deliveries, or require orders for control).

### Module 7: Inventory

32. **Negative stock at the till.** Retail tills cannot stop a sale because a receipt was keyed late. Proposal: allow negative stock globally, with a daily report of negative balances and automatic correction when the receipt is posted. Confirm.
33. **Valuation method for version 1.** Proposal: moving average only (simpler, no queues to store, fewer re-valuation surprises), with FIFO as a later option. Owner to confirm, since it affects margin reports.
34. **Batch-wise valuation.** Keep per-batch cost (more accurate for price changes) or value batch items at moving average? Proposal: moving average per item-warehouse for simplicity.
35. **Re-valuation of past sales.** Back-dated receipts rewrite the cost of later sales. Decide whether to allow back-dating at all for store users (proposal: only the accountant role, within the current month).
36. **Put-away rules, inventory dimensions, stock closing snapshots.** Proposal: drop put-away and dimensions from version 1; keep a simple month-end stock lock.
37. **Two-step transfers.** Needed when goods spend a day in a van between stores. Decide whether all inter-store transfers go through transit or whether one-step is allowed for nearby stores.

### Module 8: Point of sale

38. **Offline till.** The reference system has no offline mode at all; the till is a web page that needs the server for every action. Our product needs a decision: (a) online-only with a local fallback that queues bills, (b) a true local-first till that syncs. This drives the whole POS architecture (local catalogue, local numbering with a till prefix, conflict rules for stock, customer creation offline). Highest-priority open question.
39. **Per-sale posting versus day-end consolidation.** Reference offers both. Consolidation gives fewer ledger lines and faster tills but stock and accounts lag until closing. Proposal: post stock per sale (so stock is always right across tills) and consolidate only accounting at day-end. Confirm.
40. **Supervisor override.** The reference only has a till-level switch allowing price and discount changes. Retail needs a supervisor PIN or login prompt for overrides, no-receipt returns and voids. Decide the approval UX.
41. **Cash denominations and drawer events.** Reference records one counted amount per method; no denomination count, no pay-in/pay-out (petty cash) during a shift. Decide whether to add denomination counting and drawer pay-in/out records.
42. **Exchange flow.** Reference handles exchanges as a return plus a new bill. Decide whether a single exchange screen that nets the two is needed.
43. **Receipt content and GST rules at the till.** Simplified tax invoice thresholds and B2C e-invoice exemptions to be confirmed from official sources in the Tax module.
44. **Payment integrations.** Card terminal and UPI collect-request integration points to be covered in Integrations; decide which providers version 1 must support.

### Module 9: Sales

45. **Quotations in version 1.** Wholesale customers ask for quotes; retail-only shops never do. Decide whether quotations ship in version 1 or the order alone suffices.
46. **Pick lists, packing slips and delivery trips.** Useful for a distribution warehouse; overhead for a shop doing a few home deliveries. Proposal: deliveries and simple driver and vehicle details in version 1; pick lists and trips later.
47. **Shipping rules.** Keep as a simple delivery charge line (fixed or by order value); decide whether weight-based slabs and country filters are needed.
48. **Sales team, commissions, sales partners and targets.** Propose dropping from version 1 (noted in Customers too).
49. **Invoice before delivery.** Allowed in the reference; decide whether B2B flow should force delivery before invoicing for stock items (cleaner stock/revenue matching).

### Module 10: Accounting

50. **Immutable ledger.** The reference offers either a reversal dated today or marking the old lines as cancelled. Indian audit practice favours an immutable ledger. Proposal: immutable by default, no option. Confirm.
51. **Two ledgers (general and payment).** Reference keeps a separate settlement ledger for receivables and payables. Decide whether to replicate this or derive outstanding amounts from the general ledger alone (simpler, slower on large books).
52. **Budgets, accounting dimensions, finance books, exchange rate revaluation, deferred revenue.** Proposal: cost centre per store only; budgets and the rest deferred to a later version.
53. **Bank statement import formats.** Decide which Indian bank CSV/Excel formats and which aggregator (if any) version 1 must read.
54. **Card and UPI settlement reconciliation.** Acquirer payouts are net of commission and batched; decide whether to build a settlement-matching screen (gross bills versus net payout plus fees) or rely on manual journals.
55. **Chart of accounts starter.** Proposal: ship a retail-specific India chart (GST heads per rate, card and wallet clearing per acquirer, cash per store, cash short/over, discount allowed, gift-card liability, loyalty expense). Owner to review the list.

### Module 12: Tax (GST)

56. **Rate notifications.** Rates in the blueprint follow the 22 September 2025 restructuring as announced by PIB and the GST Council. The gazette notifications themselves were not read; a tax consultant must confirm the rate schedule and the tobacco transition before release.
57. **E-invoice threshold.** Portal pages disagree (5 crore versus older 10 crore text). The 5 crore figure from August 2023 is used; confirm with a consultant.
58. **E-way bill validity.** Portal states one day per 200 km; older CBIC FAQ and rules tables give other figures. Use the portal value; confirm.
59. **B2C HSN summary.** Optional for smaller sellers at the time of the cited advisory; a pending phase may have made it mandatory. Confirm current portal behaviour.
60. **Consolidated daily invoice for sales under 200.** Legally allowed; proposal: still record every bill at the till and treat the daily consolidated invoice as a print/report only. Confirm.
61. **Free goods and samples.** Whether a taxable value must be declared on free supplies is a consultant's call.
62. **TDS/TCS.** Income-tax withholding exists in the reference system. Decide whether version 1 needs it (only relevant above turnover thresholds).
63. **Direct portal integration.** Decide whether to integrate with an e-invoice/e-way bill provider (GSP) in version 1 or export JSON files for manual upload.
64. **Multi-GSTIN.** Stores in several states mean several registrations and separate return data; ties to question 4.

### Module 13: Reports and dashboards

65. **User-built list reports.** The reference lets any user build and save list reports; decide whether version 1 offers a report builder or only the fixed catalogue plus export.
66. **Recommended reports not in the reference** (hourly sales, top/bottom sellers, shrinkage, loyalty liability, sell-through, stock cover). Owner to prioritise.
67. **Digest and scheduled reports by WhatsApp/SMS** in addition to email; decide channel for store owners.

### Module 14: Users, roles and permissions

68. **Fast cashier switching.** Reference requires a full login per user. Tills need quick PIN-based switching between cashiers on one terminal without logging out. Decide the design (PIN per user, badge scan).
69. **Workflow engine versus approval limits.** Reference has both. Proposal: a simple approval-limit model (value and discount ceilings with an approver role) for version 1; full configurable workflows later.
70. **Field-level hiding of cost and margin.** Decide which fields are sensitive (cost price, valuation, margin, supplier) and must be hidden from cashiers and store staff.
71. **Retail role set.** The proposed role table needs owner approval.
72. **Transaction wipe tool.** Useful before go-live, dangerous after. Decide whether to ship it, and if so, lock it after the first period closing.

### Module 15: Printing and documents

73. **Label designer.** Reference supports raw printer commands but has no item price/barcode label designer. Retail needs one (label sizes, MRP, barcode symbology, batch and expiry). Decide scope.
74. **E-receipts.** Decide channels (SMS, WhatsApp, email) and whether a paper receipt becomes optional.
75. **Store-specific letterheads and addresses.** Confirm documents should show the store address and (if separate) the store GSTIN rather than the head office.
76. **MRP printing.** Packaged goods in India carry an MRP; decide whether MRP is an item field printed on receipts and labels and validated against the selling price.

### Module 16: Data import and export

77. **Source systems.** Which systems are our customers migrating from (Tally, Marg, Busy, spreadsheets)? Ready-made mappings for the common ones would cut go-live time. Decide which to support.
78. **Online sheet import.** Reference can read a public online spreadsheet link; public links leak data. Proposal: file upload only.

### Module 17: Integrations

79. **Which integrations ship in version 1?** Candidates: one card/UPI terminal provider, one payment-link gateway, SMS and WhatsApp for e-receipts, one GST Suvidha Provider for e-invoice and e-way bill, one marketplace or own web store, a bank aggregator. The reference keeps all of these outside its core. Owner to pick and rank.
80. **Webhook retries.** Reference logs failures but does not retry automatically. Decide whether to add retries with back-off.
81. **Local device helper at the till** (receipt printer, cash drawer, customer display, weighing scale, label printer). Needed for any serious till; not in the reference. Decide the approach (browser device APIs, a small local agent, or a native till app).
