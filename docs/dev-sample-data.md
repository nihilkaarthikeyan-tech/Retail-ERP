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

## Sample catalogue (module 2, loaded through the API on 14 October 2026)

- Groups: Grocery > Staples > Rice (HSN 1006); Apparel > Shirts (HSN 6205). Brand: India Gate.
- `ITM-000001` Basmati Rice 1 kg — PCS and BOX (12), barcodes `8901234567890` (piece) and `5901234123457` (box), MRP ₹120, selling ₹110, max discount 5 %.
- `ITM-000002` Loose Sona Masoori Rice — sold by KG at ₹62.
- `ITM-000003` Carry bag — service item (not stocked, not bought), ₹5.
- `SHIRT-OXFORD` Oxford Shirt — style varying by Colour (Red, Blue, White) and Size (S, M, L, XL); 12 variants `SHIRT-OXFORD-RED-S` … `SHIRT-OXFORD-WHT-XL`, MRP ₹1,499, selling ₹1,299.

To start again from an empty database:

```bash
pnpm --filter api prisma migrate reset
```
