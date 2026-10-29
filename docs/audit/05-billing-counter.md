# Audit 05: Billing counter, offline and devices    Date: 29 October 2026

Scope: the till in the browser (`apps/web/src/lib/till`, `components/till`), the till API (`apps/api/src/pos`), the Till Helper (`apps/till-helper`) and the plan `docs/plans/pos-offline-and-devices.md`.

How: three read-only helpers (the offline queue and crash safety; a day offline and the shift's cash; devices and speed). Each finding was checked in the code. Plain defects were fixed at once. Nine changes to how the counter works went to the owner (C1–C9), who accepted all of them on 29 October 2026; they are recorded in `docs/decisions.md`. The fixes were made by three helpers, each owning separate files, then joined and tested together.

## What was checked and found right

- A bill sent twice (retry, double click, two copies at once) is saved once; shift openings and cash in/out the same.
- Bill numbers come from each till's own counter, saved before use and locked across tabs, never below the server's last number; dates in Indian time, so a bill at 00:05 on 1 April starts the new year's series.
- The draft is saved on every change and restored after a crash; the queue lives in the browser's database and sends oldest first, waiting longer after each failure.
- Points, gift cards, on account, advances, orders and returns without a bill need the connection, so they cannot be spent twice offline.
- Price, offer and GST changes made while a till is offline are kept as charged and flagged; two tills selling the last piece is allowed and flagged (decision 32).
- The Till Helper listens only on the computer itself, answers only the shop's own web address with a paired key, cannot read or write files or run commands, and a sale always finishes even when the printer or helper is off.

## Findings

| # | Severity | Where | What was wrong | Status |
| --- | --- | --- | --- | --- |
| 1 | High | `pos-bills.service.ts` | An offline bill was refused (lost from stock and books) when the back office changed something meanwhile: coupon used up, item switched off, discount limit lowered, payment method removed, invoice prefix changed, approval over 10 minutes old | ✔️ Fixed: kept as sold and flagged (plan §5) |
| 2 | High | till engine, `shifts` | A shift could close while bills had "could not be sent", so their cash was not expected and could be pocketed | ✔️ Fixed (C3): closing refused; the office can post such a bill into the shift |
| 3 | High | queue | One bill failing with a server error blocked every bill behind it for ever and showed "offline" | ✔️ Fixed: after 10 tries or 1 hour it becomes a problem; "Server not answering" is shown apart from offline |
| 4 | High | queue, `pos-common` | An expired 12-hour cashier switch jammed the queue as "Signed out" | ✔️ Fixed: the bill goes under the signed-in user and is flagged; a till computer no longer registered shows its own red message |
| 5 | High | engine, `pos-bills` | When the answer to a bill was lost after the server saved it, the cashier could change the payment and the shop would book both versions | ✔️ Fixed: the till asks the server first; the server refuses the same bill identity with different contents |
| 6 | High | `pos-bills` | Offline discounts were trusted without checks | ✔️ Fixed: checked against the cashier's and item's limits, cost and MRP, and flagged |
| 7 | Medium | `shifts`, `pos-common` | A manager's approval of a cash difference, a bill discount or a cash out was not tied to the amount | ✔️ Fixed: the approved figure is stored and compared |
| 8 | Medium | engine | Offline past midnight the till could not bill | ✔️ Fixed (C2) |
| 9 | Medium | engine | No limit on billing offline on old prices | ✔️ Fixed (C1): warning after 24 hours, stop after 48 |
| 10 | Medium | pricing | A single-use coupon could be given again offline | ✔️ Fixed: the till counts its own uses |
| 11 | Medium | return dialog | The same bill could be refunded twice offline | ✔️ Fixed: returns waiting on the till are taken off what is left |
| 12 | Medium | snapshot | The company's "no price change on bills" setting was ignored by the till | ✔️ Fixed |
| 13 | Medium | `shifts` | The office could cancel a shift whose bills were still waiting on the till | ✔️ Fixed: only an empty shift opened online over 12 hours ago |
| 14 | Medium | back office | Pairing the Till Helper from POS → Tills always failed (a one-character mistake) | ✔️ Fixed |
| 15 | Medium | Till Helper | A printer switched off or out of paper counted as printed | ✔️ Fixed (C9) for network printers; the till tells the cashier and prints in the browser |
| 16 | Medium | billing screen | No manager "open drawer", drawer openings not recorded | ✔️ Fixed (C4): No-sale with a manager PIN; every opening recorded on the shift |
| 17 | Medium | pay dialog | A barcode scanned into the cash box could finish the bill with an absurd amount | ✔️ Fixed: amount limits, a check on change of ₹10,000 or more, a scanner's Enter ignored |
| 18 | Medium | billing screen | An unknown barcode followed by a fast scan could add the wrong item | ✔️ Fixed |
| 19 | Medium | settings | "Receipt copies" did nothing | ✔️ Fixed (C6) |
| 20 | Medium | pricing | A 40-line bill on a 30,000-item shop searched the whole catalogue on every key | ✔️ Fixed: lookup tables; a 40-line bill on 30,000 items prices 21 times in under 3 seconds in the test |
| 21 | Low | various | Pick list showed the wrong price; a second "Print" was not marked Duplicate; the first scan after a bill was lost; vague pairing errors; double receipts in some failures; storage failure left "Opening the till…" for ever; two tabs of one till; no request to keep the till's data; one open shift per till not enforced in the database; the drawer entry dated on the closing day; "Offline bills to check" did not say what the price list said | ✔️ Fixed |

## The owner's decisions (C1–C9), as built

C1 offline warning at 24 hours, stop at 48; C2 billing past midnight on yesterday's open shift when offline; C3 no close with unsent bills, office "Post into shift"; C4 No-sale with a manager PIN and a record of every opening; C5 cash out above ₹2,000 (setting) needs a manager; C6 receipt copies 0–3; C7 opening float suggested from the last count; C8 blind count setting (off); C9 printer paper check for network printers.

## Accepted, with the reason

- **Numbers after the till's browser data is wiped while bills wait**: the till now asks the browser to keep its data; the plan's warning stays (§3).
- **A wrong manager PIN** answers "not allowed" without signing anyone out of the till (the till's requests never send it to the login page).
- **Shop names in Tamil or Hindi** print as plain letters only (one language at launch, plan 10).
- **Installing and updating the Till Helper** is by hand at launch; the helper's version shows in its dialog.

## Still to do by hand

The plan requires a hands-on test on a real Windows till with its printer, drawer and scanner: `docs/audit/05-till-hands-on-checklist.md`. This is for the owner (Session 13, ready for people, if not done before).

## Tests

- `module16-audit5.e2e-spec.ts` (18): every server behaviour above.
- Web: `audit5.test.ts` (23, including the 30,000-item speed test), `till-app-audit5.test.tsx`, `till-devices.test.tsx` (18), shift dialogs (5 new).
- Till Helper: printer status with a fake printer (98 in all).

## Result

Six High and every Medium and Low fixed with tests; the owner's nine decisions built. Full suite run alone afterwards: 455 of 455 acceptance tests, web 454, shared 312, API unit 53, Till Helper 98, all passing. The hands-on test on a real till is with the owner. Session 5 is **done** (29 October 2026).
