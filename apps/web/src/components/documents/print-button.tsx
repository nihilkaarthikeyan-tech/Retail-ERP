// Copyright (c) 2026, Rademics. All rights reserved.
import type { PrintKind } from "shared";
import { printHref } from "@/lib/documents";

interface PrintButtonProps {
  kind: PrintKind;
  /** The document's id; for a statement "customer:<id>" or "supplier:<id>". */
  id: string;
  label?: string;
  title?: string;
}

/** Opens the document's print page in a new tab, which opens the browser's print window. */
export function PrintButton({ kind, id, label = "Print", title }: PrintButtonProps) {
  return (
    <a className="btn btn-small" href={printHref(kind, id)} target="_blank" rel="noopener" title={title ?? "Opens a clean page to print or save as PDF"}>
      {label}
    </a>
  );
}
