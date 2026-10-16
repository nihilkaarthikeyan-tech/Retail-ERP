# Pending work

Things agreed to do later, after the launch modules are complete.
Deferred features from the launch scope are listed in `docs/decisions.md`; this file holds the rest.

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
- **Plan 11 part 2, still to do:** supplier consignment (sale or return), Tally export, alterations, customer orders with advance; and the smaller part-B items in `docs/coverage-check.md` (reopening a closed shift, e-receipt by email, per-till screen switches, more customer and stock reports).
- **Choices made while building, for the owner to confirm:** season sell-through % = sold ÷ (sold + in stock); a markdown skips items that already have a price starting that day; expense heads exclude accounts the system posts to itself; a customer is "no promotions" if any contact person opted out.
- **Full-year speed test:** paused by the owner. The tools are ready (`pnpm --filter api perf:seed`, then `perf:measure`; `PERF_RESUME=1` continues a stopped run). Run it once on the company server before go-live.

---

## 3. Waiting on others

- **Module 8, GST:** waiting for the Chartered Accountant to approve questions 43 and 55–64. Until then, bills are marked provisional. This is the main blocker before a real shop can go live.
- **Build decisions to confirm:** the owner to confirm the decisions taken while building, in section 9c of `docs/plans/07-accounting.md`, section 9c of `docs/plans/09-reports.md` and section 8c of `docs/plans/10-printing-import-export.md`.

## 4. Business decisions for the owner

- **First sector:** the manager suggested fancy stores, clothes and all retail stores. Record it in `docs/decisions.md` once confirmed; weighing-scale barcodes stay deferred unless grocery is included.
- **Many client businesses:** today one installation runs one business. Either give each client their own installation and database (works today), or build one shared system for all clients (a bigger change that needs its own plan).
- The other OPEN topics in `docs/decisions.md`: which shops need true offline billing, number of companies and GST registrations, card and UPI providers, bank statement formats, old software to import from.

## 5. Going live

- Company server set-up, backups and restore test.
- Loading real items, customers, suppliers and opening stock (Excel import is ready).
- Staff training, and setting the go-live date (clears trial data).
