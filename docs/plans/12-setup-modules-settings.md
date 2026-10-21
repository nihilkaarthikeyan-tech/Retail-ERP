# Plan 12 — Guided setup, modules on and off, settings centre, shop types

**Status:** approved by the owner on 21 October 2026: existing companies get every optional module switched on; the AI "Describe your shop" helper is built later, after the rest.
**Why:** CLAUDE.md §1a — one common core for every business; everything that differs is a setting with a sensible
default, filled in by shop-type templates. Owner's requests of 18 and 21 October 2026 (`docs/pending-work.md`, "NEXT after GST").

---

## 1. Modules: core (always on) and optional (on or off)

**Core — always on** (everything depends on them, and the law needs some): company and shops, users and rights,
items, prices, customers, suppliers, stock, billing counter (till), accounts, GST, reports, printing, import and export.

**Optional — each shop switches them on or off:**

| Module | What it adds | Needs |
| --- | --- | --- |
| Sizes and colours | Styles with variants, size × colour grid, reports by size and colour | — |
| Batches and expiry | Batch numbers, expiry dates, expiry checks | — |
| Serial numbers and warranty | Serial numbers at receipt and sale, warranty dates | — |
| Seasons and markdowns | Season tags, sell-through, markdown tool | — |
| Purchase orders | Orders to suppliers before receiving | — |
| Supplier sale-or-return | Consignment receipts, statements | Purchase receipts (core) |
| Transfers between shops | Sending stock between shops, in transit | More than one shop |
| Customer orders | Orders with advance, set aside, collection | — |
| Alterations | Job slips, tailor, charges | Salesperson (for the tailor list) |
| Home delivery | Delivery details and charges, delivery list | — |
| Salesperson | Sales staff on bills and the report | — |
| Offers and coupons | Offers, coupons, mix-and-match | — |
| Credit sales (on account) | Selling on credit at the till, credit limits | — |
| Expenses and cash book | Simple expense entry, cash and bank books | — |
| E-invoice | E-invoice files and status | GST (core); turnover above ₹5 crore |
| E-way bill | E-way bill files and register | GST (core) |
| Tally export | Vouchers and ledgers for Tally | — |

**Rules:**
1. Switching a module **off only hides it** — menus, screens, fields, till buttons and reports. It never deletes data.
   Switching it back on shows everything as it was.
2. Before switching off, the owner is **warned about anything still open** (for example "3 customer orders are still open",
   "12 items are tracked by batch"). The owner may still switch it off.
3. Modules that need another switch it on automatically, and say so.
4. The server also respects the switches: a switched-off module's actions are refused with a plain message, so a hidden
   feature cannot be used by mistake (for example an old till still offering a hidden button).
5. Only the Owner can switch modules; every change is in the history.

## 2. Shop types (templates)

A shop type is a starting set of modules **and** settings. It only fills in defaults at setup; the owner can change
anything later. Applying a different shop type later asks first and never deletes data.

| Shop type | Modules switched on (besides core) | Starting settings |
| --- | --- | --- |
| Fancy and gift | Offers, salesperson (optional), home delivery | Item groups: jewellery, cosmetics, toys, bags, gifts, stationery, decor; small price labels |
| Clothing | Sizes and colours, seasons and markdowns, salesperson, alterations, customer orders, offers | Size and colour lists; garment HSN groups; price band GST rule ready for the CA |
| Footwear | Sizes and colours, seasons and markdowns, salesperson, offers | Footwear size list (UK/EU) |
| Cosmetics and beauty | Batches and expiry, offers | Shelf life defaults; expiry warnings |
| Mobiles and electronics | Serial numbers and warranty, customer orders | Warranty days default |
| General store | Everything optional off except offers | — |

Item group lists, size lists and colour lists are **starting suggestions** the owner can edit at once.

## 3. The guided setup (replaces the one-page first-run setup)

Step by step, with Back and Next, saving as it goes (a power cut does not lose what was typed):

1. **You:** owner's name, email, password.
2. **Your business:** legal name, trade name, PAN, state, address, phone.
3. **GST:** GSTIN (checked), regular or composition, monthly or quarterly returns, turnover band — or "not registered yet".
4. **Your first shop:** name and short code; how many tills.
5. **What do you sell?** Pick a shop type (cards with a picture and one line each), then see the modules it switches on
   with simple ticks to change them.
6. **Done:** a summary of what was set up, and the getting-started checklist.

Optional **"Describe your shop" helper** on step 5 (see §6): the owner writes a sentence; the system suggests a shop type
and modules; the owner confirms. Never required.

## 4. Getting-started checklist

On the dashboard until finished (the owner can hide it). Each step links to its screen and ticks itself off when done:
add tills and payment methods · import or add items · load opening stock · add staff and their rights · set the letterhead
and logo · set GST rates for your HSN codes (CA approval) · make a test bill · set the go-live date.

## 5. Settings centre

One **Settings** page, grouped by module, replacing the scattered settings screens (they stay reachable, but from here):

- **My modules** — the on/off list of §1.
- **Shop type** — see or re-apply.
- One section per module (company and shops, items, prices and offers, customers, suppliers and buying, stock, billing
  counter, GST, accounts, reports and summary email, printing and labels, users and security, numbering).

For every setting: a plain-language label, one line explaining what it changes, its default, and a "back to default"
button. Settings of switched-off modules are hidden. A search box finds any setting by name.

**First step of the work:** list every setting that already exists (catalogue, parties, stock, purchases, till, GST,
accounts, print, security, summary email) and, module by module, propose what more each should offer. That list is shown
to the owner before anything new is added.

## 6. The optional AI helper ("Describe your shop")

- Off unless the owner switches it on, and only on the setup step and the shop-type screen.
- Sends **only** the owner's sentence about the shop — never customers, bills, money or any other data — to an AI service.
- Returns a **suggestion** (shop type, modules, item groups) that the owner must confirm; it changes nothing by itself.
- Money, tax and accounting set-up always come from our fixed rules, never from the AI.
- Needs an AI service account and its key in the server's environment file (not committed). Which service, and its cost,
  is the owner's choice (question 3).

## 7. Data model (outline)

| Change | Fields |
| --- | --- |
| `CompanyModules` (new) | company, module key, on/off, changed by and when |
| `Company` | shop type, setup step reached, checklist hidden |
| `SetupProgress` (new) | what the guided setup has saved so far |

Through Prisma migrations, with audit fields and history.

## 8. Tests

Acceptance scenarios go into `docs/acceptance-tests.md` ("Module 12") before building: a fancy shop set up through the
wizard sees no sizes, batches or alterations anywhere (menus, item form, till, reports); switching "Sizes and colours" on
shows them and switching it off again keeps the data; a switched-off module's API refuses; the warning lists open orders;
dependent modules switch on together; the checklist ticks itself off; setup resumes after closing the browser midway.

---

## Questions for the owner

1. Approve this plan?
2. **Existing companies** (like the sample company): switch every optional module **on** (nothing disappears), or ask
   the owner to pick a shop type the first time they open Settings?
3. **The AI helper:** build it now (you choose the AI service and pay for its use), or later after the rest is done?
