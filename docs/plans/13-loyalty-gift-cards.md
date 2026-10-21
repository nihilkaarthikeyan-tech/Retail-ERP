# Plan 13 — Loyalty points and gift cards

**Status:** approved by the owner on 21 October 2026: gift cards are reloadable; loyalty starts at ₹100 spent = 1 point and 1 point = ₹1 (changeable in Settings).
**Basis:** `docs/blueprint/04-pricing-and-promotions.md` (loyalty scheme, processes 6 and 7, rules), decisions 15 and 16,
decision 14 (gift cards, OPEN until now), CLAUDE.md §1a (common core, everything else a setting). Both are new
**optional modules** ("Loyalty points", "Gift cards") in Settings → My modules, off for shop types unless chosen.

---

## 1. Loyalty points

**Settings (per company, all with defaults):** scheme name; who joins (every named customer, or chosen customer groups);
earn rate (₹100 spent = 1 point); point value when spent (1 point = ₹1); points last (365 days); minimum points to spend
(100); maximum share of a bill paid with points (50%); optional tiers (e.g. Silver from ₹0, Gold from ₹25,000 spent in a
year, each with its own earn rate).

**Earning** (blueprint process 6): when a till bill for a member is saved, points = whole number of
(amount that earns ÷ earn rate), where amount that earns = bill total − amount paid with points − amount paid with a
gift card. Walk-in bills earn nothing. The customer's tier is worked out from their spend. Offline bills earn when they
reach the server.

**Spending** (blueprint process 7): at the till the cashier sees the customer's balance and chooses points as a payment
method, up to the limits. Points are taken from the earliest-expiring first. Needs the connection (the balance is checked
on the server); the till says so when offline.

**Returns and cancelling** (decision 16): a return takes back the points earned on the returned lines **and** gives back
the points spent on those lines. A cancelled bill reverses both.

**Accounts (decision 15 — points are a liability):**
- Earning: debit "Loyalty expense", credit "Loyalty points liability" for points × point value.
- Spending: debit "Loyalty points liability", the bill is paid by that amount (customer pays less).
- Expiry: a nightly job writes expired points back: debit liability, credit "Loyalty expense" (or "Other income", a setting).

**Screens:** loyalty settings; the customer page shows balance, tier, history and points expiring soon; till shows the
balance after picking the customer and on the receipt; reports: points liability, points earned and spent by month,
top members, points expiring next month.

## 2. Gift cards (decision 14 — now decided by the owner)

**A gift card is prepaid money the shop owes the holder** (blueprint open question 14), not a coupon.

- **Selling** a card at the till: a card number (printed card with a barcode, or a number on the receipt), an amount,
  paid by any method. Accounts: debit cash/card/UPI, credit "Gift card liability". **No stock and no GST at sale:** under
  GST a voucher is not itself a supply; tax is charged on the goods when the card is spent (CBIC circular on the GST
  treatment of vouchers, 2024 — the CA confirms before go-live).
- **Spending** a card: "Gift card" is a payment method at the till; scan or type the number; part of a bill or all of it;
  the balance left stays on the card. Accounts: debit liability, the bill is paid by that amount. GST on the goods is
  charged normally on the bill.
- **Balance and expiry:** a card lasts 12 months from issue (setting). Expired balances are written back to "Other income"
  by a nightly job (setting), with a report first.
- **Refunds:** a return of goods paid with a gift card puts the money back on the card, not in cash (setting).
- **Safety:** card numbers are unique and hard to guess; a card can be blocked (lost or stolen); every load, spend and
  block is in the history; spending needs the connection.
- **Screens:** gift cards list (number, holder, issued, balance, expires, status), card history, sell and check balance at
  the till; reports: gift card liability, sold and spent by month, expiring cards.

## 3. Data model (outline)

| New | Main fields |
| --- | --- |
| `LoyaltySettings` | per company: earn rate, point value, validity, minimum, maximum share, joining, expiry account |
| `LoyaltyTier` | name, spend from, earn rate |
| `LoyaltyEntry` | customer, bill, points (+ earned / − spent / − expired / reversed), value, expires on, links to the entry it uses up |
| `GiftCard` | number, holder name and phone, issued at shop, amount loaded, balance, expires on, status (active, blocked, expired) |
| `GiftCardEntry` | card, bill or sale, amount (+ load / − spend / + refund / − expiry), who and when |

Through Prisma migrations, with audit fields and history. New account roles: loyalty expense, loyalty points liability,
gift card liability (added to existing companies automatically).

## 4. Tests

Acceptance scenarios go into `docs/acceptance-tests.md` ("Module 13") before building: earning on a ₹2,450 bill
(24 points at ₹100 = 1 point); spending 100 points on a bill; a return reversing earned and restoring spent points; expiry;
a tier change; the liability always equal to unexpired points × value; selling a ₹1,000 gift card (no GST, liability up);
spending ₹600 of it on a bill (GST on the goods as usual), balance ₹400; a blocked card refused; a return refunded to the
card; expiry written back; the gift card liability equal to the sum of card balances.
