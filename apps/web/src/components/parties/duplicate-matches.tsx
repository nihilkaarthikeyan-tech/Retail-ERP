// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import type { DuplicateMobileBody } from "@/lib/types";

interface DuplicateMatchesProps {
  duplicate: DuplicateMobileBody;
  busy?: boolean;
  /** Sends the same record again with confirmDuplicate: true. */
  onAddAnyway: () => void;
  onCancel?: () => void;
}

/** Decision 20: the mobile already belongs to someone; show them and let the user decide. Never merged automatically. */
export function DuplicateMatches({ duplicate, busy, onAddAnyway, onCancel }: DuplicateMatchesProps) {
  return (
    <div className="alert alert-info" role="alert">
      <p style={{ marginTop: 0 }}>
        <strong>This mobile number is already on file.</strong> {duplicate.message}
      </p>
      <ul>
        {duplicate.matches.map((m) => (
          <li key={m.id}>
            <Link href={`/customers/${m.id}`}>
              <span className="mono">{m.code}</span> — {m.name}
            </Link>
            {m.mobile ? <span className="muted"> · {m.mobile}</span> : null}
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <Button variant="primary" size="small" busy={busy} onClick={onAddAnyway}>
          This is a different person — add anyway
        </Button>
        {onCancel ? (
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
