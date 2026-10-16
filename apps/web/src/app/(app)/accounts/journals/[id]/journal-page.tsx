// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { JournalForm } from "@/components/accounts/journal-form";
import { JournalView } from "@/components/accounts/journal-view";
import { AuditTable } from "@/components/audit-table";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { accountRights, type JournalDto } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const rights = accountRights(user);
  const canSeeHistory = hasPermission(user, "audit.view");
  const journal = useLoad(() => api.get<JournalDto>(`/journals/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);

  if (journal.error) {
    return (
      <>
        <h1>Journal</h1>
        <Alert kind="error">{journal.error}</Alert>
        <Link href="/accounts/journals">Back to journals</Link>
      </>
    );
  }
  if (!journal.data) return <p className="muted">Loading…</p>;
  const j = journal.data;
  const canEdit = j.status === "draft" && (rights.journals || (rights.cashDeposit && j.kind === "cash"));

  return (
    <>
      <p>
        <Link href="/accounts/journals">← Journals</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Journal sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          editing && canEdit ? (
            <JournalForm
              journal={j}
              onSaved={(saved) => {
                journal.setData(saved);
                setEditing(false);
              }}
              onClose={() => setEditing(false)}
            />
          ) : (
            <JournalView journal={j} onChanged={journal.setData} onEdit={canEdit ? () => setEditing(true) : undefined} />
          )
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "journal", entityId: j.id }} />
        )}
      </div>
    </>
  );
}
