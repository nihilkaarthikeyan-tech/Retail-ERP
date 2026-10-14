// Copyright (c) 2026, Rademics. All rights reserved.
import type { ReactNode } from "react";

interface AlertProps {
  kind?: "error" | "success" | "info";
  children: ReactNode;
}

/** A short message box. Errors are announced to screen readers. */
export function Alert({ kind = "info", children }: AlertProps) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
