# Third-party libraries and their licences

CLAUDE.md rule 7: only packages under permissive licences (MIT, Apache-2.0, BSD, ISC) may be used; anything else needs the project owner's approval first.

None of these libraries contain ERP logic. They are general building blocks (web framework, database driver, test runner, type checker). All business rules are written from the blueprint in our own code.

Last checked: 30 October 2026 (audit 10: full scan of every production package; @nestjs/throttler added; nodemailer moved to the running product, where it belongs).

## Used by the running product (apps/api, apps/web, packages/shared)

| Library | What it does for us | Licence |
| --- | --- | --- |
| next, react, react-dom | Web app framework and UI rendering | MIT |
| @nestjs/common, core, platform-express, schedule, throttler | Backend API framework, HTTP server, nightly jobs, flood limits | MIT |
| @prisma/client, @prisma/adapter-pg, prisma | Database access and migrations | Apache-2.0 |
| pg | PostgreSQL driver | MIT |
| cookie-parser | Reads the session cookie | MIT |
| zod | Input validation (shared by web and API) | MIT |
| decimal.js | Exact decimal arithmetic for money and quantities | MIT |
| reflect-metadata, rxjs | Required by NestJS | Apache-2.0 |
| nodemailer | Sends e-mail: password links and the daily summary (module 9, plan 09 answer 1); no dependencies of its own | MIT-0 (MIT without the attribution clause; approved by the project owner on 16 Oct 2026) |

QR codes printed on e-invoices (plan 08 §4) are drawn by our own encoder (`packages/shared/src/qr.ts`, written from the public QR code standard ISO/IEC 18004); no QR library is used.

PostgreSQL itself (Docker image `postgres:17-alpine`) is under the PostgreSQL Licence, a permissive BSD-style licence.

## Till Helper (apps/till-helper, runs on each till computer)

No third-party libraries at run time. The printer commands (ESC/POS), the local HTTP service, and the network, Windows-share and serial (COM port) printer connections use only our own code and Node.js's built-in modules. The `serialport` package (MIT) mentioned in the POS offline plan section 9 was not needed: serial printers are reached through Windows' own `mode` command and the `\\.\COMn` device. If a later device (customer display, weighing scale) needs two-way serial, `serialport` (MIT) is the planned choice and will be listed here.

Development only: typescript, vitest, oxlint, oxlint-tsgolint, @types/node (already listed below).

## Development and testing only (not shipped)

| Library | Purpose | Licence |
| --- | --- | --- |
| typescript | Type checker and compiler | Apache-2.0 |
| vitest, vite, @vitest/coverage-v8, @vitejs/plugin-react | Test runner | MIT |
| @testing-library/react, @testing-library/dom, jsdom | Screen tests | MIT |
| supertest | API tests | MIT |
| @nestjs/cli, @nestjs/schematics, @nestjs/testing | NestJS tooling | MIT |
| eslint, eslint-config-next, oxlint, oxlint-tsgolint, prettier | Code checks and formatting | MIT |
| source-map-support, @types/* | Debugging and type definitions | MIT |

## Deliberately excluded

| Library | Reason |
| --- | --- |
| sharp (pulled in by Next.js for image resizing) | LGPL-3.0 (libvips). Blocked with a pnpm override; image optimisation is switched off. |

## Indirect dependencies

The direct libraries above pull in about 700 smaller packages. A scan (`pnpm licenses list`) shows all are MIT, Apache-2.0, BSD, ISC or similar, except:

- development-only tools under MPL-2.0 or EPL-2.0 (`lightningcss` in the Vite build tool, `axe-core` in the ESLint accessibility checker), which never run on the server or in users' browsers;
- `elkjs` (EPL-2.0), part of Prisma Studio inside the Prisma command-line tool. The tool is in the server image because it applies database changes at start-up; Studio itself (a database browser) is never started there;
- `caniuse-lite` (CC-BY-4.0), the browser-support table Next.js reads when the web app is built; its licence asks only for credit, given here (data by caniuse.com, Alexis Deveria);
- `postgres` and `robust-predicates` (Unlicense) and `tslib` (0BSD): public-domain style, freer than MIT.

Audit 10 (30 October 2026): `pnpm audit` shows no known holes. Re-run both scans after adding any library, and each month (`docs/library-updates.md`):

```bash
pnpm licenses list --prod
pnpm audit
```

## Official government data

| Data | Where it comes from | Terms |
| --- | --- | --- |
| HSN / SAC codes and descriptions (`apps/api/data/gst/HSN_SAC-2026-10-26.xlsx`) | GST portal, https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx, published 26 October 2026, downloaded 28 October 2026 | Published free by the Government of India for taxpayers and their software; codes and descriptions only, used as published |
