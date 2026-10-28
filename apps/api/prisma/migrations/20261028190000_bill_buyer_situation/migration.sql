-- Copyright (c) 2026, Rademics. All rights reserved.
-- GST audit 4: the buyer's tax situation as it was when the bill was made (regular, unregistered, sez,
-- reverse_charge), so a later change to the customer does not change past returns and prints.
ALTER TABLE "PosBill" ADD COLUMN "buyerSituation" TEXT;
