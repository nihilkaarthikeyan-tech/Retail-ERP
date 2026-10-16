-- Copyright (c) 2026, Rademics. All rights reserved.
-- Permission keys of plan 11 for the system roles.
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'sales_staff.manage'), ('owner_admin', 'deliveries.manage'), ('owner_admin', 'expenses.post'),
  ('accountant', 'expenses.post'),
  ('store_manager', 'sales_staff.manage'), ('store_manager', 'deliveries.manage'), ('store_manager', 'expenses.post')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
