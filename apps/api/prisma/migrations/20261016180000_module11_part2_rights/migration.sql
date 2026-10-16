-- Copyright (c) 2026, Rademics. All rights reserved.
-- Permission keys of plan 11 part 2 for the system roles.
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'orders.manage'), ('owner_admin', 'alterations.manage'), ('owner_admin', 'tally.export'),
  ('store_manager', 'orders.manage'), ('store_manager', 'alterations.manage'),
  ('cashier', 'orders.manage'), ('cashier', 'alterations.manage'),
  ('accountant', 'tally.export')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
