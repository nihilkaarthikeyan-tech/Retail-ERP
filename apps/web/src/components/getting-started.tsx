// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §4: the getting-started checklist on the owner's dashboard. Each step
// links to its screen and ticks itself off from real data (GET /getting-started);
// the owner can hide it and bring it back. Gone once every step is done.
"use client";

import Link from "next/link";
import { useState } from "react";
import type { GettingStartedDto } from "shared";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";

export function GettingStarted() {
  const { user } = useAuth();
  const isOwner = !!user?.isOwnerAdmin;
  const list = useLoad<GettingStartedDto | null>(() => (isOwner ? api.get<GettingStartedDto>("/getting-started") : Promise.resolve(null)), [isOwner]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOwner || !list.data) return list.error && isOwner ? <Alert kind="error">{list.error}</Alert> : null;
  const data = list.data;
  if (data.doneCount === data.total) return null;

  async function setHidden(hidden: boolean) {
    setBusy(true);
    setError(null);
    try {
      list.setData(await api.put<GettingStartedDto>("/getting-started", { hidden }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (data.hidden) {
    return (
      <p className="muted getting-started-hidden">
        Getting started: {data.doneCount} of {data.total} done.{" "}
        <Button variant="link" size="small" busy={busy} onClick={() => void setHidden(false)}>
          Show the checklist
        </Button>
      </p>
    );
  }

  const percent = Math.round((data.doneCount / data.total) * 100);
  return (
    <section className="card getting-started" aria-labelledby="getting-started-title">
      <div className="toolbar" style={{ marginTop: 0 }}>
        <h2 id="getting-started-title" style={{ margin: 0 }}>
          Getting started
        </h2>
        <span className="muted">
          {data.doneCount} of {data.total} done
        </span>
        <span className="spacer" />
        <Button size="small" busy={busy} onClick={() => void setHidden(true)}>
          Hide
        </Button>
      </div>
      <div className="getting-started-bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.doneCount} aria-label="Steps done">
        <span style={{ width: `${percent}%` }} />
      </div>
      <Alert kind="error">{error}</Alert>
      <ol className="getting-started-list">
        {data.steps.map((s) => (
          <li key={s.key} className={s.done ? "is-done" : undefined}>
            <span className="getting-started-mark" aria-hidden="true">
              {s.done ? "✓" : ""}
            </span>
            <div>
              <Link href={s.href}>{s.label}</Link>
              <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              <p className="getting-started-hint">{s.note ?? s.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
