// Copyright (c) 2026, Rademics. All rights reserved.
// "Needs your attention" on the dashboard (owner, 23 October 2026): what to do
// today, each line a link to the screen that deals with it. The lines come from
// GET /attention, which shows only what the user may see.
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

interface AttentionItem {
  key: string;
  label: string;
  detail?: string;
  href: string;
  tone: "warn" | "ok";
  action: string;
}

export function Attention() {
  const list = useLoad(() => api.get<{ items: AttentionItem[] }>("/attention"), []);
  if (list.error || !list.data) return null;
  const items = list.data.items;
  return (
    <section className="attention" aria-labelledby="attention-title">
      <h2 id="attention-title">Needs your attention</h2>
      {items.length === 0 ? (
        <p className="attention-clear">Nothing waiting. Everything is up to date.</p>
      ) : (
        <ul className="attention-list">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href}>
                <span>
                  {it.label}
                  {it.detail ? <span className="attention-detail">{it.detail}</span> : null}
                </span>
                <Badge kind={it.tone}>{it.action}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
