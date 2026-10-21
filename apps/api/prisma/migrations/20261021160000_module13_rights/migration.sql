-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 13 (loyalty points and gift cards): permission keys for the system roles.
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'loyalty.manage'), ('owner_admin', 'loyalty.view'), ('owner_admin', 'giftcards.sell'), ('owner_admin', 'giftcards.view'), ('owner_admin', 'giftcards.manage'),
  ('accountant', 'loyalty.view'), ('accountant', 'giftcards.view'),
  ('store_manager', 'loyalty.view'), ('store_manager', 'giftcards.sell'), ('store_manager', 'giftcards.view'), ('store_manager', 'giftcards.manage'),
  ('cashier', 'giftcards.sell'),
  ('viewer_auditor', 'loyalty.view'), ('viewer_auditor', 'giftcards.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
