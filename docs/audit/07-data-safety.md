# Audit 07: Data safety, migrations and history    Date: 29 October 2026

Scope: `apps/api/prisma` (schema and all 35 migrations), the change history (`audit`), every model, "Download all my data", "Clear trial data", and the backup and restore scripts in `deploy/`.

How: two read-only helpers (the schema's columns and constraints; the change history and the two data features). Every finding was checked in the code before fixing. The migrations were applied to an empty database, and a backup was restored onto a brand-new database server (a spare container set up like the live one).

## What was checked and found right

- **Money and quantities:** no Float anywhere; money is Decimal(16,2), quantities Decimal(18,3).
- **Shop separation:** all 164 tables have row-level security. 159 tables are limited to the request's shop; the 5 platform tables are closed to the shop role. The API's shop role cannot bypass it.
- **Who and when (§4.8):** every business table records who created and last changed each row, and when. Append-only tables (ledger, stock movements, history) record only creation. Link tables (permissions, till payment methods) are covered by the change history.
- **Change history (§4.9):** every posting, cancelling, price change, permission change, setting change, stock adjustment, shift step, import, clearing and export writes an entry. All of them except logins, prints and exports write it in the same transaction as the change. The history cannot be edited or deleted (database triggers), and each shop sees only its own.
- **Posted documents (§4.4):** no endpoint edits or deletes a posted document; every change checks for a draft again under a lock.
- **Migrations (§4.10):** all 35 apply cleanly on an empty database in 15 seconds. The result matches `schema.prisma` exactly (no drift).
- **Unique codes and numbers:** unique per shop, by database rule. One open shift per till; the summary e-mail is sent at most once a day.
- **Ledger:** a database trigger refuses an entry whose debits and credits differ.
- **"Download all my data":** every shop table, with password, PIN and token hashes and the session tables left out; Owner only; recorded in the history.

## Findings

| # | Severity | Where | What was wrong | What a shop would see | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical | `documents/go-live.service.ts` | Clearing trial data left gift cards and their entries, but deleted the ledger that holds their money | Trial gift cards could still be spent at the till, with no liability in the books | ✔️ Fixed: cleared with the rest |
| 2 | Critical | same | Clearing deleted bills that had a registered e-invoice or e-way bill, or that were in a month marked as filed. Only the go-live date stopped it | The GST portal would hold invoices the books no longer have | ✔️ Fixed: refused once anything was reported to the portal; the message says to record the go-live date instead |
| 3 | High | same | Trial loyalty points were kept | Points from deleted bills could be redeemed | ✔️ Fixed: cleared |
| 4 | High | same | Number counters were reset, but orders, alterations and consignment statements were kept | The next new order or alteration failed with "number already used" | ✔️ Fixed: cleared too |
| 5 | High | `deploy/README.md` | The restore steps overwrote the live database in place, while the API ran, not in one transaction; on a new server the database roles do not exist, so it failed | A failed restore could leave the data half-replaced; a restore on a new server would not work | ✔️ Fixed: new `deploy/restore.sh` (below) |
| 6 | Medium | `deploy/backup.sh` | A broken or empty backup file was kept like a good one | Nobody would know until a restore was needed | ✔️ Fixed: kept only if it reads back; `last-good-backup` marks the last good one |
| 7 | Medium | go-live service | Stock reservations, open orders, deliveries and consignment statements of the trial stayed | Stock held for orders that no longer exist; deliveries without bills | ✔️ Fixed: cleared |
| 8 | Medium | database | A saved bill, receipt, supplier bill, stock document, journal or payment could be deleted by a stray command, and its lines with it, while its ledger and stock entries stayed | Stock and accounts no longer explained by documents | ✔️ Fixed: database triggers refuse it (clearing trial data excepted) |
| 9 | Medium | database | Stock movements and stock totals had no link to their item and place | A movement could point at an item that does not exist | ✔️ Fixed: database links added |
| 10 | Medium | `documents/data-export.service.ts` | Tables without an id were read in pages with no fixed order | Past 5,000 rows, the file could repeat some rows and miss others | ✔️ Fixed: ordered by the primary key |
| 11 | Medium | `parties/party-masters.service.ts` | A customer or supplier group's price list and terms were not checked to be this shop's own | (Not reachable in practice: ids are random and other shops' rows are invisible) | ✔️ Fixed: checked, like customers and suppliers already were |
| 12 | Low | database | Gift card entries, till cash movements and drawer openings could be changed; points entries deleted | – | ✔️ Fixed: history triggers |
| 13 | Low | database | Re-costing could change more fields of a stock movement than it needs | – | ✔️ Fixed: only the worked-out figures may change |
| 14 | Low | database | No range checks | A gift card balance below zero, a pack factor of 0 or a GST rate over 100% would be saved if the code ever let one through | ✔️ Fixed: checks on gift card balance, pack and unit factors, GST rate, points remaining, coupon uses |
| 15 | Low | database | Deleting a customer would have turned their special price into a price for everyone | – | ✔️ Fixed: refused while special prices exist |
| 16 | Low | database | The same opening bill could be entered twice | Opening dues doubled | ✔️ Fixed: unique |
| 17 | Low | `shifts.service.ts`, `alterations.service.ts` | Cancelling an empty shift, or changing an alteration, checked the status outside the transaction | A close and a cancel at the same moment could both succeed | ✔️ Fixed: checked again under a lock |
| 18 | Low | `pin.service.ts` | A manager's approval and its history entry were two separate saves | – | ✔️ Fixed: one transaction |
| 19 | Low | `closing.service.ts`, go-live | The books-locked date and go-live did not set "last changed by" | – | ✔️ Fixed |

## Restore of a backup (done when)

`deploy/restore.sh <file>`:
1. Checks the file can be read.
2. Takes a backup of the database as it is now.
3. Makes the two database roles if the server is new.
4. Restores into a separate database in one transaction.
5. Only then stops the API, keeps the current database as `<name>_before_<date-time>`, puts the restored one in its place and starts the API again. The API is restarted whatever happens.

Nothing is deleted.

Tried on spare database servers (`postgres:17-alpine`, like the live one):
- **A "live-like" server:** tables owned by the limited login, as after audit 1 #18. It was backed up and restored onto a brand-new server. All 134 tables and their row counts, 129 security rules, the triggers and constraints, and the 134 tables owned by the limited login were the same. The script then said to run `limit-db-role.sh`.
- **The same backup onto a server that already had a database:** it swapped the restored one in and kept the old one.
- **A restore that fails** (a role missing from the old server): it stopped, removed its half-made copy and left the live database untouched.
- **The nightly backup:** a good backup was kept and marked; a failing one stopped with an error and left no file.

## Accepted, with the reason

- **The API's own login owns the tables** (needed so it can run migrations at start-up). So it could in principle empty the history table or switch a trigger off, and the shop role can set the two "clearing" and "re-costing" switches. Each needs our code to misbehave or someone to run their own SQL. Carried to Session 12: run migrations with a separate login and let the API use one that owns nothing.
- **Links between tables do not include the shop.** The database checks that a linked row exists, not that it is the same shop's. The services look the row up first, and other shops' rows are invisible to them (finding 11 closed the one gap found).
- **Few range checks on document lines** (quantity above zero). The shared validation refuses them on every route; returns and corrections use positive quantities with a kind, so a blanket database rule would need care. Left to the code.
- **One login per person across all shops** (e-mail unique). This is by design: a login belongs to one shop.
- **History actions are broad** (post, cancel and delete show as "update" with what changed). The screen shows the old and new status. Filtering by kind is for Session 9.
- **Correcting a price** edits it in place, with the old and new price in the history. The blueprint's "add a new dated price, don't overwrite" is advice for re-importing price lists (17).

## Needs the owner

- **Backups are kept only on the same server.** If the server or its disk is lost, every shop's data is lost with it. A copy must go somewhere else every night. **Owner, 29 October 2026: decide later**; carried to Session 12 (live server), with cloud storage, a company Google Drive or Hostinger backups as the options.

## Tests

- `module18-audit7.e2e-spec.ts` (new):
  - every table with a shop column is either cleared or kept (a new table cannot be forgotten);
  - a trial gift card and points are cleared, and the card can no longer be checked at the till;
  - clearing is refused with a registered e-invoice, or with a month marked as filed.
- The new database rules run under the whole acceptance suite (every bill, return, cancellation, re-costing and clearing in it).

## Result

Full suite run alone afterwards: 464 of 464 acceptance tests (4 new), web 458, shared 314, API unit 53, Till Helper 98, all passing. Session 7 is **done** (29 October 2026).


Two Critical, three High, and every Medium and Low finding fixed. Restore tested on a new server. One owner decision left for Session 12: where the nightly copy of the backup goes.
