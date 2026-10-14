# Third-party libraries and their licences

CLAUDE.md rule 7: only packages under permissive licences (MIT, Apache-2.0, BSD, ISC) may be used; anything else needs the project owner's approval first.

None of these libraries contain ERP logic. They are general building blocks (web framework, database driver, test runner, type checker). All business rules are written from the blueprint in our own code.

Last checked: 14 October 2026 (module 1).

## Used by the running product (apps/api, apps/web, packages/shared)

| Library | What it does for us | Licence |
| --- | --- | --- |
| next, react, react-dom | Web app framework and UI rendering | MIT |
| @nestjs/common, core, platform-express, schedule | Backend API framework, HTTP server, nightly jobs | MIT |
| @prisma/client, @prisma/adapter-pg, prisma | Database access and migrations | Apache-2.0 |
| pg | PostgreSQL driver | MIT |
| cookie-parser | Reads the session cookie | MIT |
| zod | Input validation (shared by web and API) | MIT |
| decimal.js | Exact decimal arithmetic for money and quantities | MIT |
| reflect-metadata, rxjs | Required by NestJS | Apache-2.0 |

PostgreSQL itself (Docker image `postgres:17-alpine`) is under the PostgreSQL Licence, a permissive BSD-style licence.

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

The direct libraries above pull in about 700 smaller packages. A scan (`pnpm licenses list`) shows all are MIT, Apache-2.0, BSD, ISC or similar, except a few development-only tools under MPL-2.0 or EPL-2.0 (`lightningcss` in the Vite build tool, `axe-core` in the ESLint accessibility checker, `elkjs` in Prisma Studio). These never run on the server or in users' browsers. Re-run the scan after adding any library:

```bash
pnpm licenses list
```
