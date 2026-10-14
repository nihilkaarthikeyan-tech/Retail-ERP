# Plan — Module 1: Users, roles and permissions; company and stores

Status: **approved by the project owner on 14 October 2026** with these answers to section 8:
1. Login extras deferred to a later update (password + lockout + idle timeout only).
2. INR only; no exchange rates in version 1.
3. Sessions: 30 minutes idle, 12 hours maximum, several sessions per user allowed.
4. Custom roles allowed in addition to the six seeded roles.
5. Temporary passwords typed by the admin until an email provider is chosen.

Sources: `docs/blueprint/02-company-and-stores.md`, `docs/blueprint/15-users-roles-permissions.md`, `docs/decisions.md` (questions 2–8, 68–72, 75).

## 1. What this module gives the business

After this module, the owner can:

1. Run a one-time **setup screen**: create the first administrator, the company, its GST registration, the first financial year and the first shop.
2. Add **shops** (stores), each with its own address and GSTIN (decision 4 and 75).
3. Create **users**, give them **roles**, limit them to particular shops, switch them off when they leave.
4. Log in and out; change password; get locked out after repeated wrong passwords.
5. See a **history** of who changed what, and who logged in from where.
6. Set up **document numbering** (for example `INV-MAIN-2026-00001`), ready for the modules that create documents.

Nothing in this module touches stock or accounts. Chart of accounts, warehouses, cost centres and tills are built in their own modules, which attach to the company and store records made here.

## 2. Data model (Prisma tables)

Every table below has `createdAt`, `createdById`, `updatedAt`, `updatedById` (reliability rule 8) unless noted.

| Table | Purpose | Main fields |
| --- | --- | --- |
| `Company` | The legal business (decision 2: one per legal entity; the table allows more later). | `code` (unique, auto from initials), `legalName`, `tradeName`, `pan`, `stateCode`, address fields, `phone`, `email`, `logo`, `homeCurrency` (fixed `INR`), `fiscalYearStartMonth` (4), `lockDate` (null until accounting), `active` |
| `GstRegistration` | One row per GSTIN (decision 4, 64). | `companyId`, `gstin` (unique), `stateCode`, `legalNameOnCertificate`, registered address, `isDefault`, `active` |
| `Store` | A physical shop (decision 3). | `companyId`, `code` (unique per company), `name`, address, `phone`, `email`, `gstRegistrationId`, `active`. Stock locations, cost centre and tills are added by later modules with a `storeId`. |
| `FinancialYear` | Accounting year (decision 6). | `companyId`, `name` (e.g. `2026-27`), `startDate`, `endDate`, `isIrregular` (short/long first year), `status` (`open` / `locked`), `createdAutomatically` |
| `NumberSeries` | Numbering pattern for one kind of document. | `companyId`, `documentKind`, `pattern` (e.g. `INV-{STORE}-{FY}-`), `counterLength` (5), `storeId` (null = all stores), `active` |
| `NumberSeriesCounter` | Running number per filled-in pattern. Locked row-by-row when allocating. | `numberSeriesId`, `filledPrefix`, `nextNumber` |
| `User` | One per person. | `email` (unique), `firstName`, `lastName`, `mobile`, `passwordHash`, `mustChangePassword`, `active`, `allStores`, `failedLoginCount`, `lockedUntil`, `lastLoginAt`, `passwordChangedAt` |
| `Role` | Named set of rights. Six system roles seeded (decision 71); admins may add more. | `code`, `name`, `description`, `isSystem`, `active` |
| `RolePermission` | Which permission keys a role has. | `roleId`, `permissionKey` |
| `UserRole` | Roles given to a user. | `userId`, `roleId` |
| `UserStore` | Shops a user may work in; ignored when `allStores` is on. | `userId`, `storeId`, `isDefault` |
| `Session` | Server-side login session (so sessions can be listed and ended). | `userId`, `tokenHash`, `ipAddress`, `userAgent`, `createdAt`, `lastActiveAt`, `expiresAt`, `revokedAt` |
| `SecuritySettings` | One row. | `minPasswordLength` (10), `lockoutAttempts` (5), `lockoutSeconds` (900), `sessionIdleMinutes` (30), `sessionMaxHours` (12), `singleSessionPerUser` (false) |
| `AuditLog` | Append-only change history (rules 9 and blueprint "history records"). No `updatedAt`; the database refuses UPDATE and DELETE on it. | `at`, `userId`, `action` (`create`, `update`, `deactivate`, `login`, `login_failed`, `logout`, `password_change`, `permission_change`, `counter_change`, …), `entityType`, `entityId`, `changes` (JSON: field → old, new), `ipAddress` |

**Permission keys** live in code (`packages/shared`), not in the database, so the frontend and backend share one list. This module defines:

`company.view`, `company.manage`, `stores.view`, `stores.manage`, `financial_years.manage`, `numbering.manage`, `users.view`, `users.manage`, `roles.manage`, `audit.view`, `sessions.manage_others`.

Later modules add their own keys (for example `cost_price.view`, which decision 70 says cashiers must not have) and extend the role seeds through migrations.

**Seeded roles and their module-1 rights** (decision 71):

| Role | Rights in this module |
| --- | --- |
| Owner / Admin | everything |
| Accountant | `company.view`, `stores.view`, `financial_years.manage`, `audit.view` |
| Store Manager | `company.view`, `stores.view`, `users.view` |
| Cashier | none (back-office pages hidden; POS rights come with module 6) |
| Stock / Receiving | `stores.view` |
| Viewer / Auditor | every `*.view` key, `audit.view` |

## 3. Business rules enforced in the backend

- Email unique; first name required; a switched-off user cannot log in; a user is never deleted (edge case "a cashier leaves").
- Passwords hashed with **scrypt** from Node's built-in `crypto` (no extra package); minimum length from `SecuritySettings`; `mustChangePassword` forces a change on first login.
- After `lockoutAttempts` wrong passwords in a row the account is locked for `lockoutSeconds`; every attempt is written to `AuditLog`.
- Sessions end after `sessionIdleMinutes` without activity or `sessionMaxHours` in total; a password change ends all other sessions.
- Every API endpoint (except `GET /health`, login and the first-run setup) requires a valid session **and** a permission key. Owner/Admin bypasses permission checks but not login.
- **Store scoping:** a user without `allStores` may only read or change records of stores listed in `UserStore`. Later modules reuse the same guard for stock, bills and reports.
- Company `code` is made from the initials of the legal name if blank, and must be unique. `homeCurrency` cannot change (fixed to INR in version 1).
- Financial years of one company may not overlap; a regular year must end exactly one year minus one day after it starts; irregular years must be flagged. Only Accountant or Owner/Admin may create, open or lock a year (decision 6). A nightly job creates the next year three days before the current one ends.
- Document number = pattern with `{YYYY}`, `{YY}`, `{MM}`, `{FY}`, `{STORE}`, `{COMPANY}` filled in, plus the counter padded to `counterLength`. The counter row is locked (`SELECT … FOR UPDATE`) inside the caller's transaction, so two users never get the same number. Only Owner/Admin may change a counter, and the change is audit-logged with old and new values.
- Rounding helpers (`roundMoney` to 2 places, `roundQuantity` to 3 places, normal half-up rounding per decision 5) live once in `packages/shared` with tests, ready for every later module.
- Audit log rows are written **in the same database transaction** as the change they describe.

## 4. Screens (Next.js)

| Screen | Who | Notes |
| --- | --- | --- |
| Setup (first run only) | Owner | Creates admin user → company → GST registration → first financial year → first store in one go. Disabled once a company exists. |
| Login / Change password / My sessions | Everyone | Session cookie, "end this session" buttons. |
| Company settings | Owner/Admin | Identity, address, logo, GST registrations list. |
| Stores | Owner/Admin, Store Manager (view) | List, add, edit, switch off. |
| Financial years | Accountant, Owner/Admin | List, create, lock/open. |
| Document numbering | Owner/Admin | Series per document kind, preview of the next number, counter change with reason. |
| Users | Owner/Admin | List, create (sets a temporary password), edit roles and stores, switch off, force password reset. |
| Roles | Owner/Admin | View the six system roles; add custom roles; tick permissions. |
| Change history | Owner/Admin, Accountant, Auditor | Filter by user, record, date; shows old and new values. |
| Login history | Owner/Admin, Auditor | Successes, failures, lockouts, addresses. |

Layout: a simple left-hand menu that only shows pages the user has rights for. Visual design is kept plain in this module; the design pass comes once more screens exist.

## 5. API endpoints (NestJS)

```
POST   /auth/login                 email + password → session cookie
POST   /auth/logout
GET    /auth/me                    current user, roles, permissions, stores
POST   /auth/change-password
GET    /auth/sessions              my sessions
DELETE /auth/sessions/:id

POST   /setup                      first-run only; refused once a company exists
GET    /setup/status               { needed: true|false }

GET    /company                    PATCH /company
GET    /company/gst-registrations  POST  /company/gst-registrations
PATCH  /company/gst-registrations/:id

GET    /stores                     POST /stores
GET    /stores/:id                 PATCH /stores/:id   (includes active on/off)

GET    /financial-years            POST /financial-years
PATCH  /financial-years/:id        (open / lock)

GET    /number-series              POST /number-series
PATCH  /number-series/:id
GET    /number-series/:id/preview  next numbers for each store
PATCH  /number-series/:id/counter  Owner/Admin only, reason required

GET    /users                      POST /users
GET    /users/:id                  PATCH /users/:id
POST   /users/:id/reset-password   sets a temporary password, forces change
DELETE /users/:id/sessions         end all of a user's sessions

GET    /roles                      POST /roles
PATCH  /roles/:id                  (name, permissions, active)
GET    /permissions                the permission key list with descriptions

GET    /audit                      filters: user, entityType, entityId, from, to
GET    /audit/logins
```

Internal (not HTTP): `NumberingService.allocate(tx, documentKind, { storeId, date })` for later modules.

## 6. Tests

Unit (Vitest, no database):
- rounding helpers: 2.5 → 3, 2.4 → 2, −2.5 → −3, 1.005 money → 1.01, quantity to 3 places
- company code from initials; financial year name and next-year dates; overlap and length rules
- number pattern filling for every token; zero padding; year roll-over resets the counter
- password policy and lockout counting; session expiry (idle and absolute)
- permission guard: allowed, refused, Owner/Admin bypass; store scoping guard

Integration (Vitest e2e against the Docker database):
- setup creates admin, company, year and store, and refuses a second run
- login success, wrong password ×5 → locked, audit rows present
- user without `users.manage` gets 403 on `POST /users`
- store-restricted user cannot read another store
- **two concurrent allocations of the same series get different, consecutive numbers**
- audit row and the change it describes are either both saved or neither (transaction rollback test)
- `AuditLog` UPDATE/DELETE refused by the database

Acceptance scenarios: `docs/acceptance-tests.md`, section "Module 1".

## 7. Deliberately not built in this module

| Item | Why |
| --- | --- |
| Chart of accounts, default accounts, locking date behaviour | Accounting module; needs CA approval (decision 55). The `lockDate` column exists but nothing reads it yet. |
| Warehouses / stock locations, cost centres, tills | Inventory, Accounting and POS modules; they will link to `Store`. |
| Costing method setting | Fixed to moving average by decision 33; no setting needed. |
| Approval steps and approval limits | Decision 69: simple limits come with the modules that have discounts (POS, sales). |
| Cashier PIN switching | Decision 68, POS module. |
| Trial-data wipe (decision 72) | Nothing to wipe yet; built as the last step before go-live. |
| Role bundles, single-record sharing, "hide whole areas" bundles | Roles with permission keys cover the six launch roles; bundles add complexity without launch value. |
| Export/print history, deleted-record copies | No exports, prints or deletable documents exist yet; added with Reports and Printing. |
| Welcome email with password link | No email provider chosen. Admin sets a temporary password instead; email flow added with the messaging integration. |
| Extra reporting tag, multi-currency and exchange rates | Not needed for a single-company INR retailer; blueprint marks both optional. |
| Two-step login, allowed login hours, allowed IP addresses, device limits, integration API keys | See questions below. |

## 8. Questions for the project owner

1. **Login extras.** I propose to launch with password + lockout + idle timeout only, and defer two-step login, login-hour and IP-address restrictions, device limits and integration API keys to a later update. Agree?
2. **Multi-currency.** I propose INR only in version 1 (no exchange-rate tables). Agree?
3. **Session defaults.** Idle logout after 30 minutes, forced logout after 12 hours, several sessions per user allowed. Fine, or different numbers?
4. **Custom roles.** The six roles from decision 71 are seeded. Should the admin be able to add more roles with their own permissions (my recommendation), or keep exactly six?
5. **Temporary passwords.** Until email is set up, the admin types a temporary password for a new user and tells them in person; the user must change it on first login. OK?
