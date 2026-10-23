// Copyright (c) 2026, Rademics. All rights reserved.
import type { ReactNode } from "react";

/**
 * What an empty list says (owner, 23 October 2026): a plain title, one line
 * on what to do, and the buttons that do it, so a new shop always knows the
 * next step.
 */
export function EmptyState({ title, text, children }: { title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {text ? <p className="empty-state-text">{text}</p> : null}
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  );
}
