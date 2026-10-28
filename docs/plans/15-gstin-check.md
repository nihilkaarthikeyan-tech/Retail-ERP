# Plan 15: checking a GSTIN with the GST network (Stage 1)

Written 28 October 2026, for the owner's approval before building (it touches GST data).

## Why

Today a GSTIN is checked only for its shape and check character. A GSTIN that was never issued, or was **cancelled or suspended**, is accepted. A bill to a cancelled GSTIN goes wrong in GSTR-1, and the buyer cannot claim the credit. The shop also types the legal name and address by hand.

## Provider

**gstinapi.in** (owner, 28 October 2026). Lookups go through licensed GSP infrastructure (their terms, section 2). Their terms allow use inside our product: they forbid only reselling the answers as a rival verification service and copying the GSTIN database (section 5). 60 calls a minute; one credit (₹0.40–0.80) per successful lookup; a bad format, a GSTIN that does not exist, or a provider outage costs nothing. A sandbox GSTIN (`00AAAAA0000A1ZT`) answers for free, for tests.

The key is Rademics' own (one account for all shops), kept only on the server: `GSTINAPI_KEY` in `.env` locally and in `deploy/.env` on the server, typed in by the owner with a script, never in the browser, the repository or a chat.

**One switch.** The code talks to a small "GSTIN checker" with one method: give a GSTIN, get its details or "could not check now". gstinapi.in is the first one plugged in. Another provider (or a GSP of our own later) is a new plug-in behind the same switch; no screen changes.

## What the shop sees

1. **Customer and supplier forms, and an address's GSTIN.** After a complete, correctly-formed GSTIN is typed, a **Check with GST network** button (and an automatic check when saving a new one):
   - Found and active: legal name, trade name, state, PIN code and address are shown, with **Use these details** to fill the form. The state always comes from the GSTIN, as today.
   - **Cancelled or suspended:** a red warning with the cancellation date: "This GSTIN was cancelled on 12 Mar 2026. A tax invoice cannot be issued to it." Saving is still allowed (the shop may be recording an old supplier), but the warning stays on the record.
   - Not found: "The GST network has no such GSTIN. Check the number."
   - Could not check (no internet, provider down, no key): "Could not check with the GST network just now; it will be checked later." Saving goes ahead.
2. **The record remembers** the result: status (active / cancelled / suspended / not found), legal and trade name, when it was checked. Shown as a small badge next to the GSTIN: "Active, checked 28 Oct 2026".
3. **Re-checked later, not on every bill.** A nightly job re-checks GSTINs last checked more than 90 days ago, and ones that could not be checked, at most a set number a night per shop (so credits stay small).
4. **Till buyer box** (business tax invoice at the till): when online, the same check, warning on a cancelled GSTIN. Offline, nothing changes. *Optional in this stage; can follow in a small step.*
5. **Settings** (owner only): "Check GSTINs with the GST network" on or off for the shop (default on), and the re-check interval (default 90 days).

## What it costs

One check per new business customer or supplier, plus one every 90 days. A shop with 200 business customers and suppliers spends about 200 credits at first and about 70 a month after: roughly ₹30–60 a month at today's prices. Rademics' account pays; the admin screen will show credits used per shop later (platform admin, plan 14).

## Data and privacy

A GSTIN and the business details behind it are public registration data. Only the GSTIN is sent; never the customer's name, mobile or bills. The answer is stored only on that customer's or supplier's record (no copy of the GSTIN database, as the provider's terms require). Each check is written to the change history (who, when, result), without the API key.

## Building it

| Part | What |
| --- | --- |
| Database | On customers, suppliers and addresses: `gstinStatus`, `gstinLegalName`, `gstinTradeName`, `gstinCheckedAt`, `gstinCancelledOn`; a small table of checks for the history and for counting credits per shop |
| API | `POST /gstin/check` (customers.manage or suppliers.manage), the provider switch, the gstinapi.in plug-in, the nightly re-check, limits (per shop per day, and 60 a minute overall) |
| Screens | The button, the result box with "Use these details", the badge, the warning, the setting |
| Server | `deploy/set-gstin-key.sh`: asks for the key, writes it to `deploy/.env` (root only), restarts the API |
| Tests | Automated tests use a fake provider (no network, no credits); one manual check with the sandbox GSTIN; one real lookup with a free credit before going live |

Size: one session.

## Not in this stage

Supplier return filing status (Stage 2), e-invoices and e-way bills sent directly (Stage 3), bulk checks of an imported list (can come later with the import screen).

## Decided (owner, 28 October 2026)

The owner asked to proceed and to launch as soon as possible, leaving the choices to the recommendations:

1. Plan approved; built the same day.
2. A cancelled, suspended or unknown GSTIN is **warned about, never refused**: the record can always be saved.
3. GSTINs are checked again every **90 days** (Settings, GST: 30 to 365 days), at night, at most 50 records per shop per night; at most 300 paid checks per shop per day.

Built as planned, with two simplifications: each check is kept in its own table (`GstinCheck`) instead of the change history, and the till's buyer box and an address's own GSTIN are left for a later small step.
