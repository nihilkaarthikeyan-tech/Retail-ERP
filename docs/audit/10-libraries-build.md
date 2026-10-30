# Audit 10: Libraries, licences and the build    Date: 30 October 2026

Scope: every `package.json`, `pnpm-lock.yaml`, `docs/third-party-licences.md`, the `Dockerfile` and `.dockerignore`, the live images.

How: `pnpm audit`, `pnpm licenses list --prod`, `pnpm why` for anything not plainly permissive. The images were rebuilt on this computer and started:
- the API against a spare database: database changes checked, health answered;
- the web app: login, till, the till's offline file, a page file and the safety headers served.

## Findings

| # | Severity | What was wrong | Risk | Status |
| --- | --- | --- | --- | --- |
| 1 | High | `lodash` 4.17.21 (prototype and code-injection holes) inside Prisma Studio, part of the Prisma tool shipped in the API image | Studio is never started on the server, so not reachable; still a known hole in the image | ✔️ Fixed: override to 4.18 |
| 2 | High | `undici` 8.11 (four high holes) in the test browser (jsdom) | Test tools only, never shipped | ✔️ Fixed: override to 8.12.2 |
| 3 | Medium | `@vitest/mocker` and `qs` holes in the test runner and the test HTTP client | Test tools only | ✔️ Fixed: vitest 4.1.12; override for qs |
| 4 | High | Each image was over 2 GB: the whole build folder, with all source code, tests, every development tool, and both apps in each image | More to attack, slower deploys, disk use | ✔️ Fixed: the API image holds only the built API and its production packages (pnpm deploy), 860 MB; the web image holds Next.js's standalone server, 397 MB (54 MB of it ours). Both still run as `node`, not root |
| 5 | Medium | The Prisma tool, which applies database changes at every start, was listed as a development tool | A slim image would have lost it | ✔️ Moved to the API's runtime packages |
| 6 | Low | The licence list was two weeks old: `@nestjs/throttler` missing; `nodemailer` filed under "development only"; `caniuse-lite` (CC-BY-4.0) and `elkjs` (EPL-2.0) not explained for the image | — | ✔️ Updated |
| 7 | Low | No routine for library updates | Holes stay unnoticed | ✔️ `docs/library-updates.md`: a monthly look, update, check and ship, with a log |

## Licences (production packages, 30 October 2026)

| Licence | Packages |
| --- | --- |
| MIT | 228 |
| ISC | 31 |
| Apache-2.0 | 23 |
| BSD-3-Clause, BSD-2-Clause | 6 |
| MIT-0, 0BSD, Unlicense | 4 (public-domain style; nodemailer approved by the owner) |
| CC-BY-4.0 | 1 (`caniuse-lite`, browser data read at build time; credit given in the list) |
| EPL-2.0 | 1 (`elkjs`, inside Prisma Studio, never started) |

Nothing under GPL, AGPL or an unclear licence. `sharp` (LGPL) stays blocked.

## Accepted, with the reason

- **The API image is still 860 MB.** About 400 MB is the Prisma tool and its packages, which the API needs at start-up to apply database changes; the rest is the Node.js base image. Running migrations from a separate one-off container would drop the tool from the API image; that belongs with the separate database login for migrations (Session 12, carried from audit 7).
- **The Prisma tool brings Prisma Studio** (`elkjs`, React) into the API image. It is never started.

## Result

`pnpm audit`: no known vulnerabilities. Images slim and non-root, tested before the deploy. Licence list current. Monthly routine written. Tests: acceptance 468, web 463, shared 314, API unit 54, Till Helper 98, all passing. Session 10 is **done** (30 October 2026).
