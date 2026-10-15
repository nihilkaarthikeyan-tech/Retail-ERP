// Copyright (c) 2026, Rademics. All rights reserved.
import { Badge } from "@/components/ui";
import { HOLD_LABELS, STATUS_LABELS } from "@/lib/parties";
import type { HoldType, PartyStatus } from "@/lib/types";

/** Active / Blocked / Switched off. */
export function PartyStatusBadge({ status }: { status: PartyStatus }) {
  const kind = status === "active" ? "ok" : status === "blocked" ? "warn" : "off";
  return <Badge kind={kind}>{STATUS_LABELS[status]}</Badge>;
}

/** Shown only while a hold is in force. */
export function HoldBadge({ hold, until }: { hold: HoldType; until?: string | null }) {
  if (hold === "none") return null;
  return (
    <Badge kind="warn">
      On hold: {HOLD_LABELS[hold].toLowerCase()}
      {until ? ` until ${until}` : ""}
    </Badge>
  );
}
