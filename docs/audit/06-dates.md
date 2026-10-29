# Audit 06: Dates, numbers and the Indian calendar    Date: 29 October 2026

Scope: everything that uses a date or shows a number: the API and shared code, the web screens, the till, the Till Helper, prints, exports and e-mails.

How: two read-only helpers (business dates on the server; dates and amounts as people see them). Each finding was checked in the code and fixed; nothing needed an owner decision. A new date test suite runs with the server clock set a few minutes either side of midnight on 31 March.

## What was checked and found right

- Every business date on the server comes from `businessDate()` (Indian time) or from a date the user typed; date columns are written and read back as plain dates, so the server's own time zone never shifts them.
- Document numbers, financial years and GST periods come from the Indian date: a bill at 00:05 on 1 April starts the new year's series.
- Every scheduled job runs on Indian time and takes "today" from the Indian date.
- Month ends and 29 February are handled; gift cards, points and batches expire by their dates.
- In the browser and on the till, every "today", default date and report range is the Indian day, whatever the computer's own time zone. Till receipt times are Indian time.
- Prints show "16 Oct 2026" and ₹ with Indian grouping; report CSVs keep plain numbers and ISO dates (right for Excel).

## Findings

| # | Severity | Where | What was wrong | Status |
| --- | --- | --- | --- | --- |
| 1 | High | `apps/web/src/lib/format.ts` | Date-times on screens (audit history, bill times, e-way validity, till reports and their CSV) used the computer's own time zone: a PC set to UTC showed 31 Oct 18:40 for a bill at 00:10 IST on 1 Nov | ✔️ Fixed: always Indian time; tested under four machine time zones |
| 2 | Medium | `accounting/payments.service.ts` | Linking a payment to a bill dated the link on the UTC day (31 March for 00:20 IST on 1 April), so year-end open items were wrong | ✔️ Fixed: the Indian date |
| 3 | Medium | `financial-years.service.ts` | After a short first year, no next year was ever created and nobody was warned; from 1 April every bill would be refused | ✔️ Fixed: a short year ending 31 March is followed by a regular year automatically; "Needs your attention" warns 15 days before the last year ends when none follows |
| 4 | Medium | `shifts.service.ts` | A till whose clock was behind could open a shift dated in the past | ✔️ Fixed: a shift cannot open before the till's last close |
| 5 | Medium | audit history | Changed dates showed as "2026-04-01T00:00:00.000Z" | ✔️ Fixed: shown as dates and Indian times |
| 6 | Medium | web layout | Date boxes could show month first on a PC set to US English | ✔️ Page language set to English (India); shops should also set Windows and Chrome to English (India) (in the hands-on checklist) |
| 7 | Medium | nightly jobs | A job missed while the API was down (an update at 2 am) was skipped until the next night | ✔️ Fixed: missed jobs run once a minute after start-up on the live server |
| 8 | Low | `financial-year.ts` | A year ending in February got the wrong next end in leap years | ✔️ Fixed |
| 9 | Low | print service | The statement of account was dated on the UTC day; amounts inside sentences were not grouped | ✔️ Fixed |
| 10 | Low | summary e-mail | A send time after 23:55 was never sent; the subject showed 2026-10-27; amounts went through a float | ✔️ Fixed: up to 23:55, "27 Oct 2026", grouped from the decimal text |
| 11 | Low | screens, till | ISO dates on receipts (credit note's original bill, delivery date), orders, alterations, supplier holds, quick search, till messages | ✔️ Fixed: "27 Oct 2026" |
| 12 | Low | Till Helper | Paper receipts printed 15-10-2026 and amounts without grouping | ✔️ Fixed: "15 Oct 2026 10:30" and 1,25,000.00 |
| 13 | Low | screens, till | Money shown without ₹ or grouping (items MRP, credit limits, settings, GST bands, labels, till messages); one GST sum through a float | ✔️ Fixed |
| 14 | Low | dashboard | The greeting used the PC's hour | ✔️ Fixed |

## Accepted, with the reason

- **Imports**: a two-digit year in a business date reads as 20xx (right for documents); birthdays already read a future two-digit year as the last century. A US-ordered file whose day is 12 or less cannot be told apart; the import template says "day first".
- **Shops open past midnight** close and reopen the shift at 00:00 online (blueprint rule 15); offline the till carries on (audit 5, C2).
- **The all-data export** stamps a UTC time in its READ ME (a raw backup).

## Tests

- `module17-dates.e2e-spec.ts` (5), server clock at 23:50, 23:59:30, 00:05, 00:10 and 00:15 IST on 31 March / 1 April: the shift and bill before midnight belong to 31 March and 2026-27 (period 2027-03); after midnight an online bill on yesterday's shift is refused, the new shift and bill belong to 1 April and 2027-28 (number MAT1/2728/000001, period 2027-04), the closing entry stays on 31 March; a stock document is dated 1 April; a clock that is behind cannot open a shift; the e-mail time is limited to 23:55.
- Already present: numbering and the nightly year job at midnight (`module1`), business dates under four machine time zones (`format.test.ts`, now also date-times).
- New unit tests: next financial year across February, Indian grouping.

## Result

One High and every Medium and Low fixed with tests. Full suite run alone afterwards: 460 of 460 acceptance tests (including the new midnight suite), web 458, shared 314, API unit 53, Till Helper 98, all passing. Session 6 is **done** (29 October 2026).
