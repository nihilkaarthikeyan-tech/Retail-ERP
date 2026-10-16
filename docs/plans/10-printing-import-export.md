# Plan: Module 10, Printing, labels, import and export

Status: **approved by the project owner on 16 October 2026** with these answers to section 11:
1. Real Excel files (.xlsx) are read and written by our own code, with no new library. CSV is also accepted.
2. Labels print through the browser now. Direct label-printer commands come later.
3. The trial-data clearing tool is built, Owner-only, and locked for good once the go-live date is recorded.

Sources: `docs/blueprint/16-printing-and-documents.md`, `17-data-import-export.md`, the "Clearing trial data" part of `15-users-roles-permissions.md`, `docs/decisions.md` questions 43, 65, 72–78, the launch scope rows "Key daily reports, Excel import" and "label designer (73) deferred", and CLAUDE.md rules 1–15.

## 1. What this module gives the shop

### A. Printed documents (A4 and A5, through the browser's Print / Save as PDF)

1. **Letterhead:** the company logo (already stored with the company) and each store's own name, address, GSTIN and phone (decision 75). Settings choose A4 or A5 and whether the logo prints.
2. **Documents that can be printed now:**
   - purchase order;
   - goods receipt note (ordered, received, accepted and rejected, batch and expiry, who received);
   - stock transfer slip between stores (internal, not a GST delivery challan);
   - stock count sheet, with the system quantity hidden for blind counts and space to write the count;
   - payment receipt (money from a customer) and payment voucher (money to a supplier), with the bills settled and the amount in words;
   - journal voucher;
   - customer and supplier statement of account with ageing.
3. **The amount in words** uses Indian style: "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only". It is shared code with tests.
4. **Standard terms:** reusable footer text, for example the return policy or payment terms, marked for selling, buying or both, and pulled into the matching documents.
5. **Marked copies:** a draft prints marked **DRAFT** and a cancelled document prints marked **CANCELLED**. Every print is recorded in the history (who, what, when).
6. **Waiting for the CA (decision 43):**
   - the GST tax invoice (A4) for business customers;
   - credit and debit notes;
   - the GST delivery challan.
   These are GST documents whose layout the Chartered Accountant must approve. They come with module 8. The till receipt from module 6 stays as it is, marked provisional until the GST rates are approved.

### B. Price and barcode labels (decision 73: standard templates with basic editing; a full designer later)

1. **The barcode is drawn by our own code** (EAN-13 and Code 128, as SVG). Both are public standards, so no library is needed.
2. **Standard templates:**
   - A4 sticker sheets (65 per sheet at 38 × 21 mm; 24 per sheet at 64 × 34 mm);
   - single labels for a thermal label printer (50 × 25 mm, 38 × 25 mm), printed through the browser's print window;
   - a custom size.
3. **Basic editing:** choose what shows (name, price, MRP, barcode, unit, batch, packed or expiry date, store name) and the text size. The settings are saved as the shop's label templates.
4. **What to print labels for:**
   - chosen items with a number of copies;
   - everything on a goods receipt (one label per unit received, batch and expiry included);
   - **items whose selling price changed since a chosen date** (blueprint 16 edge case).
5. **MRP** prints when the item has one (decision 76).

### C. Excel import (decisions 77 and 78: file upload only)

1. **What can be imported:**

   | Kind | Notes |
   | --- | --- |
   | Item groups and brands | Trees: a folder may appear earlier in the same file |
   | **Items** | With HSN, MRP, maximum discount, GST category, barcodes and extra units (extra rows under the item, as blueprint 17 describes) |
   | **Prices** | Price list, item, unit, price and start date. A price change is added as a new row with a start date, never overwritten |
   | **Customers** and **suppliers** | With one address and their GSTIN |
   | Reorder levels | Item, store, level and reorder quantity |
   | **Opening stock** | Becomes a **draft opening count** per location for checking, then finalised by hand (module 4 rules; against the temporary opening account) |
   | **Opening unpaid bills** | Customers and suppliers; posted as opening bills (module 7) |

2. **How it works:**
   1. Download a template, which marks barcode, HSN, mobile and code columns as text so leading zeros are kept.
   2. Fill it in Excel and upload it.
   3. Columns are matched by name; the user can re-match or skip them.
   4. A **preview** checks every row with the same rules as typing it in. It shows each problem with its row number before anything is saved.
   5. Choose **add new only**, **change existing only**, or **add and change**.
   6. Run it. **Each record is saved or refused on its own**, so a bad row never leaves a half-made record.
   7. A log shows every row. **Failed rows download as a file** to fix and import again; rows already done are skipped.
3. **Indian number style** in files (1,00,000.50) and common date styles (16/10/2026, 16-Oct-2026, 2026-10-16) are read. Anything unclear is reported, never guessed.
4. Imports run in the background on the server, with progress on screen. Large files go in batches of 500 rows.
5. Not now:
   - imports from Tally, Marg or Busy (decision 77: only after real sample files);
   - bank statements (deferred, decision 53);
   - a chart of accounts import (the standard chart is in use; the accountant edits it on screen).

### D. Export

**"Export for Excel"** on the item, customer, supplier, price and reorder-level lists. The file has the same columns as the import template, so a shop can export, change prices or details in Excel, and import back in "change" mode. Every export is recorded in the history (module 9 already does this for reports).

### E. Going live (decision 72)

1. **Clearing the trial data:**
   - The Owner can delete every transaction made during a trial period: bills, shifts, stock movements, purchase documents, payments, journals and the ledger. Stock totals and document number counters are reset.
   - The master lists stay: items, prices, customers, suppliers, the chart of accounts, users, tills and settings.
   - It needs the Owner, a written reason, and the company name typed in to confirm. Every step is logged.
2. **The go-live date:** recording it **switches the clearing tool off for good** (decision 72: "permanently locked after go-live"). There is no undo.
3. **The go-live check page:** the trial balance, stock value per store and customer and supplier dues on the go-live date, to compare with the old system's figures (blueprint 17).

## 2. Not built now

| Left out | Why |
| --- | --- |
| GST tax invoice, credit/debit notes, delivery challan prints | CA approval first (decision 43), with module 8 |
| A drag-and-drop layout designer, a label designer | Decision 73 and the launch scope: standard layouts and templates with basic choices now |
| Sending prints by email or WhatsApp | WhatsApp deferred (decisions 67, 74). Email of documents needs a PDF maker on the server; for now a print is saved as PDF and attached by hand |
| Direct printing to network A4 printers | The browser's print window reaches every printer the computer has |
| Direct label-printer commands through the Till Helper | Later, once the label printer model is known (question 2) |
| Cheque printing | Not asked for at launch |
| Multi-language prints | Not asked for at launch; item names are in one language |

## 3. Data model

| Table | What it holds |
| --- | --- |
| `PrintSettings` | Company: paper size (A4/A5), show logo, letterhead per store on or off |
| `StandardTerms` | Title, text, used for selling, buying or both, default for which documents |
| `LabelTemplate` | Name, size (width, height, columns per sheet or roll), fields shown, text size, barcode type, default |
| `ImportJob` | Kind, mode, file name, uploaded by, status (previewed, running, done, partly done, failed), counts (added, changed, skipped, failed), started and finished at |
| `ImportRow` | Job, row number, outcome, the record made or changed, message, and the original row (for the failed-rows file) |
| `GoLive` (on `Company`) | Go-live date, who recorded it; the clearing tool is refused once it is set |
| `TrialClearing` | Who, when, reason, and each step with its count and outcome |

Uploaded files are read in memory and not stored. Only the rows needed for the log and the failed-rows file are kept.

## 4. Shared code (with tests)

- **Amount in words**, Indian style with paise.
- **Barcode drawing:** EAN-13 (check digit already in module 2) and Code 128, returning bar widths.
- **Spreadsheet reading and writing:**
  - `.xlsx` files are zip files of XML. They are read and written by our own small code using Node's built-in zip support (question 1).
  - `.csv` is read with the separator detected.
- **Cell reading:** Indian-style numbers, dates in common styles, and text kept as text (leading zeros).
- **Label page fitting:** how many labels fit across and down a sheet.

## 5. Screens

1. **Print buttons** on the purchase order, goods receipt, transfer, count, payment, journal and statement pages. They open a clean print page with the letterhead.
2. **Settings → Printing:** paper, logo, standard terms.
3. **Labels:** pick items (or a receipt, or "price changed since"), choose a template, see a preview, print. **Label templates** with basic editing.
4. **Import:** choose the kind, download the template, upload, preview with problems, run, then the log with "Download failed rows". A list of past imports.
5. **Export for Excel** buttons on the master lists.
6. **Going live** (Owner): the check page, "Clear trial data" with its confirmation, and "Record the go-live date".

## 6. API endpoints (every one checks permission and store on the backend)

- `GET /print/:kind/:id`: the document's print data. Kinds are purchase_order, goods_receipt, transfer, count_sheet, payment, journal and statement. Logged as "print".
- `GET/PUT /print/settings`, `GET/POST/PATCH /print/terms`
- `GET/POST/PATCH /labels/templates`, `POST /labels/data`: label contents for items, a receipt, or price changes since a date.
- `GET /imports/templates/:kind`: the .xlsx template.
- `POST /imports/preview`: an upload; returns matched columns and per-row problems.
- `POST /imports/:id/run`, `GET /imports`, `GET /imports/:id`, `GET /imports/:id/failed-rows`.
- `GET /exports/:kind`: .xlsx or .csv, logged.
- `GET /go-live`, `POST /go-live/clear-trial-data`, `POST /go-live/date`.

## 7. Permissions (new keys)

| Key | Owner | Accountant | Store manager | Stock | Others |
| --- | --- | --- | --- | --- | --- |
| `print.settings` (letterhead, terms, label templates) | ✓ | – | – | – | – |
| `labels.print` | ✓ | – | ✓ | ✓ | – |
| `import.masters` (item groups, items, prices, customers, suppliers, reorder levels) | ✓ | – | – | – | – |
| `import.opening` (opening stock, opening bills) | ✓ | ✓ | – | – | – |
| `export.masters` | ✓ | ✓ | ✓ | – | Auditor |
| `golive.manage` (clear trial data, record go-live) | ✓ only | – | – | – | – |

- Printing a document needs only the right to see that document.
- Imports also need the rights to create or change what the rows do (blueprint 17). For example, importing prices needs `prices.manage`.
- Cashiers never export cost or buying prices (decision 70).

## 8. Acceptance scenarios (added to `docs/acceptance-tests.md` "Module 10" before building)

1. **Amount in words:** ₹1,23,450.25 → "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty and Twenty-Five Paise Only"; ₹0.50 → "Fifty Paise Only".
2. **A purchase order prints** with the store's own address and GSTIN, the supplier, lines and totals. A draft prints marked DRAFT, and the print is in the history.
3. **A payment receipt prints** with the bills it settled and the amount in words.
4. **Labels:** 3 copies of an item with an EAN-13 barcode give 3 labels whose bars decode back to the same barcode. A receipt of 12 units gives 12 labels with batch and expiry. "Price changed since" lists only items whose price changed after the date.
5. **Importing items:**
   - a file of 3 new items, one with a second barcode and a box unit, adds all three;
   - a row with an unknown item group fails with its row number while the other rows are saved;
   - running the fixed failed-rows file adds the last one;
   - running the whole file again adds nothing twice.
6. **Leading zeros and Indian numbers:** barcode "0012345678905" and HSN "0902" are kept as typed; a price "1,05,000.50" reads as 105000.50.
7. **Change mode:** importing prices with new start dates adds new price rows and keeps the old ones. Changing a customer's mobile keeps everything else.
8. **Opening stock:** importing quantities and costs for two locations makes draft opening counts, and nothing moves until they are finalised. Opening bills post against the temporary opening account and the opening check reflects them.
9. **Export and import back:** an exported item list imported back in change mode reports "nothing to change" for every row.
10. **Clearing trial data:**
    - after a trial sale, receipt and payment, clearing leaves items, customers, suppliers, prices and users;
    - bills, stock, ledger and counters are gone, and stock is zero;
    - it is refused without the typed company name;
    - after the go-live date is recorded it is refused for good, even for the Owner.
11. **Store limits and rights:** a store manager prints only their stores' documents. A cashier cannot import or export.

## 8c. Decisions made while building (for the project owner to confirm)

1. **One row per item:** the item import has columns for a second barcode and one pack unit (pack unit, pack size, pack barcode) on the item's own row. This replaces the extra rows under the item that blueprint 17 describes, and is simpler to fill in Excel. Items with more units or barcodes get them on the item page.
2. **Finding existing records:**
   - items by code, or, when no code is given, by the same name in the same group;
   - customers by code, else by mobile;
   - suppliers by code, else by GSTIN, else by name.
   In "add new only" mode an existing record is reported as "already there" and left alone, so running a file twice adds nothing twice.
3. **A different selling price in "change" mode** is added as a new price from today, and the old price is kept (blueprint 17: never overwrite prices).
4. **Opening stock** becomes one draft opening count per location. It is checked and finalised by hand on the stock count page. Opening unpaid bills can only be added by import; a wrong one is cancelled on the Opening balances page.
5. **Labels for a goods receipt:** one label per basic unit accepted (a box of 10 pieces gives 10 labels).
6. **Clearing trial data** also does the following:
   - resets coupon use counts and the items' last purchase prices;
   - clears the books-locked date;
   - removes prices set for a single trial batch.
   Tills stay registered, but each till must be opened again so it refreshes its saved copy.
7. **The statement of account** prints the whole history with the opening balance, and lists the unpaid bills under the totals.
8. **The count sheet** leaves the counted column blank to write on, and fills it only once the count is finalised. A blind count hides the system quantity.
9. **Real Excel files:** our own reader handles files saved by Excel and by this system. It is tested with files this system writes. Please import one file saved from your own Excel once, as a check.

## 9. Order of building

1. Shared code with tests: words, barcodes, spreadsheet read and write, cell reading.
2. Print data endpoints, settings and terms; then labels.
3. Import framework (preview, run, log, failed rows), then each importer; then exports.
4. Going live: the clearing tool, the go-live date and the check page.
5. Screens.
6. Acceptance tests 10.1–10.11, then a hands-on check in the browser.

## 10. Build note

The clearing tool deletes data. It runs only after the typed confirmation, and it is tested only against the throwaway test database. It is never run against the development sample data unless the owner asks.

## 11. Questions for the project owner

1. **Excel files.** Read and write real Excel files (.xlsx) with our own small code, no new library? *Recommended:* templates keep barcodes and HSN codes as text, and staff work in Excel directly. Or CSV only (simpler, but Excel can drop leading zeros when a CSV is opened)?
2. **Labels.** Print A4 sticker sheets and thermal label rolls through the browser's print window now? *Recommended.* Direct label-printer commands come later, once we know your label printer model.
3. **Clearing trial data (decision 72).** Build the Owner-only clearing tool now, with a typed confirmation, locked forever once the go-live date is recorded? *Recommended:* it lets you test the system with real-looking data before starting. Or leave it out?
