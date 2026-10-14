# Development sample data

Used only on developers' machines. Never use these on the company server.

## Sample owner login (entered through the first-run setup screen on 14 October 2026)

- Email: `owner@rademics.test`
- Password: `Owner-pass-2026`

## Sample company

- Rademics Retail Pvt Ltd, code RRPL, Tamil Nadu (33), Chennai
- GSTIN `33AAACR1234A1ZV` (format-valid sample, not a real registration)
- Financial year 2026-27 (1 April 2026 – 31 March 2027)
- First store: MAIN, "Main Store"

To start again from an empty database:

```bash
pnpm --filter api prisma migrate reset
```
