# Plan: Point of sale, offline queue and till devices

Status: **approved by the project owner on 15 October 2026** (CLAUDE.md §6.5) with these answers to §12:
1. The offline queue is used on every till.
2. Receipt printer and cash drawer now; customer display and weighing scale later.
3. Manager approvals (and PIN cashier switching) need the connection; PINs are never stored on the till.

Sources: `docs/blueprint/09-point-of-sale.md`, `18-integrations.md` (printers and devices), `04-pricing-and-promotions.md` (offline till edge case), `docs/decisions.md` questions 1/38 (online-first with a local offline queue), 13, 32, 39, 40, 44, 68, 80, 81, CLAUDE.md rules 5–7 and 15.

## 1. The idea in one paragraph

The till is a page of our web app running in the browser on the till computer. Normally it talks to the server for every bill (online-first, decision 1/38). If the internet or the server drops, the till **keeps billing**:
- Bills are saved on the till computer.
- Each bill gets the next number from the till's own number series.
- The bills are sent to the server automatically when the connection returns.

A bill is never saved twice, even if it is sent twice. Receipts are printed through a small helper program on the till computer, which also opens the cash drawer (decision 81).

## 2. What is saved on the till

Kept in the browser's built-in database on the till computer (IndexedDB), never in cookies:

| What | When it is refreshed | Used for |
| --- | --- | --- |
| **Till set-up** (store, location, price list, payment methods, limits, receipt header) | At sign-in and every 15 minutes while online | Billing rules |
| **Catalogue snapshot**: sellable items, barcodes, units, MRP, maximum discount, HSN, GST rate | Every 15 minutes; only what changed since the last refresh is fetched | Scanning and searching offline |
| **Prices** from the till's price list, including prices starting in the next 7 days | Same | Price changes at midnight work offline |
| **Offers and coupons** that are active | Same | Offers offline (cumulative / sales-history offers are switched off offline, decision 18) |
| **Sales staff** of the till's store (code, name) and the store's **home-delivery charge** (plan 11 C1, B4) | Same | Naming the salesperson and adding the delivery charge offline |
| **Customers**: walk-in, plus customers with a mobile number (name, mobile, GSTIN, group) | Same | Finding a customer offline; new ones can be added offline (name + mobile) |
| **Last known stock** per item at the till's location | Same | Shown to the cashier only; never blocks a sale (decision 32) |
| **The bill being made** | On **every change** (each scan, each key) | Crash recovery (§6) |
| **The send queue**: finished bills, returns, cash in/out and shift openings not yet confirmed by the server | Until the server confirms each one | Offline billing |
| **The till's number counter** | Before each number is used | Unique numbers (§3) |
| **The open shift** (opening cash, who opened it) | When it changes | Billing needs an open shift |

Not kept on the till:
- passwords;
- manager PINs;
- cost prices (decision 70);
- other stores' data.

A cashier must sign in online at least once a day (sessions are 12 hours, approved in module 1).

## 3. Bill numbers that never clash

- Each till has **its own number series**, set up with the till, for example `MAT1/2627/000123` (the till's invoice prefix of 1–4 letters or digits, unique in the company, financial year, running number). No two tills share a series, so two offline tills can never produce the same number. *(18 October 2026, plan 08: GST allows invoice numbers of at most 16 characters (CGST rule 46(b)), so the old form `MAIN-T1-2026-27-000123` was replaced; bills already made keep their numbers, and a bill made offline before the till took its new prefix is still accepted.)*
- The till numbers its own bills from a counter kept on the till. The counter is saved **before** a number is printed, so a crash cannot reuse a number.
- The server checks every incoming bill:
  - the number belongs to that till's series;
  - it has not been used before;
  - a gap is reported, never filled.
- At sign-in the server tells the till the last number it received from it; the till never goes below that.
- **One known risk:** if someone wipes the till computer's browser data while bills are still waiting to be sent, those bills are lost. The till warns loudly when bills are waiting, and the sync status is always on screen (§7).

## 4. A bill is never saved twice

- When a bill is finished, the till gives it a random identity (a UUID) **once**, stores it with the bill, and sends it with every attempt.
- The server keeps a unique rule on *till + bill identity*. A second copy of the same bill, for example after a timeout, finds the first one and returns it. It never creates a second bill, a second stock movement or a second payment (decision 80, idempotency).
- The same applies to returns, cash in/out entries and shift openings and closings.

## 5. If prices or stock changed while the till was offline

The customer has paid and has a receipt, so **the server accepts the bill as it was sold**:
- **Prices:** the prices, offers and GST on the receipt are the ones recorded. If the price list, an offer or a GST rate changed while the till was offline, the bill is not altered. It is listed on an **"Offline bills to check"** report showing what was charged and what the price list said.
- **Stock:** stock leaves at the time of the sale, not the time of sending (rule 15: Indian business date of the sale). Later movements are re-costed by the stock engine. Selling beyond stock is allowed at the till and flagged (decision 32), so a bill is never refused for stock.
- **Expired batches (decision 13)** are refused on the till itself from its snapshot. If the server finds the batch had expired, the bill is still recorded (it was sold) and put on the check report for the manager.
- **Hard errors** stop that one bill and put it on a **"Sync problems"** list for the manager; the rest of the queue carries on. Examples: the till was switched off, or the bill's number is outside the till's series.
- **Month-end stock lock:** a bill dated before the stock lock date is posted on the first open date and flagged on the check report.
- **Salesperson and delivery (plan 11):** a salesperson switched off or moved meanwhile is kept on the bill and flagged; a home-delivery charge is kept as the till added it, flagged if the store's charge changed meanwhile.

## 6. When the till crashes or loses power

- The bill being made is saved on every change. When the till page opens again it shows **"Bill restored"** with the lines and payments as they were.
- Finished bills waiting in the send queue are sent automatically as soon as the till is back. The cashier does not need to do anything.
- If the till crashes after the server saved a bill but before the till heard back, the till sends the bill again. The server recognises it (§4) and the till marks it sent.
- A bill that was finished (paid and receipt printed) is never reopened for editing; mistakes are corrected by a return (rule 4).

## 7. What the cashier sees

A small status in the till's top bar:
- **Green, "Online":** nothing is waiting.
- **Amber, "Offline, 12 bills waiting":** the till is billing from its own saved copy; bills will be sent when the connection returns.
- **Red, "3 bills could not be sent":** a manager must look at the Sync problems list.

Shown when offline: "Last price update 10:42". Shown when the snapshot is older than 24 hours: a warning, because prices may be out of date.

## 8. What is limited while offline

| Works offline | Needs the connection (refused offline, with a plain message) |
| --- | --- |
| Scanning, searching, prices, simple offers, coupons (use counted on sync) | Manager PIN approvals: price overrides, large discounts, returns without a receipt (decision 40). PINs are never stored on the till |
| Cash, and card / UPI recorded with their reference (the card machine and UPI are separate devices) | Returns of bills from **other** tills or older than the till's saved history (30 days of its own bills are kept for returns) |
| Returns and exchanges of this till's own bills | Credit sales (not built until accounts, module 7) |
| New customer with name and mobile | Opening a shift on a new day is allowed offline; **closing** a shift needs the connection and an empty queue, so the cash count is checked against every bill |
| Cash in / cash out during the shift (decision 41) | Cumulative and sales-history offers (decision 18) |

## 9. Till devices: the Till Helper (decision 81)

A small program, **Retail ERP Till Helper**, installed on each till computer (Windows). It is our own code, kept separate from the business logic: the ERP decides *what* to print; the helper only drives the devices.

- **How the till page talks to it:** the page sends requests to the helper on the till computer itself (`http://127.0.0.1:47120`), which browsers treat as a secure local address.
  - **Pairing:** the helper shows a 6-digit pairing code once. The till page stores the token it gets back, and every request carries it.
  - **Origin check:** the helper only accepts requests from our ERP's web address.
  - **Never visible from outside:** the helper does not listen on the network, only on the computer itself.
- **What it does at launch (recommended):**
  - **Receipt printer:** 80 mm or 58 mm thermal printers using the common ESC/POS commands, connected by USB (Windows printer name), serial (COM port) or network (IP address, port 9100). The ERP sends the receipt as structured data (lines, totals, GST table); the helper turns it into printer commands.
  - **Cash drawer:** opened by a pulse through the receipt printer. It opens when a cash payment is finished, or when a manager uses "Open drawer" (logged).
- **Later, when needed:**
  - **Customer display:** a pole display on a serial port showing item and total.
  - **Weighing scale:** read the weight over a serial port. Weighing-scale barcodes stay open until the first sector is chosen (decision 9).
- **Without the helper:** the till can still print an 80 mm receipt through the normal browser print window, so billing never stops because of a printer.
- **Reprints:** any receipt can be reprinted from the bill. Reprints are marked "Duplicate" and logged.
- **Third-party code (as built):** none at run time. The printer commands and the local service are our own code using Node's built-in modules. Serial printers are reached through Windows' own COM port, so `serialport` was not needed. The pairing code is exchanged once for the helper's token through `POST /pair`.

## 10. Card and UPI payments (launch: recording only)

Card machines and UPI QR codes are separate devices at launch (launch scope: "card/UPI payment recording"; decision 44 keeps the provider OPEN). The cashier takes the payment on the machine and records:
- the method;
- the amount;
- the approval code or UPI reference.

Matching against the bank's settlement is deferred (decision 54 and the launch scope). The payment part of the till is built so a provider's terminal can be connected later without changing the bill (decision 44: modular).

## 11. Tests for this plan

- **Idempotency:** the same bill sent 5 times (in parallel and in sequence) gives one bill, one set of stock lines and one payment set.
- **Numbering:** two tills offline give no duplicate numbers; a number outside the till's series is refused; a gap is reported.
- **Offline price change:** a bill sold at the old price is accepted as sold and appears on the check report.
- **Queue order:** bills sent out of order (number 5 before 4) are both accepted, and stock ends the same.
- **Crash recovery** (web test with a fake browser database): a half-made bill is restored; a finished bill in the queue is resent and marked sent once the server confirms it.
- **Closing a shift** with bills still waiting is refused, with a count of how many are waiting.
- **Helper:** printer command output for a sample receipt is checked byte by byte; a request without the token or from another origin is refused.

## 12. Questions for the project owner

1. **Offline at every till:** approve the offline queue as described for **all** tills? Full "local-first" selling (decision 1/38, still OPEN for which shops) would only change how long a till can stay offline, not this design.
2. **Devices at launch:** receipt printer and cash drawer now, with the customer display and weighing scale later? Recommended.
3. **Manager approvals offline:** refuse them while offline, as recommended for security? The alternative stores PIN checks on the till, which is weaker.
