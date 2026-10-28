-- Copyright (c) 2026, Rademics. All rights reserved.
-- Audit 2 (28 October 2026): a gift card load at the till keeps how it was paid and at which till,
-- so the till payments report includes card and UPI taken for gift cards.
ALTER TABLE "GiftCardEntry" ADD COLUMN "paymentMethodId" UUID;
ALTER TABLE "GiftCardEntry" ADD COLUMN "tillId" UUID;
