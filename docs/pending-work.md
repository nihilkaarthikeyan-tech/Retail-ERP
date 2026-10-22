# Pending work

Things agreed to do later, after the launch modules are complete.
Deferred features from the launch scope are listed in `docs/decisions.md`; this file holds the rest.

---

## 0. Roadmap agreed with the owner (16 October 2026)

To build, in this order. Each money, stock or tax item gets a plan in `docs/plans/` approved by the owner first.

**First: a smooth start for a new shop (our own design)**
**DONE 21 October 2026 (plan 12): guided setup, modules on and off, shop types, getting-started checklist, settings centre.** Still to do from it: the AI "Describe your shop" helper (later, by owner decision); the owner reviews the 75 proposed new settings in `docs/settings-inventory.md`; screens for the security settings, state e-way limits and ageing bands (shown read-only today); default shelf-life and warranty settings for the cosmetics and mobiles shop types (need a schema change).

**NEXT after GST (owner, 18 October 2026): one system, made to fit each shop.** The approach: one complete system for every business; a new shop first goes through the setup wizard, which asks only what the shop alone knows and then configures the system for that shop; afterwards every module has its own easy settings so the shop can adjust it to how it works.

- **Review and improve the setup wizard:** check whether the current one-page setup is good enough; make it step by step with a shop-type question; consider an optional AI helper that asks "tell me about your shop" and suggests the set-up for the owner to confirm (AI only suggests; the rules and money and tax set-up stay fixed and checked).
- **A settings centre for every module, user-friendly:** one place, grouped by module (company and shops, items and catalogue, prices and offers, customers, suppliers and buying, stock, billing counter, GST, accounts, reports, printing and labels, users and rights), plain words, a sensible default for every setting, a short explanation next to each, and a "reset to the shop type's default" option. First list every setting each module already has and what more each module should offer (GST is the example: scheme, filing frequency, turnover band, HSN digits, invoice layout, e-invoice, e-way bill limits).
- **Shop-type templates** fill in all the settings at setup (fancy, clothing, footwear, cosmetics, mobiles, general), and hide the menus a shop does not need.
- **Modules on and off (owner, 21 October 2026):** core modules are always on (users, items, stock, billing counter, customers, suppliers, accounts, GST, reports). Optional modules can be switched on or off by the shop: sizes and colours, batches and expiry, serial numbers, purchase orders, customer orders, alterations, sale-or-return, home delivery, salesperson, offers and markdowns, transfers between shops, e-invoice, e-way bill, Tally export (later loyalty and gift cards). The wizard switches them on from the shop type, or an optional AI helper suggests them from a plain description for the owner to confirm. Settings has a "My modules" list with on/off switches and one line on each. Switching off only hides a module and never deletes data; the owner is warned when something is still in use (for example open customer orders); modules that need another switch it on automatically.

0. **Guided first-time setup:** step by step with Back and Next (owner → company → GST → shop → shop type → done) instead of one long page; the **shop type** chosen here switches on only the features that shop needs (see section 1); then a **getting-started checklist** on the dashboard until finished — add tills and payment methods, import items from Excel, load opening stock, add staff, set the letterhead, make a test bill, set the go-live date — each step linking to its screen and ticking itself off when done.

**One system for many shops (SaaS), plan 14: approved 22 October 2026** (`docs/plans/14-saas.md`).
- Done 22 October 2026: every record belongs to a shop and codes are unique per shop; the database itself shows each shop only its own rows (row-level security); sign-up, the setup wizard for the signed-up owner, login across shops, a switched-off shop cannot log in; nightly jobs run shop by shop; clearing trial data clears only the shop's own data; landing page with "Contact us / book a demo"; break-in tests (module 14).
- Done 22 October 2026: the Retail ERP admin at /admin (its own login; every shop with owner, trial, use; switch a shop off or on with a reason kept in the shop's history; the contact messages); sign-up records a 14-day trial end date.
- Still to do: email confirmation at sign-up and "Forgot password?" (waiting for the email service decision); what happens when a trial ends (today the admin switches the shop off by hand); deploy to retailerp.52digit.com and remove the temporary block on /setup.

**Must have before a real shop goes live**
1. **GST (module 8): BUILT 19 October 2026** (`docs/plans/08-gst.md`); production ready since 22 October 2026 (no separate approval step: GST settings and rates apply as soon as they are saved). Checks to do with the first real shop's data: the GSTR-2B and portal JSON file layouts against real portal files; one real GSTR-1 upload; the price band measured on the GST-inclusive price per piece; IGST for a walk-in registered buyer from another state; the GSTIN check-character rule; the bill-of-supply declaration wording; on transfers between GSTINs, input credit at sending and valuation at stock cost; how blocked tax is spread when a bill covers part of a receipt line. Not built: cess at the till, outward debit notes, e-way bills for returns to suppliers, the bulk e-invoice cancellation file.

**Soon after**
2. **Loyalty points and gift cards** (decisions 14–16): **BUILT 21 October 2026** (`docs/plans/13-loyalty-gift-cards.md`). Still to do from it: the gift card settings "a card lasts 12 months" and "returns go back on the card" are fixed today (making them changeable needs two new columns, a schema change); a reload does not extend a card's expiry (owner to confirm); the browser's print window shows a sold card's number without a barcode (the Till Helper prints the barcode); a gift card sale goes to Tally as a Journal voucher; when a return takes back points the customer has already spent, only what is left is taken and the bill is flagged "points_short" (owner to confirm). Built as: no GST on selling a card and GST on the goods when it is spent; points spent are a payment (GST on the full bill), not a discount.
3. **WhatsApp or SMS bills and offers** (decisions 67, 74, now wanted).
4. **Matching card and UPI settlements** against bank deposits (decision 54, now wanted).
5. **Small gaps:** reopening a closed shift, emailing a bill, customer reports (credit position, inactive customers), stock reports (on hand plus on order, shortages).

**Later, only if needed**
6. **Quotations** for wholesale and bulk buyers (decision 45).
7. **Bank statement matching** (decision 53).
8. **Customer display and weighing scale** (decisions 9, 81).
9. **Label designer** (decision 73).
10. **Importing from Tally, Marg or Busy** (decision 77).

---

## 1. Shop type and feature switches (new idea, not in the blueprint yet)

**Agreed:** build after everything else is finished (owner, 16 October 2026).

**Why:** every shop sees the same screens today. Sizes and colours, batches and expiry, and serial numbers
appear as tick-boxes on every item, switched off by default. A fancy store never needs them, but still sees them.

**Idea:** when a shop is set up, the owner picks a **shop type**. Only the features that type needs are switched on;
the rest are hidden from menus, forms, columns and reports.

| Shop type | Switched on | Hidden |
| --- | --- | --- |
| Fancy and gift | Barcodes, labels, offers | Sizes and colours, batches, serial numbers |
| Clothes and footwear | Sizes and colours | Batches, serial numbers |
| Cosmetics | Batches and expiry | Sizes and colours, serial numbers |
| Mobiles and electronics | Serial numbers and warranty | Sizes and colours, batches |
| General or mixed | Everything | Nothing |

- Same product underneath for every shop; the shop type only changes what is shown.
- The owner can switch any feature on or off later in settings (for example a fancy store that starts selling dresses).
- Changes screens only, never prices, stock or tax.

**Before building:** add it to the blueprint or `docs/decisions.md`, write `docs/plans/<module>.md` and get it approved.

---

## 2. Gaps found by the coverage check (16 October 2026)

Full list with reasons: `docs/coverage-check.md`.

- **Done (16 October 2026):** A1–A10 fixed, and plan 11 part 1 built (`docs/plans/11-shop-extras.md`).
- **Done (16 October 2026):** plan 11 part 2 — customer orders with advances, alterations, supplier sale-or-return, TallyPrime export (`docs/plans/11-shop-extras-part2.md`).
- **Still to do:** the smaller part-B items in `docs/coverage-check.md` (reopening a closed shift, e-receipt by email, per-till screen switches, more customer and stock reports).
- **Before relying on the Tally export:** the accountant test-imports a sample file into a copy of their Tally company.
- **Known limits of part 2:** a card/UPI advance taken at the till is not in the shift's expected card/UPI totals; order collection, store credit and alteration billing need the connection; sale-or-return goods should be sold at the store that received them.
- **Choices made while building, for the owner to confirm:** season sell-through % = sold ÷ (sold + in stock); a markdown skips items that already have a price starting that day; expense heads exclude accounts the system posts to itself; a customer is "no promotions" if any contact person opted out.
- **Full-year speed test:** paused by the owner. The tools are ready (`pnpm --filter api perf:seed`, then `perf:measure`; `PERF_RESUME=1` continues a stopped run). Run it once on the company server before go-live.

---

## 3. Waiting on others

- **Build decisions to confirm:** the owner to confirm the decisions taken while building, in section 9c of `docs/plans/07-accounting.md`, section 9c of `docs/plans/09-reports.md` and section 8c of `docs/plans/10-printing-import-export.md`.

## 4. Business decisions for the owner

- **First sector:** the manager suggested fancy stores, clothes and all retail stores. Record it in `docs/decisions.md` once confirmed; weighing-scale barcodes stay deferred unless grocery is included.
- **Many client businesses:** today one installation runs one business. Either give each client their own installation and database (works today), or build one shared system for all clients (a bigger change that needs its own plan).
- The other OPEN topics in `docs/decisions.md`: which shops need true offline billing, number of companies and GST registrations, card and UPI providers, bank statement formats, old software to import from.

## 5. Going live

- Company server set-up, backups and restore test.
- Loading real items, customers, suppliers and opening stock (Excel import is ready).
- Staff training, and setting the go-live date (clears trial data).
