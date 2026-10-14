# Acceptance tests

Plain-language end-to-end scenarios. Each module's scenarios are written before the module is built, and the module is not done until they pass as automated tests. Scenarios for stock, accounts and tax state the expected effect on each.

Automated versions live in `apps/api/test/acceptance/`.

---

## Module 1 — Users, roles, company and stores

Stock, accounts and tax are not affected by anything in this module.

### 1.1 First-time setup
- **Given** an empty database
- **When** the owner completes the setup screen with their name and email, a password, company "Rademics Retail Pvt Ltd", state Tamil Nadu, one GSTIN, financial year 1 Apr 2026 – 31 Mar 2027 and first store "Main Store" (code `MAIN`)
- **Then** the owner can log in; the company has code `RRPL`; one open financial year `2026-27`; one active store `MAIN` linked to that GSTIN; the setup screen can no longer be used; the audit history shows the creation of each record by that owner.

### 1.2 Creating a cashier limited to one store
- **Given** a logged-in Owner/Admin and stores `MAIN` and `ANNA`
- **When** they create user Priya with role Cashier, store `ANNA` only, and a temporary password
- **Then** Priya can log in, must change her password before doing anything else, sees no back-office menu, and any API call for store `MAIN` is refused.

### 1.3 Wrong password lockout
- **Given** lockout set to 5 attempts for 15 minutes
- **When** someone enters a wrong password for Priya 5 times
- **Then** the 6th attempt is refused even with the right password; the login history shows 5 failures and one "locked" refusal; after 15 minutes the right password works.

### 1.4 Switching a user off
- **Given** Priya has made changes that appear in the history
- **When** the admin switches Priya off
- **Then** she cannot log in, her open sessions end, and every history line still shows her name.

### 1.4b The last Owner/Admin cannot be removed
- **Given** Karthik is the only active Owner/Admin
- **When** anyone tries to take the Owner/Admin role from him or switch him off
- **Then** it is refused until another active user holds Owner/Admin.

### 1.4c Every endpoint checks permissions
- **Given** Priya is a Cashier
- **When** she calls the financial years, roles, permissions, company, stores, numbering or history endpoints directly
- **Then** each is refused; only her own login details are returned.

### 1.5 Store manager cannot change access rights
- **Given** user Arun with role Store Manager
- **When** Arun tries to create a user or change a role
- **Then** the request is refused and nothing changes.

### 1.6 Financial year rules
- **Given** financial year `2026-27`
- **When** the accountant tries to add a year 1 Jan 2027 – 31 Dec 2027
- **Then** it is refused because it overlaps.
- **When** three days before 31 Mar 2027 the nightly job runs
- **Then** year `2027-28` (1 Apr 2027 – 31 Mar 2028) exists, marked as created automatically.
- **When** a cashier tries to lock a year
- **Then** it is refused; only Accountant or Owner/Admin may.

### 1.7 Document numbering never repeats
- **Given** a series for sales invoices with pattern `INV-{STORE}-{FY}-` and a 5-digit counter
- **When** two tills at store `MAIN` ask for a number at the same instant
- **Then** one gets `INV-MAIN-2026-27-00001` and the other `INV-MAIN-2026-27-00002`; store `ANNA` separately starts at `INV-ANNA-2026-27-00001`.

### 1.7b Business dates are Indian dates
- **Given** financial years 2026-27 and 2027-28 exist
- **When** a bill is numbered at 00:05 Indian time on 1 April 2027 (still 31 March in UTC)
- **Then** its number is in the 2027-28 series; a bill at 23:45 Indian time on 31 March is in 2026-27.
- **When** the nightly job runs on what is already 28 March in India but still 27 March in UTC
- **Then** it creates 2027-28 (three days before year end, by the Indian date).

### 1.8 Counter change is restricted and logged
- **When** a Store Manager tries to change a counter
- **Then** it is refused.
- **When** the Owner/Admin changes the `MAIN` counter from 3 to 100 with a reason
- **Then** the next number is `…-00100` and the history shows who, when, old value 3, new value 100 and the reason.

### 1.9 History cannot be edited
- **When** anyone, including the database owner role used by the API, tries to update or delete a history row
- **Then** the database refuses it.

### 1.10 Audit and change are saved together
- **Given** an update to a store that fails half-way (simulated error after the store row is written)
- **Then** neither the store change nor its history row is saved.

---

## Module 2 — Items, units, barcodes, price lists

Stock, accounts and tax are not affected by anything in this module.

### 2.1 A simple item with two pack sizes
- **Given** units PCS and BOX exist and the group Grocery > Staples > Rice is a leaf group
- **When** the catalogue manager creates item "Basmati Rice 1 kg" without typing a code, basic unit PCS, another unit BOX = 12 PCS, barcode `8901234567894` (EAN-13) for PCS and `18901234567891` for BOX, HSN 1006, MRP ₹120.00, selling price ₹110.00 in Standard Selling
- **Then** the item gets code `ITM-000001`; scanning `8901234567894` returns the item in PCS; scanning `18901234567891` returns the item in BOX with 12 basic units; the price lookup for 1 BOX returns ₹1,320.00 (12 × 110) because prices are per basic unit.

### 2.2 Barcodes are unique and checked
- **When** another item is given barcode `8901234567894`
- **Then** it is refused, naming the item that already has it.
- **When** an item is given EAN-13 `8901234567895` (wrong check digit)
- **Then** it is refused.

### 2.3 A style with sizes and colours
- **Given** attribute Size with S/M/L and attribute Colour with Red (RED) and Blue (BLU)
- **When** the manager creates style `SHIRT` varying by Colour and Size and ticks Red, Blue × S, M, L
- **Then** six variants exist with codes `SHIRT-RED-S` … `SHIRT-BLU-L` and names "Shirt Red S" etc.; creating the same combinations again adds nothing; a price or barcode on `SHIRT` itself is refused; a price on `SHIRT-RED-M` is accepted.

### 2.4 Fractions only for weight, length and volume
- **Given** unit PCS (count) and unit KG (weight)
- **When** a quantity of 1.5 PCS is entered anywhere
- **Then** it is refused; 1.5 KG is accepted.
- **When** the manager tries to allow fractions on PCS
- **Then** it is refused.

### 2.5 The right price is found
- **Given** item X with Standard Selling price ₹100 (from 1 Apr 2026), a scheduled price ₹105 from 1 Nov 2026, a contract price ₹90 for customer C (module 3; until then recorded with a placeholder customer id), and a Wholesale list with no price for X
- **Then** on 14 Oct 2026 a walk-in sale gets ₹100; on 1 Nov 2026 it gets ₹105; customer C gets ₹90 on both dates; a bill on the Wholesale list gets ₹100 through the default-list fallback when that setting is on, and no price when it is off; variant `SHIRT-RED-M` with no own price takes the parent's price if one is set at parent level for lookup only (prices are stored on variants; parent fallback is read-only).

### 2.6 Cashiers never see cost or buying prices
- **Given** Priya is a Cashier
- **When** she opens an item
- **Then** the response has no last-purchase-price field, the buying price list is not returned, and `GET /price-lists` shows only selling lists; the Owner/Admin sees everything.

### 2.7 A switched-off item cannot be used
- **When** item X is switched off (or given an end date in the past) and its barcode is scanned
- **Then** the scan answers "not usable: switched off" and any document line for X is refused.

### 2.8 Price changes are in the history
- **When** the price of X in Standard Selling is changed from ₹100 to ₹110 by ending the old price today and adding the new one
- **Then** the history shows who, when, the old price and the new price.

### 2.9 Item codes never repeat
- **When** two staff create items at the same instant without codes
- **Then** they get `ITM-000002` and `ITM-000003`, never the same code.
