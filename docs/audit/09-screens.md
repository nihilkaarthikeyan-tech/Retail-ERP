# Audit 09: Screens, ease of use and accessibility    Date: 30 October 2026

Scope: every screen in `apps/web/src/app` and `components`, the till, sign-up and the set-up guide.

How:
- Two read-only helpers: ease of use, and keyboard, screen readers, contrast and phone layout.
- A hands-on walk-through in the browser as a brand-new shop on the local copy: sign-up, the set-up guide, a first item, opening stock, the first bill at the till.
- A whole sale done with the keyboard only, before and after the fixes.

## The first shop, timed

| Step | Result |
| --- | --- |
| Sign-up to a ready dashboard | 1 min 35 s; clear set-up guide (5 steps, "Saved, you can carry on later", a summary with Change links) |
| Sign-up to the first printed bill | 8 min 15 s for someone who knows the screens |

Where a newcomer stalls (each now says what to do, or does it):

1. "Import or add your items" opened the Excel import, with "Item groups" chosen. It now opens the Items page, which has Add item and Import from Excel.
2. The till said "not set up as a till; a manager can set it up on Billing counter → Tills". It now lists the three steps and has a button to the tills page.
3. The item had no HSN code, because the shop-type groups carry none. The till refused the line with no hint. It now says "A manager adds it on the item (Items → ITM-000001), with its rate under Billing counter → GST rates". Whether shop types should fill in usual HSN codes is an owner decision (below).
4. The GST rate form had an empty "Starts on" box and answered "Must be a date in YYYY-MM-DD form". It now starts today, and every date box says "Choose a date".
5. The bill was refused only after the money was counted: "No cost is known; record a stock-in with a cost first". It now says "it has never come into stock with a cost. Load its opening stock (Stock → Stock counts, "Opening stock") or receive it from a supplier first". The "Load your opening stock" step opens the count already set to "Opening stock" on the shop floor.

Done unaided by a real newcomer: still to do. This needs a person who has never seen the product, timed by the owner (see "Needs the owner").

## Findings

| # | Severity | Where | What was wrong | Who it hurt | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | High | `ui/dialog.tsx` (64 screens) | Dialogs opened with the cursor on ✕: a typed PIN or mobile number went nowhere, and Enter closed the dialog | Every keyboard and scanner cashier | ✔️ Fixed: the first box (or the one marked) has the cursor; test |
| 2 | High | `ui/dialog.tsx`, till | After a dialog closed, the cursor was nowhere; the next scan was lost | Every cashier | ✔️ Fixed: back to where it was, and the till always back to the scan box |
| 3 | High | `till-app.tsx` | A locked till still took F4, F7, F8, F9 and Tab: a bill could be finished under the previous cashier's name | Shops sharing a till | ✔️ Fixed: keys ignored and the screen inert while locked (checked in the browser) |
| 4 | High | `billing-screen.tsx` | + − Del never worked: the cursor is always in the scan box. Lines could be chosen only with the mouse | Keyboard cashiers | ✔️ Fixed: they work when the scan box is empty; ↑ ↓ choose the line; ↓ goes into the search results |
| 5 | High | `pay-dialog.tsx` | Payment opened on ✕; Enter on a quick-cash button pressed it again instead of finishing | Every cashier | ✔️ Fixed: the till's usual payment method has the cursor (Enter takes the amount), then Enter finishes. A whole sale done by keyboard in the browser |
| 6 | High | sign-in | A sign-in ending after 30 idle minutes threw a half-typed purchase order, count or journal away, and login went to the dashboard | Accountants, store managers | ✔️ Fixed: editors keep the sign-in alive while there are unsaved changes; login returns to the page |
| 7 | High | editors | Nothing warned before leaving with unsaved changes | Everyone entering documents | ✔️ Fixed: purchase orders, receipts, supplier bills, stock documents, counts, journals, payments and items ask "Leave this page?" (closing the tab too) |
| 8 | High | `count-editor.tsx` | "Add all in stock" compared every item with every batch, then drew every line | A large count froze the screen | ✔️ Fixed: batches grouped once; 500 lines at a time |
| 9 | Medium | tables, reports | Lists of every item in stock drew all 50,000 rows (audit 8) | Slow, frozen screens | ✔️ Fixed: 500 rows, then "Showing 500 of 48,213 — Show 500 more"; totals and downloads still cover every row |
| 10 | Medium | finalise and post | Goods receipts, stock documents, counts, purchase orders, supplier bills, extra charges, journals and payments posted on one click | A stray click posts stock and accounts | ✔️ Fixed: one plain question first ("The goods go into stock and what is owed goes into the accounts now…") |
| 11 | Medium | `audit-table.tsx` | Change history showed `2026-04-01T00:00:00.000Z` (my audit 6 fix had lost its `\d`), codes and raw JSON | Owners reading the history | ✔️ Fixed: dates the Indian way, codes as words, details in words; test |
| 12 | Medium | `lib/api.ts` | A form refused by the server showed only "Validation failed" | Everyone | ✔️ Fixed: "Please check: …" with the first three problems |
| 13 | Medium | `use-load.ts`, tables | After a filter change the old figures stayed with no sign | Easy to misread stock of the wrong store | ✔️ Fixed: dimmed and marked busy while loading |
| 14 | Medium | prices, costs, reprint | Amounts like `1400.0000`, `₹2400.00`, raw figures on the back-office reprint | Everyone | ✔️ Fixed: ₹ with Indian grouping everywhere listed; costs keep the 3rd and 4th paise only when not zero |
| 15 | Medium | `globals.css` | Box and button borders at 1.5:1 (light) and 1.8:1 (dark); picker focus at 1.1:1 | Low vision, glare at the counter | ✔️ Fixed: 3:1 borders; a visible focus ring |
| 16 | Medium | app shell | No "skip to the page" link; the closed phone menu stayed in the Tab order; Escape did not close it | Keyboard and screen-reader users | ✔️ Fixed |
| 17 | Medium | nested dialogs | All dialogs shared one title id; Escape in the PIN closed the shift dialog too | Screen readers; shift close | ✔️ Fixed: own title id; events stop at the inner dialog |
| 18 | Low | menu | "CUSTOMERS AND SUPPLIERS6": the count ran into the heading | Looks broken | ✔️ Fixed |
| 19 | Low | sign-up, login | "Loading…" with no end when the server could not be reached | First impression | ✔️ Fixed: "Cannot reach the server just now. Trying again…" |
| 20 | Low | till | "Nothing found" was not read out by screen readers | Screen-reader users | ✔️ Fixed: announced |
| 21 | Low | GSTIN check | The check date was the UTC day | Shown a day early after midnight | ✔️ Fixed |
| 22 | Low | GST rates | Empty list said only "No GST rates yet." | New shops | ✔️ Fixed: says what to add and why |

## Accepted or carried, with the reason

- **The number pad and Price/Discount keys at the till are still mouse or touch only.** Quantity changes now work by keyboard. A typed line discount needs a keyboard way into the pad; Session 13, with cashiers' feedback.
- **On a tablet held upright, Pay is below the number pad.** A sticky Pay bar is a layout change to try on a real tablet (Session 13).
- **Quick search, tab bars and the "Bill finished" panel are only partly screen-reader friendly.** Role and arrow-key details; Session 13.
- **Some lists still say only "No X yet."** (units, brands, seasons, users…). Polish; Session 13.
- **The Prices screen stops at 500 prices with no note.** It needs server paging; the item's own Prices tab shows all of an item's prices. Session 13.
- **Escape closes a form dialog with typed text in it.** Most dialog forms keep their text in the screen behind; Session 13.

## Needs the owner

1. **Shop-type templates and HSN codes.** The fancy, clothing and other templates make item groups (Fashion jewellery, Toys…) with no HSN code. Should they carry the usual HSN code for each group (for example Fashion jewellery 7117)? The shop could change it. GST rates would still be entered by the shop, because they are the law's, not ours to guess.
2. **A real first-time user.** Ask someone who has never seen the product to sign up, set up and make a bill, without help, and time it. My run took 8 minutes knowing the screens.

## Tests

- New `audit9.test.tsx`: dialog cursor, history dates and words, 500-row tables with "Show more", rupees per unit, the login return page.
- Changed: the "not a till" text, and the plain "Please check" message.
- Till keyboard sale, lock, F6 and Escape: checked by hand in the browser (`docs/audit/05-till-hands-on-checklist.md` covers the real till).

## Result

Eight High, every Medium and the Lows listed fixed. A new shop reaches its first bill in 8 minutes, and a whole sale works by keyboard alone; what is left is listed above for Session 13. Tests: acceptance 468, web 463, shared 314, API unit 54, Till Helper 98, all passing. Session 9 is **done** (30 October 2026).
