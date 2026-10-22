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

## Sample parties (module 3, loaded through the API on 15 October 2026)

- `WALK-IN-RRPL` Walk-in customer (created automatically; no credit, cannot be blocked).
- `CUS-000001` Lakshmi — quick-added with mobile 9876543210 (Retail).
- `CUS-000002` Bengaluru Traders — Wholesale, GSTIN `29AAACR1234A1ZD` (Karnataka → other-state GST), billing address in Bengaluru.
- `CUS-000003` Arun Traders — Wholesale, linked to supplier `SUP-000001`.
- `SUP-000001` Metro Distributors — Distributors, GSTIN `33AAACM1234B1ZQ`, Chennai address.
- `SUP-000002` Fast Movers Logistics — Transporters, marked as a transporter.
- Payment terms Cash, Net 15, Net 30; customer groups Retail, Wholesale, Staff; supplier groups Distributors, Local vendors, Services, Transporters.

## Sample stock (module 4, loaded through the API on 15 October 2026)

- Second store `ANNA` (Anna Nagar, Chennai) with its own Shop floor, Back room and Rejected locations; one company-wide Transit location.
- `CNT-MAIN-2026-27-00001` opening count at MAIN shop floor: 120 × Basmati Rice 1 kg at ₹90, 250 kg loose Sona Masoori at ₹52, 5 each of five Oxford Shirt variants at ₹650 — ₹40,050.00.
- `TRS-MAIN-2026-27-00001` / `TRR-ANNA-2026-27-00001`: 2 boxes (24 pieces) of Basmati Rice sent to ANNA and received.
- `SOT-MAIN-2026-27-00001`: 2 bags of Basmati Rice written off (damage), ₹180.00.
- Result: MAIN 94 and ANNA 24 Basmati Rice; total stock value ₹39,870.00.

To start again from an empty database:

```bash
pnpm --filter api prisma migrate reset
```

## Till demo data (added 21 October 2026)

- Owner's till PIN (test only): `2468` — unlocks the till and approves manager actions.
- Till T1 is registered to the browser at http://localhost:3001 ("Demo counter").
- Fancy and T-shirt items with barcodes 8903000000006 to 8903000000099 (20 in stock each at MAIN floor), customers Priya Raman (9840011001), Arjun Kumar (9840011002), Meena Stores (9840011003), and the offer FANCY10 (10% off fancy and gifts).

## A second shop (plan 14, signed up through /signup on 22 October 2026)

Shows that two shops on the same system never see each other's data.

- Shop: Meena Fashions (clothing, not registered for GST), first shop MAIN with till T1
- Owner login: `meena@demo-shop.test`, password `Meena-demo-2026` (development only)
- It starts empty: no items, customers or bills. The first shop's 26 items are not visible to it.

## Retail ERP admin (plan 14, made with the create-admin command on 22 October 2026)

The people who run the Retail ERP service: every shop, switching a shop off or on, the landing page messages.
Not part of any shop. Log in at http://localhost:3001/admin/login.

- Email `admin@retailerp.test`, password `646cpnPnDBZAOnTXTKbx` (development only; made by `node dist/platform/create-admin.js`)
- On the company server the admin is made with the same command and the password goes into a root-only file (deploy/README.md).
