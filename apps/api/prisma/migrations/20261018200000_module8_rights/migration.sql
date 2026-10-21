-- Copyright (c) 2026, Rademics. All rights reserved.
-- Module 8 (GST): permission keys for the system roles, and GST-safe transfer numbers.
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'gst.input_credit'), ('owner_admin', 'gst.returns'), ('owner_admin', 'einvoice.manage'), ('owner_admin', 'eway.manage'),
  ('accountant', 'gst.input_credit'), ('accountant', 'gst.returns'), ('accountant', 'einvoice.manage'), ('accountant', 'eway.manage'),
  ('store_manager', 'eway.manage'),
  ('viewer_auditor', 'gst.returns')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;

-- GST invoice numbers may be at most 16 characters (CGST rule 46(b)); a transfer between
-- stores under different GSTINs is invoiced under its transfer number. Series still on the
-- old default pattern move to the short one; numbers already issued keep their old form.
UPDATE "NumberSeries" SET "pattern" = 'TRS/{FYS}/' WHERE "documentKind" = 'stock_transfer_send' AND "pattern" = 'TRS-{STORE}-{FY}-';
