# Official GST reference data

| File | Source | Published | SHA-256 |
| --- | --- | --- | --- |
| `HSN_SAC-2026-10-26.xlsx` | GST portal, https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx (downloaded 28 October 2026) | 26 October 2026 | `051108e31063f1ef0d6dfb005a622bcc848878fa2d94fae51a73e67f8916871e` |

Two sheets: `HSN_MSTR` (goods, 21,935 codes) and `SAC_MSTR` (services, 681 codes), each with the code and its official description.

The API loads the file into the `OfficialHsnCode` table when it starts, once per version (`apps/api/src/gst/official-hsn.service.ts`). Codes and descriptions only: GST rates are each shop's own setting (Billing counter → GST rates).

**To update:** download the new file from the same address, save it here as `HSN_SAC-<published date>.xlsx`, change `HSN_FILE` in `official-hsn.ts`, add a row above, and deploy. The next start replaces the list.
