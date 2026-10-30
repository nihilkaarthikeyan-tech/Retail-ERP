# Plan — Module 3: Customers and suppliers

Status: **approved by the project owner on 15 October 2026** with these answers to section 8:
1. Cashiers may quick-add customers at the till (name + mobile); duplicates are warned about.
2. Default credit limit 0 (no credit) until an Accountant sets one.
3. Areas left out of version 1.

Sources: `docs/blueprint/05-customers.md`, `docs/blueprint/06-suppliers.md`, `docs/decisions.md` (questions 20–26, 62, 69), launch scope row "Customers and suppliers".

## 1. What this module gives the business

1. **Customers**: walk-in, regular and business (B2B) accounts with mobile, email, GSTIN, addresses, contact people, price list, payment terms, credit and overdue limits, and a status (active / blocked / switched off).
2. **Suppliers**: distributors, local vendors, transporters and service providers with GSTIN or PAN, addresses, contacts, buying price list, payment terms, holds (orders/bills, payments, or both, with an optional end date) and the exceptions "bill without order" / "bill without receipt".
3. **Groups** for both (trees; only bottom-level groups are given to a party) carrying defaults that new parties copy.
4. **Payment terms** templates (Cash, Net 15, Net 30, 50 % advance + 50 % on delivery) and the due-date calculation every later module uses.
5. **Quick add at the till**: name + mobile, with the duplicate-mobile warning (decision 20).
6. **Automatic numbers** `CUS-000001` / `SUP-000001` from the numbering engine, plus a standing **walk-in customer** per company.
7. Everything above is logged in the history.

What the module *provides* for later modules: `assertCustomerUsable`, `assertSupplierUsable` (status and holds), `creditLimitFor(customer)`, `dueDateFrom(terms, date)`, same state / other state (built later as the shared rule `resolveSupply` in `packages/shared/src/gst-core.ts`). The credit **check** itself needs balances and open orders, so it is built with Sales/POS/Accounting; the limits are stored now.

## 2. Data model (Prisma)

Every table has the four audit columns. Money is `Decimal`.

| Table | Main fields |
| --- | --- |
| `Address` | `partyType` (`customer` / `supplier`), `partyId`, `label`, address lines, `city`, `stateCode`, `pincode`, `phone`, `email`, `gstin` (decision 21: GSTIN per business-customer address), `isBilling`, `isDelivery`, `isMain`, `active` |
| `ContactPerson` | `partyType`, `partyId`, `name`, `jobTitle`, `email`, `mobile`, `isMain`, `noPromotions` (consent for messages, decision 74), `active` |
| `PaymentTerms` | `code`, `name`, `active`; parts in `PaymentTermsPart`: `share` (%), `dueBasis` (`days_after_date` / `days_after_month_end` / `months_then_month_end`), `days` / `months`, `earlyDiscountPercent`, `earlyDiscountDays` |
| `CustomerGroup` | tree like `ItemGroup`; defaults: `priceListId`, `paymentTermsId`, `creditLimit`, `overdueLimit`, `skipCreditCheck` |
| `Customer` | `companyId`, `code` (unique), `name`, `isBusiness`, `mobile`, `email`, `notes`, `customerGroupId` (leaf), `gstin`, `stateCode`, `priceListId`, `paymentTermsId`, `creditLimit` (0 = none), `overdueLimit`, `creditCheckAtDelivery`, `status` (`active` / `blocked` / `off`), `isWalkIn`, `linkedSupplierId`, `offlineTillRef` |
| `SupplierGroup` | tree; defaults: `paymentTermsId`, `priceListId` |
| `Supplier` | `companyId`, `code`, `name`, `isBusiness`, `mobile`, `email`, `notes`, `supplierGroupId` (leaf), `isTransporter`, `gstin`, `pan`, `stateCode`, `priceListId` (buying), `paymentTermsId`, `bankAccountNote`, `status`, `holdType` (`none` / `bills` / `payments` / `all`), `holdUntil`, `holdReason`, `allowBillWithoutOrder`, `allowBillWithoutReceipt`, `linkedCustomerId` |
| `PartySettings` (one row per company) | `defaultCustomerGroupId`, `defaultSupplierGroupId`, `defaultPaymentTermsId`, `defaultCreditLimit`, `walkInCustomerId` |

*Changed 30 October 2026 (audit 14):* the planned setting `gstTreatmentFrom` (`billing` / `delivery`) was removed. Nothing ever read it: the place of supply is set by GST law, not by a shop setting, and is worked out in one shared rule, `resolveSupply` in `packages/shared/src/gst-core.ts`.

Migration also adds real foreign keys from `Price.customerId`, `Price.supplierId` and `Item.preferredSupplierId`, and seeds payment terms Cash, Net 15, Net 30; groups Retail, Wholesale, Staff (customers) and Distributors, Local vendors, Services, Transporters (suppliers); number series `customer` (`CUS-`) and `supplier` (`SUP-`); the walk-in customer.

**Permission keys:** `customers.view`, `customers.manage`, `customers.credit` (change credit/overdue limits and status; the "credit controller"), `suppliers.view`, `suppliers.manage`, `suppliers.hold`. Seeds: Cashier `customers.view` + quick add (`customers.manage` limited to the quick-add endpoint); Store Manager `customers.view/manage`, `suppliers.view`; Stock/Receiving `suppliers.view`; Accountant all view + `customers.credit`, `suppliers.hold`; Owner/Admin all.

## 3. Business rules

- Name required; group must be bottom-level and active; `gstin` format-checked and its state must match `stateCode`.
- **Duplicate mobile (decision 20):** creating a customer whose mobile already exists returns the existing customers and is refused unless `confirmDuplicate: true`. Never merged automatically.
- A switched-off party is refused on every document; a blocked one only by the trusted role (`customers.credit` / `suppliers.hold`).
- **Credit (decision 22):** limit 0 = no limit; a limit below the amount owed is refused (needs balances: enforced from the accounting module); changing limits or status needs `customers.credit` and is logged.
- **Holds:** a hold with a past end date is lifted automatically; removing a hold clears the end date; a hold without a type holds everything.
- Customer and supplier may be the same party (decision 25): separate records, optionally linked; balances stay separate.
- **Due date:** per payment-terms part, the later of the running date and (date + days) / (month end + days) / (month end N months later), never before the bill date. Pure function with tests.
- Walk-in customer: one per company, cannot be switched off, has no credit, no GSTIN.
- Addresses and contacts belong to one party (the blueprint's shared addresses are not needed for one company).

## 4. Screens

Customers list (search by name/mobile/code; filters group, status) · Customer editor (details, GST, addresses, contacts, terms & credit, history) · Quick add dialog (name, mobile; duplicate warning shows matches) · Customer groups · Suppliers list · Supplier editor (details, tax, addresses, contacts, terms, hold panel, exceptions) · Supplier groups · Payment terms · Party settings.

## 5. API

```
GET/POST /customers        GET/PATCH /customers/:id      POST /customers/quick-add
GET/POST /customers/:id/addresses   PATCH /customers/:id/addresses/:aid
GET/POST /customers/:id/contacts    PATCH /customers/:id/contacts/:cid
PATCH    /customers/:id/credit      (customers.credit: limits, status)
GET/POST /customer-groups  PATCH /customer-groups/:id
GET/POST /suppliers        GET/PATCH /suppliers/:id
GET/POST /suppliers/:id/addresses   PATCH /suppliers/:id/addresses/:aid
GET/POST /suppliers/:id/contacts    PATCH /suppliers/:id/contacts/:cid
PATCH    /suppliers/:id/hold        (suppliers.hold)
GET/POST /supplier-groups  PATCH /supplier-groups/:id
GET/POST /payment-terms    PATCH /payment-terms/:id   GET /payment-terms/:id/due-date?from=
GET/PATCH /party-settings
```

## 6. Tests

Unit: due-date rules (all three bases, month ends, February, never before the bill date); GSTIN/state consistency; hold expiry. Integration: duplicate-mobile warning and confirm; quick add creates a main contact; leaf-group rule; blocked vs off; hold refuses bills but not payments (checked through the service helpers); supplier price now needs a real supplier; cashier cannot change credit limits; history of limit changes. Acceptance scenarios: `docs/acceptance-tests.md`, section "Module 3".

## 7. Deliberately not built

Areas (only offers, loyalty and tax rules use them; none exist yet), account statements (needs invoices), merging duplicates, supplier ratings (decision 24), TDS (decision 62), commissions and portals (decisions 23, 26), item restrictions per customer and order/delivery-before-invoice flags (Sales module), multi-currency, the credit *check* and overdue *check* (need balances; Sales/POS/Accounting).

## 7b. Decisions made while building (for the project owner to confirm)

1. **Changing a supplier's hold type resets its end date and reason** unless new ones are given. Otherwise an old, expired end date would silently make the new hold inactive (found by scenario 3.6).
2. **Quick-add** is its own permission (`customers.quick_add`), so cashiers can add name + mobile without being able to edit full customer records.
3. **The payment-terms list is readable by anyone with `customers.view`** (needed to show a customer's terms); only `payment_terms.manage` may change them.
4. **A supplier's PAN is filled from its GSTIN** (characters 3–12) and a typed PAN that disagrees with the GSTIN is refused.
5. **Group defaults are copied once at creation** (price list, terms, limits); later changes to a group do not alter existing customers or suppliers (scenario 3.8). The blueprint's "changing a customer's group updates the group on their open documents" applies to documents, which do not exist yet.

## 8. Questions for the project owner

1. Should cashiers be allowed to **quick-add** customers at the till (name + mobile) — recommended yes — or only managers?
2. Default credit limit for new customers: **0 (no credit)** recommended; credit only for customers an Accountant approves (decision 22).
3. Keep **areas** out of version 1? Recommended yes.
