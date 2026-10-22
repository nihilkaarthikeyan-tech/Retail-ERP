# Plan 14 — One system for many shops (SaaS), with a landing page and sign-up

**Status:** approved by the owner on 22 October 2026. Answers: product name stays "Retail ERP"; 14-day free trial with
"Contact us" (no prices shown, no online payment yet); the email service is decided later (sign-up and forgot-password
emails are built and switched on before launch); a short "Contact us / book a demo" form on the landing page, read on
the platform admin screen.
**Why:** the owner's decision of 22 October 2026: the Retail ERP is offered as a service at **retailerp.52digit.com**.
Any shop can sign up, and each shop sees only its own data. Today one installation serves one business (the first
person to finish the setup wizard owns it).

---

## 1. What a visitor sees

1. **Landing page** at `retailerp.52digit.com`: what the product does (billing counter, stock, GST, accounts, reports),
   who it is for (fancy, clothing, footwear, cosmetics, mobiles, general stores), screenshots, plans, "Start free trial"
   and "Log in" buttons. Plain, fast, works on phones.
2. **Sign up** (`/signup`): name, email, mobile, password, shop name. We send an email with a link to confirm the email
   address. The account is ready the moment the link is opened.
3. **Set up your shop**: the existing 6-step wizard, now for *this* shop only (business, GST, first shop, what you sell).
4. **Log in** (`/login`): email and password, "Forgot password?" (an email link to choose a new one), "Show password",
   and a limit on wrong tries.
5. Inside: everything works as today, for that shop only. The shop's owner adds staff, who log in at the same address.

## 2. Keeping every shop's data apart (the core of the change)

- Every business table records the shop it belongs to. About 25 tables do not yet (items, barcodes, prices, units,
  item groups, brands, HSN codes, GST rates, customer and supplier groups, payment terms, users, roles, till devices,
  security settings, the audit log, …). Line tables (bill lines, receipt lines, …) belong to their document.
- Codes are unique **within a shop**, not across all shops (two shops can both have item code `ITM-000001` and the same
  barcode).
- The shop is taken from the logged-in person's session on the server, never from the browser. One central rule adds
  "only this shop's rows" to every database read and write.
- **Second lock in the database itself** (PostgreSQL row-level security): even if a program mistake forgot the shop, the
  database refuses to return another shop's rows.
- **Tests that try to break in:** two shops with the same codes; every screen and API call of shop A is tried with shop
  B's ids and must fail. A module is not done until these pass.
- Background jobs (nightly loyalty and gift card expiry, the daily summary email) run shop by shop.
- Document numbers, financial years, settings, modules on/off, the getting-started checklist: per shop (most already are).

## 3. People and accounts

- One email belongs to one shop at launch (a person working for two shops uses two emails). Can be widened later.
- **Platform admin** (Rademics staff only, a separate screen): list of shops with sign-up date, plan, last activity;
  switch a shop off or on; no access to a shop's bills or customers unless the shop owner allows support access.
- Existing tills: each till device is registered to its shop; the Till Helper is unchanged.

## 4. Plans and payment

- **Launch:** a free trial (length decided by the owner), then the owner contacts the shop and switches the plan on by
  hand from the platform admin screen.
- **Later (separate plan):** online payment of the subscription (UPI/card via a payment gateway), invoices for the
  subscription with GST, automatic reminders.

## 5. What stays the same

All business rules: GST, stock, double-entry accounts, offline billing at the till, printing, reports, imports. Each
shop's data still lives in our own PostgreSQL on our own server; backups cover all shops (and a single shop can be
restored on its own from a backup).

## 6. Build order

1. Shop tag on the ~25 tables, codes unique per shop, one migration that moves today's data into a first shop.
2. The central "only this shop" rule, plus row-level security.
3. Break-in tests across every module; then all existing tests run for two shops at once.
4. Sign up, email confirmation, forgot password, login limits.
5. Landing page.
6. Platform admin screen.
7. Deploy to retailerp.52digit.com; remove the temporary block on the old setup page.

## 7. Questions for the owner

1. **Product name** on the landing page (today it says "Retail ERP").
2. **Free trial length** (suggested 14 days) and the **plans and prices** to show (or "Contact us" for now).
3. **Email sending** for sign-up confirmation and forgot password: which email account or service (needed before launch).
4. Should the landing page have a **"Book a demo"** form (we receive name, phone, shop type)?
