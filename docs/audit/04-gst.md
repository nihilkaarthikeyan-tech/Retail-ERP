# Audit 04: GST and the law    Date: 28 October 2026

Scope: `apps/api/src/gst`, `gst-portal`, the GST parts of `pos`, `purchasing`, `documents` and `reports/gst-returns`; `packages/shared/src/gst-core.ts`, `gst-returns.ts`, `gst-portal.ts`, `gst-inward.ts`; the till engine and receipts (`apps/web/src/lib/till`, `apps/till-helper`).

How: four read-only helpers (invoices and documents; place of supply and rates; returns; e-invoice and e-way bill). Every rule was checked against an official source. Helpers that could not open a government page said so, and their claims were re-read by hand in the browser on official pages only (taxinformation.cbic.gov.in, cbic-gst.gov.in, gstcouncil.gov.in, the e-invoice and e-way bill portals). Plain defects against a confirmed rule were fixed at once. Fifteen changes to how tax is charged or filed went to the owner (T1–T15), who accepted all of them on 28 October 2026 ("accept all … seek the official govt platforms if any doubt"); they are recorded in `docs/decisions.md`.

## Rules checked, with their sources

| Rule | Source | Where in the code |
| --- | --- | --- |
| Tax invoice contents, 16-character number, unique per year | CGST Rules 46, 46(b) | `gst-core.ts`, `print.service.ts`, receipts |
| Bill of supply, composition declaration at the top | Rule 49, Rule 5(1)(f) | `gstDocumentTitle`, `BILL_OF_SUPPLY_DECLARATION` |
| Invoice-cum-bill of supply | Rule 46A | `saleDocumentKind` |
| Credit note contents: original invoice, buyer name and state for walk-ins | Rule 53(1A)(e)–(g) | `pos-bills.service.ts` returns |
| Credit note time limit (30 November of the next year) | CGST Act s.34(2) | `creditNoteDeadline`, returns refund without GST reduction |
| Three copies of a tax invoice for goods | Rule 48(1) | `print.service.ts` `copies`, `print-document.tsx` |
| Place of supply: walk-in at the counter, deliveries, "bill to / ship to" | IGST Act s.10(1)(a), (b); s.10(1)(ca) not yet in force | `resolveSupply` |
| SEZ supplies inter-state, with IGST or under LUT; endorsement | IGST Act s.7(5)(b), s.16; Rule 46 third proviso | `resolveSupply`, `SEZ_WITH_IGST`, `SEZ_UNDER_LUT` |
| Composition: no inter-state sales; 0.5% + 0.5% of taxable turnover | CGST Act s.10(2)(c), Rule 7 | `resolveSupply`, GSTR-3B `composition` (CMP-08) |
| Composite and mixed supplies | CGST Act s.2(30), s.2(74), s.8 | delivery charge (T4), buy-one-get-one (T12) |
| Buy one, get one free: two supplies for one price | CBIC circular 92/11/2019-GST, para B | `settleRates` (API), `priceBill` (till) |
| HSN digits: 4 up to ₹5 crore (business invoices), 6 above | Notification 78/2020-Central Tax | GST settings check, business invoice HSN check |
| E-invoice from ₹5 crore turnover in any year since 2017-18 | Notification 10/2023-Central Tax | GST settings wording |
| No GST on advances for goods (non-composition) | Notification 66/2017-Central Tax | customer order advances carry no GST (already so) |
| Input credit only when in GSTR-2B; time limit; unpaid 180 days | CGST Act s.16(2)(aa), s.16(4); Rule 37 | `creditAdjustment`, GSTR-3B |
| Reverse charge: self-invoice and payment voucher | CGST Act s.31(3)(f), (g); Rule 52 | `rcm_self_invoice` print, payment voucher |
| IFF for quarterly filers (business invoices, months 1–2) | Rule 59(2) | `gstr1` with a month, filed IFF months left out of the quarter |
| GSTR-1 offline tool: no negative B2CS or HSN rows | GSTN offline tool FAQ 29 | `gst-returns.ts` |
| E-invoice fields (lengths, GSTIN pattern, HSN digits, SEZWP / SEZWOP, RegRev) | e-invoice schema and validations (einvoice1.gst.gov.in) | `gst-portal.ts` |
| IRN cancel within 24 hours; not while an e-way bill runs | e-invoice API rules | `einvoices.service.ts`, `common/live-irn.ts` |
| E-way bill validity starts with Part B | Rule 138(10) | `eway-bills.service.ts` |

## Findings

| # | Severity | Where | What was wrong | Status |
| --- | --- | --- | --- | --- |
| 1 | High | GSTR-1, e-invoice, e-way bill | SEZ sales filed as ordinary B2B ("R", B2B), and an SEZ in the shop's own state lost its IGST in GSTR-1 | ✔️ Fixed: SEWP / SEWOP, SEZWP / SEZWOP, always inter-state; GSTR-3B 3.1(b) |
| 2 | High | GSTR-1 upload | Minus B2CS and HSN rows (returns larger than sales in a month) are refused by the portal | ✔️ Fixed: such rows are left out (offline tool FAQ 29) |
| 3 | High | e-invoice file | Text fields under the schema's minimum, GSTIN format unchecked, 4-digit HSN where 6 is required, reverse charge never flagged | ✔️ Fixed, with unit tests |
| 4 | High | quarterly filers | No IFF; invoices filed in an IFF would be filed again in the quarter | ✔️ Fixed: a month of a quarterly filer is its IFF (business invoices and notes only, not the third month); a marked IFF month is left out of the quarter's tables 4 and 9B |
| 5 | High | till bills, transfers | A bill or transfer could be cancelled while its e-invoice (IRN) was live; an IRN could be cancelled while its e-way bill ran | ✔️ Fixed: both refused with the steps to take |
| 6 | High | prints | Transfer documents without value or tax for people without cost rights; receipts without the unit; the tax-table setting could hide all tax; challans without addresses; no SEZ endorsement, reverse-charge line, copy markings; composition declaration in the wrong place | ✔️ Fixed (print service, receipts on screen and on the till helper) |
| 7 | Medium | GSTR-3B | No table 5 (purchases without tax) | ✔️ Fixed |
| 8 | Medium | till returns | A return of a bill made under another GSTIN of the company reduced tax at the wrong GSTIN | ✔️ Fixed: refused online, flagged offline |
| 9 | Medium | GSTR-1 table 13 | Transfers of all GSTINs share one counter, so one GSTIN's table showed the other's numbers as missing | ✔️ Fixed: numbers used by another GSTIN are not counted as missing (they stay unique within each GSTIN) |
| 10 | Medium | business invoices | An item without an HSN code could go on a tax invoice to a business | ✔️ Fixed: refused online, flagged offline |
| 11 | Medium | rates | A compensation cess rate could be saved, but bills never charge it | ✔️ Fixed: a cess rate is refused until cess is built (none of the launch sectors sells cess goods) |
| 12 | Low | bills | The buyer's tax situation was read from the customer each time, so editing a customer changed past returns | ✔️ Fixed: saved on the bill (migration `20261028190000_bill_buyer_situation`) |
| 13 | Low | GST settings | Above ₹5 crore turnover a 4-digit HSN setting was allowed | ✔️ Fixed: refused |
| 14 | High | GSTR-1 | Found by the new tests: an SEZ supply under LUT (0%) was read as nil-rated and left out of B2B | ✔️ Fixed: zero-rated SEZ lines stay in B2B (SEWOP) |
| 15 | Medium | e-way bill | Found by the tests: a validity read from the portal's file was dropped when our record had no vehicle | ✔️ Fixed: a validity from the portal means Part B was filled there |

## The owner's decisions (T1–T15), as built

| # | Decision | Built |
| --- | --- | --- |
| T1 | A walk-in taking goods at the counter is taxed by the shop's state | `resolveSupply` |
| T2 | "Delivered to someone else on the buyer's behalf": the buyer's own state | tick box in the till's delivery dialog, `PosDelivery.forOther` |
| T3 | A composition shop cannot sell to another state | refused online, flagged offline |
| T4 | Delivery charges take the goods' rate (the highest) | API and till engine |
| T5 | No "exempt buyer" | customer situation is regular, SEZ or reverse charge (customer form) |
| T6 | SEZ with IGST, or without tax under LUT | GST setting "Sell to SEZ units without GST (LUT)" |
| T7 | A credit note after the time limit refunds without reducing GST | return note |
| T8 | A till credit note to a walk-in carries their name and state | asked with "Buyer" on the return |
| T9 | A return without the bill is a return note, not in GSTR-1 | `documentKind = return_note` |
| T10 | Exempt with taxable goods: invoice-cum-bill of supply; separate documents for a business | `saleDocumentKind` |
| T11 | Credit only when in GSTR-2B, not after the s.16(4) limit; Rule 37 reminder | GSTR-3B 4(A)(5) adjusted, held-back and time-barred rows, notes |
| T12 | Buy one, get one: free pieces share the price for the band; a free other item makes the bill line take the higher rate | circular 92/11/2019 read first (still in force; it was circular 105/24/2019 that was withdrawn) |
| T13 | Composition quarterly statement (CMP-08 figure) | GSTR-3B screen shows CMP-08 for a composition shop |
| T14 | Reverse-charge self-invoice and payment voucher | "Self-invoice" print on a supplier bill; payment voucher shows the reverse-charge tax |
| T15 | Months marked as filed; later bills go to the next open month | "Mark GSTR-1 / IFF as filed" on the GSTR-1 screen; `GstFiledPeriod`, `PosBill.gstPeriod` |

## Accepted, with the reason

- **Credit note limit "or the annual return, if earlier"** (s.34(2)): the software cannot know when the annual return is filed, so it uses 30 November; the notes register shows each note's deadline for the accountant.
- **Input credit held back in a month without a GSTR-2B**: that month keeps the credit in the accounts and its 3B says to import the GSTR-2B before filing. A month with a GSTR-2B holds back and later releases bills exactly.
- **Fix 9 of the e-way helper (delivery charges in the Rule 138 value)**: the official page could not be opened; delivery charges stay out of the e-way value until it is read (carried to Session 12, live server, with the other portal checks).
- **SEZWPA / SEZWPNA**: the e-invoice field list mentions a future split of SEZWP with no start date; SEZWP is still in the schema. To check again before e-invoicing goes live for a shop.
- **Offline credit notes**: the till offline does not yet carry the original bill's buyer for the receipt; the server fills them when the bill syncs and flags a credit note with no name.

## Tests

- `module15-audit4.e2e-spec.ts`: SEZ with IGST and under LUT (GSTR-1 SEWP / SEWOP, GSTR-3B 3.1(b)); no "exempt" buyer; invoice-cum-bill of supply and the refusal for a business; HSN on business invoices; delivery at the goods' rate; credit note needs the walk-in's name, return note without the bill left out of GSTR-1; cess refused; cancel refused while an IRN is live; GSTR-3B notes without GSTR-2B and table 5; a filed month sends a late bill to the next month; IFF month; composition CMP-08 and the inter-state refusal; HSN digits above ₹5 crore.
- `gst-inward.spec.ts`: credit held back, released, and time-barred (3 new).
- `gst-core.spec.ts`, `gst-portal.spec.ts` (8 new), `print.service.spec.ts` (12), receipt tests on the web (2 files) and the till helper (6 new).

## Result

Fifteen findings (five High) fixed with tests, and the owner's fifteen decisions built. Full suite run alone afterwards: 437 of 437 acceptance tests, shared 312, web 402, API unit 53, till helper 84, all passing. Two items are carried to Session 12 (live server) and recorded above. Session 4 is **done** (28 October 2026).
