-- Copyright (c) 2026, Rademics. All rights reserved.
-- Owner decision of 22 Oct 2026: GST settings and rates apply as soon as they
-- are saved; there is no separate approval step, so the approval right goes.
-- The approvedAt columns stay as history.
DELETE FROM "RolePermission" WHERE "permissionKey" = 'gst_rates.approve';

-- New bills are never provisional; old bills keep the flag they were saved with.
ALTER TABLE "PosBill" ALTER COLUMN "gstProvisional" SET DEFAULT false;
