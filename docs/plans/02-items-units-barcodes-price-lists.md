# Plan — Module 2: Items, units, barcodes, price lists

Status: **approved by the project owner on 14 October 2026** with these answers to section 8:
1. Kits and substitutes: later.
2. Item pictures: build now.
3. Automatic item codes on by default; typed codes still allowed.
4. Maximum discount per item defaults to 0 %.

Sources: `docs/blueprint/03-items.md`, `docs/blueprint/04-pricing-and-promotions.md` (price lists and prices only), `docs/decisions.md` (questions 9–13, 33–34, 56, 70, 76), launch scope row "Products, prices, barcodes".

## 1. What this module gives the business

After this module, the catalogue manager can:

1. Keep the list of **units** (piece, kg, g, litre, ml, metre, box…) and the standard conversions between them. Fractions are allowed only for weight, length and volume units (decision 11).
2. Build the **item group tree** (Grocery > Staples > Rice) and the **brand** list, with defaults that new items copy.
3. Keep the **HSN code list** (code and description; the GST rate per HSN comes with the GST module, decision 56).
4. Create **items**: code (typed or automatic), name, description, picture, group, brand, basic unit, other units with pack factors, **barcodes** (one or many, each optionally tied to a unit, unique across the catalogue, check-digit tested), HSN code, **MRP** (decision 76), maximum discount, stock/service flag, buy/sell flags, end date, batch and serial tracking flags.
5. Create **styles with variants** (size, colour…): readable codes like `SHIRT-RED-M` plus their own barcodes (decision 10); the parent style is never stocked or sold.
6. Keep **price lists** (selling or buying, INR) and **prices** per item and unit with start and end dates, and look up the right price for a line the way the blueprint describes.
7. **Scan a code** on any screen and get the item and the unit that barcode stands for.
8. See every change in the **history**, including price changes (reliability rule 9).

Stock, purchasing and sales are not touched. Batches and serial numbers themselves are created by goods receipts (modules 4–5); this module only records whether an item is tracked that way.

## 2. Data model (Prisma tables)

Every table has `createdAt`, `createdById`, `updatedAt`, `updatedById`. Money and quantities are `Decimal` (reliability rule 1).

| Table | Purpose | Main fields |
| --- | --- | --- |
| `Unit` | Counting units. | `code` (unique, e.g. `PCS`, `KG`), `name`, `kind` (`count` / `weight` / `length` / `volume` / `other`), `allowsFractions` (may be true only for weight, length, volume), `active` |
| `UnitConversion` | Standard conversions, stored once. | `fromUnitId`, `toUnitId`, `factor` (1 KG = 1000 G → from KG to G factor 1000); unique per pair |
| `ItemGroup` | Category tree. | `parentId`, `code`, `name`, `path` (for fast subtree queries), `isLeaf`, `hsnCode` default, `active` |
| `Brand` | Brand list. | `code`, `name`, `active` |
| `HsnCode` | HSN/SAC codes with descriptions. | `code` (4, 6 or 8 digits), `description`, `isService`, `active` |
| `Item` | Products and services. | `code` (unique), `name`, `description`, `image` (bytes, ≤ 500 KB) + `imageMimeType`, `itemGroupId` (leaf only), `brandId`, `baseUnitId`, `hsnCode`, `mrp` (per basic unit, nullable), `maxDiscountPercent`, `isStockItem`, `canBuy`, `canSell`, `endDate`, `active`, `isParentStyle`, `parentItemId`, `trackBatches`, `autoNumberBatches`, `shelfLifeDays`, `trackSerials`, `warrantyDays`, `lastPurchasePrice` (filled by module 5), `preferredSupplierId` (filled by module 3) |
| `ItemUnit` | Units an item is bought or sold in. | `itemId`, `unitId`, `factor` (basic units per this unit; the basic unit row always has factor 1), `mrp` (optional override for this pack); unique per item + unit |
| `Barcode` | Scannable codes. | `code` (unique across the catalogue), `itemId`, `unitId` (nullable), `type` (`EAN13` / `EAN8` / `UPCA` / `CODE39` / `other`, check digit verified for the first three), `active` |
| `VariantAttribute` | Size, Colour… | `code`, `name`, `kind` (`list` / `numeric`), `rangeStart`, `rangeEnd`, `rangeStep`, `active` |
| `VariantAttributeValue` | Allowed values with short codes. | `attributeId`, `value`, `shortCode`, `sortOrder`; unique within the attribute ignoring case |
| `ItemVariantAttribute` | Which attributes a style varies by. | `itemId` (parent), `attributeId`, `sortOrder` |
| `ItemVariantValue` | A variant's values. | `itemId` (variant), `attributeId`, `value`; no two variants of a parent share the same set |
| `PriceList` | Named sets of prices. | `companyId`, `code`, `name`, `forSelling`, `forBuying`, `currency` (INR), `pricesPerUnit` (false = price is per basic unit and other units are worked out), `active` |
| `Price` | One price. | `priceListId`, `itemId` (variant or simple item, never a parent style), `unitId`, `price`, `startDate`, `endDate`, `packSize`, `customerId` (nullable; module 3), `supplierId` (nullable; module 3), `batchId` (nullable; module 4); duplicates refused |
| `CatalogueSettings` | One row per company. | `autoItemCodes` (uses number series `item`), `defaultItemGroupId`, `defaultUnitId`, `defaultSellingPriceListId`, `defaultBuyingPriceListId`, `fallbackToDefaultSellingList`, `allowPriceChangeOnBill`, `blockSellingBelowCost`, `saveTypedPrices` |

Seeds (migration data, per company): units PCS, BOX, KG, G, L, ML, M, CM with conversions; price lists "Standard Selling" and "Standard Buying"; a `CatalogueSettings` row; number series `item` with pattern `ITM-` and 6 digits.

**Permission keys added:** `catalogue.view`, `catalogue.manage` (items, groups, brands, units, attributes, HSN list), `prices.view` (selling prices), `prices.manage`, `buying_prices.view` (decision 70: hidden from cashiers), `cost_price.view` (last purchase price and later cost; decision 70). Seed: Owner/Admin all; Store Manager `catalogue.view`, `prices.view`; Cashier `catalogue.view`, `prices.view`; Stock/Receiving `catalogue.view`; Accountant and Viewer/Auditor `catalogue.view`, `prices.view`, `buying_prices.view`, `cost_price.view`.

## 3. Business rules enforced in the backend

Units and quantities
- Basic unit row of every item has factor exactly 1; other factors must be above 0; a unit appears once per item.
- A unit with `allowsFractions = false` refuses fractional quantities everywhere quantities are entered (shared helper `assertQuantityAllowed(unit, qty)`, used by later modules too).
- A missing factor is filled from `UnitConversion` (direct, reverse, or one-step indirect through a common unit).
- The basic unit can be changed only while the item has no stock movements (module 4 adds the check; until then always allowed) and clears the other-unit list.

Items
- Code required and unique (upper-cased, letters, digits, `-`, `.`, `/`); name defaults to the code; group and basic unit required; only a leaf group may be used.
- A switched-off item, one past its end date, or a parent style cannot be used on any document (shared helper `assertItemUsable`).
- Serial tracking only on stock items. `trackBatches`, `trackSerials` and `isStockItem` cannot change once a finalised document uses the item (check added by module 4; recorded here as a rule).
- Auto codes come from number series `item` when `autoItemCodes` is on and no code is typed.
- Picture limited to JPEG/PNG/WebP, 500 KB.

Barcodes
- Unique across the catalogue. EAN-13, EAN-8 and UPC-A must pass the modulo-10 check digit; otherwise refused.
- A barcode tied to a unit must be one of the item's units.

Variants (decision 10)
- A parent style lists its attributes; a variant names one value per attribute; the set of values is unique within the parent.
- Variant code = parent code + `-` + value short codes in attribute order; name likewise. Up to 500 combinations per request; combinations that already exist are skipped.
- Prices and barcodes are set on variants, never on the parent. Attribute values cannot be renamed while variants use them.
- Numeric attributes: value must be within the range and on the step.

Price lists and prices (blueprint 04, process 1)
- A price's unit must be one of the item's units; a selling price may name a customer, a buying price a supplier, never the other way round; end date not before start date; exact duplicates refused.
- **Price lookup** `findPrice({ itemId, unitId, date, priceListId, customerId?, supplierId?, batchId?, quantity })` returns the price and how it was found:
  1. prices in the list for this item, valid on the date, for this unit or any unit, this batch or any batch, this party or general;
  2. prefer latest start date, then batch-specific, then unit-specific, then party-specific; if a pack size is set the quantity must be a multiple;
  3. if none: drop the party; then try the basic unit; then the parent style; then the default selling list if `fallbackToDefaultSellingList`;
  4. result for a different unit: × factor when `pricesPerUnit` is false, as stored otherwise.
  Returned as a Decimal string, never a float. Every step has a unit test.
- Price changes write a history row with old and new price (reliability rule 9).

Scanning (`GET /catalogue/scan/:code`)
- Exact barcode match → item + unit; else exact item code match → item + basic unit; else 404. Serial and batch matches are added by module 4. Switched-off items are reported as "not usable" with the reason.

## 4. Screens (Next.js)

| Screen | Who | Notes |
| --- | --- | --- |
| Items list | catalogue.view | Search by code/name/barcode, filter by group, brand, stock/service, active; shows MRP and standard selling price; cost columns only with `cost_price.view`. |
| Item editor | catalogue.manage | Tabs: Details, Units & barcodes, Tracking (batch/serial), Prices (inline prices across lists the user may see), History. Picture upload. |
| Style with variants | catalogue.manage | Pick attributes, tick values, "Create variants" shows the combinations before creating; variant table with codes, barcodes, prices. |
| Item groups, Brands, Units & conversions, Variant attributes, HSN codes | catalogue.manage | Simple list + editor pages; group page is a tree. |
| Price lists | prices.manage | List and editor; buying lists hidden without `buying_prices.view`. |
| Prices | prices.manage | Grid: pick a list, see items with current price and next scheduled price; edit inline; bulk "copy list A to list B with +x %" for later (not now). |
| Scan box | everyone | Component used in the items list header: scan or type a code, jump to the item. |
| Catalogue settings | Owner/Admin | Auto codes, defaults, price behaviour switches. |

## 5. API endpoints (NestJS)

```
GET/POST  /catalogue/units            PATCH /catalogue/units/:id
GET/POST  /catalogue/unit-conversions PATCH /catalogue/unit-conversions/:id
GET/POST  /catalogue/item-groups      PATCH /catalogue/item-groups/:id    (tree returned nested)
GET/POST  /catalogue/brands           PATCH /catalogue/brands/:id
GET/POST  /catalogue/hsn-codes        PATCH /catalogue/hsn-codes/:id
GET/POST  /catalogue/attributes       PATCH /catalogue/attributes/:id     (values inline)
GET       /catalogue/settings         PATCH /catalogue/settings

GET       /items?search&groupId&brandId&kind&active&page
POST      /items                      GET /items/:id   PATCH /items/:id
PUT       /items/:id/image            DELETE /items/:id/image   GET /items/:id/image
PUT       /items/:id/units            (whole list; basic unit factor 1 enforced)
GET/POST  /items/:id/barcodes         PATCH /items/:id/barcodes/:barcodeId
POST      /items/:id/variants         { values: { [attributeId]: [valueId…] } } → created variants
GET       /items/:id/variants
GET       /catalogue/scan/:code

GET/POST  /price-lists                PATCH /price-lists/:id
GET       /prices?priceListId&itemId&date
POST      /prices                     PATCH /prices/:id   (end-dating instead of deleting)
GET       /prices/lookup?itemId&unitId&priceListId&date&customerId&supplierId&quantity
```

Internal services for later modules: `CatalogueService.assertItemUsable`, `UnitsService.toBasicUnits(itemId, unitId, qty)`, `UnitsService.assertQuantityAllowed`, `PricingService.findPrice`.

## 6. Tests

Unit (no database): check-digit validation for EAN-13/EAN-8/UPC-A; variant code building and combination count; fraction rule per unit kind; unit conversion (direct, reverse, indirect); `findPrice` precedence table (customer vs general, dated, unit vs basic, parent fallback, default list fallback, pack size); Decimal arithmetic for per-unit prices.

Integration (test database): item create with auto code from the `item` number series; duplicate barcode refused across items; bad check digit refused; variant creation skips existing combinations; parent style cannot take a price or barcode; cashier gets selling prices but 403 on buying lists and no `lastPurchasePrice` field; price change writes history with old and new values; scan returns the unit tied to the carton barcode.

Acceptance scenarios: `docs/acceptance-tests.md`, section "Module 2".

## 7. Deliberately not built in this module

| Item | Why |
| --- | --- |
| Offers, slab promotions, coupons | They act at billing time; built with the point of sale (module 6) so they can be tested on real bills. Decisions 17–19 recorded for then. |
| Loyalty points, gift cards | Deferred by the launch scope. |
| Batches, serial numbers, opening stock, reorder levels, stock positions | Inventory module (4); items only carry the tracking flags here. |
| Kits (bundles) and substitutes | Not in the launch scope row; see question 1 below. |
| Weighing-scale (price-embedded) barcodes | Decision 9: OPEN until the first sector is chosen. The barcode table has a `type` column so it can be added without a schema change. |
| GST rate per item / HSN tax master | GST module after CA approval (decision 56). Items carry the HSN code only. |
| Merging two items | Rare; needs stock recalculation; later. |
| Multi-currency price lists | INR only (module 1 decision). |

## 7b. Decisions made while building (for the project owner to confirm)

1. **Price precedence.** Blueprint 04 lists the preference as "latest start date, then batch price, then unit price, then their own price", but its edge case says "a customer contract price wins over the general price". Taken literally, a newer general price would override an older contract price. Built as: **the party's own price first, then a batch price, then a pack-size price, then the latest start date, then the line's unit**. Tested in `packages/shared/src/pricing.spec.ts`.
2. **No price lookup on the parent style.** The blueprint both forbids prices on a parent style and says the lookup "repeats the search for the parent style". Since parents can never hold a price, that step can never find one; it is not built. Variants carry their own prices.
3. **HSN code on an item is validated by format only** (4, 6 or 8 digits); it does not have to exist in the HSN list, which is a helper for lookup. The GST module will require a rate per HSN later.
4. **Switched-off attribute values** are kept rather than deleted when in use by variants; the value list of an attribute can only be replaced if every value already used by a variant is still present.

## 8. Questions for the project owner

1. **Kits and substitutes** (a gift hamper sold as one line; "offer item B when A is out"). Build now, or wait until a customer asks? Recommendation: wait.
2. **Item pictures**: build now (upload JPEG/PNG up to 500 KB)? Recommendation: yes, it is small and the till uses it later.
3. **Automatic item codes** on by default (`ITM-000001`), with staff free to type their own code instead? Recommendation: yes.
4. **Maximum discount default** per item: start at 0 % (no cashier discount unless set)? Recommendation: yes; managers raise it per item.
