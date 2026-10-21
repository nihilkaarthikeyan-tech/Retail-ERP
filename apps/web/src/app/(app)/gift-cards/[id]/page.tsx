// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { use } from "react";
import { GiftCardDetail } from "@/components/loyalty/gift-card-screens";

/** Plan 13 §2: one gift card with its history. */
export default function GiftCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GiftCardDetail id={id} />;
}
