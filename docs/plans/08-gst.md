# Plan 08 — Tax (GST)

**Status:** approved by the owner on 18 October 2026: business (B2B) tax invoices are made at the till only; GSTR-1 figures download as Excel and as the GST portal's offline-tool JSON.
**Basis:** `docs/blueprint/13-tax-gst.md`, decisions 21, 43, 56–64, and official government sources only (cited in the blueprint:
gst.gov.in, cbic-gst.gov.in, einvoice1.gst.gov.in, docs.ewaybillgst.gov.in, PIB).
**Rule (CLAUDE.md, changed 18 October 2026):** built now; every bill stays marked provisional and no real shop uses GST in
production until the Chartered Accountant approves the GST settings (questions 43 and 55–64).
**Changed 22 October 2026 (owner):** the approval step was removed. GST settings and rates apply as soon as they are saved,
new bills are never provisional, rates can be edited (each change in the history), and switching the tills live needs only
the Owner. The approve and withdraw-approval endpoints and the "Approve GST rates" right are gone; bills saved as provisional
before this date keep the mark as history. Where this plan still mentions the approval below, this note wins.

**Design principle (CLAUDE.md §1a):** the GST law is built once into the core for every business. Everything that differs
between businesses is a setting with a sensible default.

---

## 1. What is already in place (modules 1–7, 11)

- GST registrations, each store linked to one (GSTIN and state); GSTIN and state on customers, suppliers and each address.
- HSN code on items and item groups; a dated GST rate list per HSN, with cess and an "approved by the accountant" mark.
- CGST, SGST and IGST worked out and stored on every till line, purchase line and supplier bill line, tax-inclusive at the till.
- Input and output GST accounts per head, posted from purchases and till shifts. Till bills are flagged "provisional".

## 2. Common core (built once, same for every business)

| # | What | How it works |
| --- | --- | --- |
| G1 | **Place of supply** | Same state → CGST + SGST (half the rate each); other state → IGST. Walk-in with no address → the store's state. A delivery address in another state (home delivery, plan 11) → IGST. Purchases: supplier's state against the receiving store's GSTIN state. |
| G2 | **Rates by date and by price** | The rate in force on the document's date. Old documents keep their rate. **Price bands**: a rate can depend on the selling price per unit (needed for clothing and footwear). Exempt and nil-rated kept apart from 0%. |
| G3 | **Tax situation of a party or address** | Regular, unregistered, special economic zone, exempt, or reverse charge. Chooses the tax for the document. |
| G4 | **Business tax invoice from the till** | When the customer gives a GSTIN, the bill becomes a business tax invoice: buyer name, address, GSTIN and state, HSN per line, place of supply. Printed on A4 or the receipt. A business customer added at the till without a GSTIN is a consumer bill. |
| G5 | **Consumer bills** | Every bill is recorded (decision 60). Name, address and state are asked when the taxable value is ₹50,000 or more. Sales under ₹200 where no invoice is wanted can be shown as one combined daily invoice in the reports (a view only; the bills stay). |
| G6 | **Credit and debit notes** | Till returns and supplier debit notes carry the original invoice number and date. Warning (not a block) when a credit note is dated after 30 November following the year of the sale. |
| G7 | **Composition scheme** | A company setting: sales carry no tax, a "bill of supply" with the required declaration is printed, and input credit is not claimed (purchase tax goes into the cost of the goods). |
| G8 | **Reverse charge and blocked credit on purchases** | A supplier or bill line can be under reverse charge: tax is posted as payable by the shop and claimed as input credit where allowed. Tax that cannot be claimed is added to the cost of the goods. |
| G9 | **Free samples and offers** | "Buy one, get one" stays one supply at one price (decision 61). True free samples are a separate stock-out reason whose tax treatment is a setting the CA confirms. |
| G10 | **Delivery challan** | Transfers between stores print a delivery challan. Between stores under different GSTINs, a transfer is a taxable supply and is invoiced. |
| G11 | **Invoice numbering** | Unique per financial year per series, no unexplained gaps (already so). The documents-issued report counts first and last numbers, issued and cancelled per series. |
| G12 | **Rounding** | Tax rounded per line so the HSN summary adds up exactly. The bill total is rounded to the rupee, and the difference goes to the rounding account, never a tax account. Already the rule; confirmed by tests. |

## 3. GST reports and return figures

| Report | Contents |
| --- | --- |
| Sales tax register | Invoice by invoice: taxable value, tax per head, business or consumer, place of supply, per GSTIN. |
| Purchase tax register | Supplier GSTIN, bill, tax per head, credit claimable or not, reverse charge. |
| **GSTR-1 figures** | Business sales (B2B) line by line; large other-state consumer sales (B2CL, above ₹2.5 lakh); small consumer sales (B2CS) by state and rate; credit and debit notes (registered and unregistered); **HSN summary** (business and consumer separately, 4 or 6 digits by turnover band); documents issued. Downloadable as Excel, and as the JSON the GST portal's offline tool accepts. |
| **GSTR-3B figures** | Tax collected per head, input credit per head, reverse charge, set-off in the legal order (IGST first), net payable, credit carried forward. |
| Input credit matching | Upload the inward statement (GSTR-2B file) downloaded from the portal; matched, missing on either side, value differences. |
| Credit and debit note register | With the original invoice and the 30 November deadline flag. |
| GST payable position | For the owner dashboard tile already planned in module 9. |

Every report is per GSTIN (decision 64), for a month or a quarter (monthly or quarterly filing is a setting).

## 4. E-invoice and e-way bill (export now; provider later, decision 63)

- **E-invoice:** for businesses that must e-invoice (turnover above ₹5 crore, a setting), business invoices and their credit
  and debit notes are produced as the official e-invoice JSON. The file is uploaded to the government portal; its response
  file (reference number and signed QR code) is imported back and printed on the invoice. Until then the invoice prints as
  "not yet registered". Status list: waiting, registered, failed, cancelled, near the 30-day limit (turnover ₹10 crore and above).
  A direct provider connection is a later step (decision 63).
- **E-way bill:** for moves of goods above ₹50,000 (other state; same-state limit per state is a setting), the official
  e-way bill JSON for bulk upload is produced from the bill, delivery or transfer. The e-way bill number and validity are
  then entered or imported, and printed on the document. Validity: one day per 200 km or part.

## 5. Settings (what each business sets; defaults in brackets)

**Registration:** each GSTIN and its state (from setup); regular or composition [regular]; monthly or quarterly returns
[quarterly up to ₹5 crore]; turnover band for HSN digits and e-invoicing [up to ₹5 crore: 4 digits, no e-invoice].
**Rates:** GST rate list per HSN with dates, price bands, exempt or nil; item group defaults; every new rate needs the
accountant's approval before it is used for real bills (already so).
**Documents:** business invoice layout (A4 or receipt); whether the receipt shows a tax table; the combined daily invoice
for small sales [on]; free-sample tax treatment [CA to set].
**Moving goods:** e-way bill limit per state [₹50,000]; the usual transporter.
**Approval:** "GST settings approved by the CA" (who, when, note). Until this is ticked, every bill stays provisional and
live billing stays off (the existing go-live switch).

## 6. Data model (outline)

| Change | Fields |
| --- | --- |
| `GstSettings` (per company) | scheme, filing frequency, turnover band, HSN digits, e-invoice applies, small-sale combined invoice, free-sample treatment, approvedAt/By/note |
| `GstRate` | `exempt`/`nil` kind; price band (from and to selling price per unit) |
| Customer, supplier, address | tax situation (regular, unregistered, SEZ, exempt, reverse charge) |
| `PosBill` | invoice kind (consumer, business, bill of supply), buyer GSTIN and state at the time, place of supply |
| Supplier bill lines | reverse charge, credit claimable |
| `EInvoice` | document, status, reference number, acknowledgement, signed QR, dates, error |
| `EWayBill` | document, number, valid until, distance, transporter, vehicle, status |
| `GstReturnUpload` | uploaded inward statement for matching |

Through Prisma migrations, with audit fields and history, as for every module.

## 7. Tests

Acceptance scenarios go into `docs/acceptance-tests.md` ("Module 8") before building, including the CLAUDE.md minimum
"a GST invoice": consumer bill at the till (same state); business invoice to a registered buyer in another state (IGST);
price-band rate on a ₹2,000 and a ₹3,000 shirt; return as a credit note; composition bill of supply; reverse-charge
purchase; blocked credit added to cost; GSTR-1 figures and HSN summary for a sample month that add up to the sales register;
GSTR-3B set-off; e-invoice JSON and response import; e-way bill JSON and validity.
