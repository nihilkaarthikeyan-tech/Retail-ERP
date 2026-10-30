# Audit 12: The live server, backups and running it    Date: 30 October 2026

Scope: `deploy/`, the live server (ssh `rademics`), the deployment rules in the owner's global CLAUDE.md. Every server change had the owner's approval (30 October 2026). Each was backed up first and checked against all 29 sites on the server before and after.

## What was checked, and found right

| Check | Result |
| --- | --- |
| HTTPS | Certificate valid to 11 December 2026, renewed by Certbot; plain HTTP is sent to HTTPS |
| IPv4 and IPv6 | The site runs through Cloudflare, which answers on both (A and AAAA records). The server itself has no IPv6 address, so this site depends on Cloudflare for Airtel users |
| Safety headers | X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on the site and the API |
| Shop data kept apart | The API logs in as `retail_erp_owner` (not the superuser). Every shop request switches to `retail_erp_app`, which row-level security applies to (134 of 135 tables; the other is Prisma's migration list) |
| Nothing exposed | `/.git/HEAD`, `/.env`, `/deploy/*`, `/docker-compose.yml`, backup and dump paths: all 404 |
| Ports | Web 127.0.0.1:4060 and API 127.0.0.1:4061 only; the database has no port on the server at all; the firewall allows only 22, 80 and 443 |
| Files | `/opt/retail-erp` owned by root, 755; `deploy/.env` 600; backups 700; nothing writable by the web server. Both apps run as `node`, not root. The images hold no sources, tests or speed tests |
| Backups | Nightly at 04:00 Indian time, kept only if they read back, 14 days kept |
| Logs | Containers keep 5 × 20 MB each |
| Disk and memory | 42% of 388 GB used; 31 GB memory, 20 GB free |
| Security upgrades of 27 October | Live since then; every audit since has been deployed |

## Findings

| # | Severity | What was wrong | Status |
| --- | --- | --- | --- |
| 1 | High | No alert when the Retail ERP breaks. The server's site monitor only checks that the home page opens, and the home page still opens when the API or the database is down | ✔️ `deploy/health-check.py`, every 5 minutes: API, database, web app, last night's backup, disk. Emails editor.publicationmart@gmail.com once when something goes wrong and once when it comes back. Tested: the email arrived |
| 2 | High | A restore had never been done on the live server | ✔️ `deploy/restore-check.sh`: a fresh backup restored into a temporary database beside the live one in 1 s: 135 tables, 22,991 rows, 21 triggers, 134 tables with row-level security, every table equal to the live database; then deleted. The live database is only read |
| 3 | Medium | No HSTS: browsers did not know to use HTTPS only | ✔️ `Strict-Transport-Security: max-age=31536000` on this site only (not the other 52digit.com sites) |
| 4 | Medium | No memory limits: a fault in the Retail ERP could take memory from the 30 other sites on the server | ✔️ Database 2 GB, API 1.5 GB, web 768 MB (they use 32, 208 and 66 MB); a container that reaches its limit restarts alone |
| 5 | Medium | No written guide for when it breaks, no rollback, and the knowledge to run it in one head | ✔️ `docs/runbook.md`: where everything is, first steps, each alert, rollback, restore, a new server, the server rules |
| 6 | Medium | 20 tills at once never timed on the server (audit 8) | ✔️ `deploy/speed-check.sh` with `apps/api/perf/tills20.perf.ts`, in a throwaway copy with made-up data; results below |
| 7 | Low | The backup and health logs grew without limit | ✔️ Weekly, 8 weeks kept (`deploy/retail-erp.logrotate`) |
| 8 | Low | E-way bill value and delivery charges (carried from audit 4) | ✔️ Checked against the official CBIC e-way bill FAQ: the consignment value is for the goods only, not services, and does not include freight for the movement. Delivery charges stay out of the e-way value, as built |

## 20 tills on the live server

One shop with 20 tills and 60 items in a throwaway copy, capped at 2 of the server's 8 CPUs, on 30 October 2026 at 15:43 Indian time (no Retail ERP activity on the live system in the 2 hours before). Time to save a 3-item bill:

| Situation | Bills | Middle | 95 in 100 within | Slowest |
| --- | --- | --- | --- | --- |
| One till alone | 40 | 0.10 s | 0.12 s | 0.13 s |
| Busy rush: every till a bill every 2 seconds (600 bills a minute) | 300 | 0.10 s | 1.21 s | 2.15 s |
| All 20 tills pressing "finish" in the same instant, 15 times | 300 | 0.60 s | 0.85 s | 0.92 s |

The 2-second target holds. Even the extreme cases stay at about 2 seconds, at roughly 20 times the bills of a real busy shop. On the office laptop the same test gave 0.26 s for one till alone. The live server is about 2.5 times faster. To run it again: `sh /opt/retail-erp/app/deploy/speed-check.sh`.

## Not done, with the reason

- **A copy of each night's backup kept off the server.** The owner is choosing where: cloud storage such as Backblaze B2, Google Drive, or an office computer. Until then, losing the server's disk loses every shop's data. This is the one item still open for the go-live list.
- **Database changes under their own login** (from audit 7). The API's login owns the tables, so it can apply database changes at start-up. Shop requests still run under the limited role. Splitting the two needs a one-off migration step in every deploy. It is listed in `docs/pending-work.md`, to do before many shops.
- **SEZ e-invoice codes** (from audit 4). The schema still uses SEZWP / SEZWOP. Check again when the first shop switches on e-invoicing; the portal refuses a wrong code.
- **A content security policy** (which scripts a page may run). Next.js puts its own small scripts in each page, so a strict policy needs a per-request code built into the pages. The other headers and HTTPS-only already cover the main risks; this is for Session 14.

## Result

The deployment checklist in the owner's global CLAUDE.md passes, and a restore has been done on the live server. Session 12 is **done** (30 October 2026), except the off-server backup copy, which waits on the owner's choice.
