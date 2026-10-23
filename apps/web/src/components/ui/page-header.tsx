// Copyright (c) 2026, Rademics. All rights reserved.
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The same header on every screen (owner, 23 October 2026): a "← Back" link
 * above, the title on the left, the main buttons on the right.
 */
export function PageHeader({ title, back, note, children }: { title: ReactNode; back?: { href: string; label: string }; note?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      {back ? (
        <Link href={back.href} className="page-head-back">
          ← {back.label}
        </Link>
      ) : null}
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          {note ? <p className="page-head-note">{note}</p> : null}
        </div>
        {children ? <div className="page-head-actions">{children}</div> : null}
      </div>
    </header>
  );
}
