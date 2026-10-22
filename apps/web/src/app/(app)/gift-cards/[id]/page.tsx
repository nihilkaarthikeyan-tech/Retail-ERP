// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { GiftCardDetail } from "@/components/loyalty/gift-card-screens";

/** Reads the card id from the address (runtime data, so it sits behind Suspense). */
async function GiftCard({ params }: { params: PageProps<"/gift-cards/[id]">["params"] }) {
  const { id } = await params;
  return <GiftCardDetail id={id} />;
}

/** Plan 13 §2: one gift card with its history. */
export default function GiftCardPage({ params }: PageProps<"/gift-cards/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <GiftCard params={params} />
    </Suspense>
  );
}
