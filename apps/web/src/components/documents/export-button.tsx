// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { type ExportKind, hasPermission } from "shared";
import { Button } from "@/components/ui";
import { downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { importFileNames } from "@/lib/documents";

/**
 * "Export for Excel" on a master list (plan 10 §1.D): the same columns as the
 * import template, so the file can be changed in Excel and imported back.
 * CSV is offered too. Every export is recorded in the history.
 */
export function ExportButton({ kind }: { kind: ExportKind }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!hasPermission(user, "export.masters")) return null;

  async function download(format: "xlsx" | "csv") {
    setBusy(format);
    setError(null);
    try {
      await downloadFile(`/exports/${kind}?format=${format}`, importFileNames.export(kind, format));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="export-buttons">
      <Button size="small" busy={busy === "xlsx"} disabled={busy !== null} onClick={() => void download("xlsx")} title="The same columns as the import template">
        Export for Excel
      </Button>
      <Button size="small" variant="link" busy={busy === "csv"} disabled={busy !== null} onClick={() => void download("csv")} title="A plain CSV file instead of an Excel file">
        CSV
      </Button>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
