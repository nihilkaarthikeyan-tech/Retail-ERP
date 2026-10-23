// Copyright (c) 2026, Rademics. All rights reserved.
// Quick search (owner, 23 October 2026): Ctrl+K (or the box in the top bar)
// opens a small window; a few letters find a screen, an item, a customer or a
// bill, and Enter jumps there. Only lists the person may see are searched.
"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { type CurrentUser, hasPermission } from "shared";
import { Icon, type IconName } from "@/components/icons";
import { api, query } from "@/lib/api";
import { visibleMenu } from "@/lib/menu";
import { useModules } from "@/lib/modules";
import type { CustomerDto, ItemDto } from "@/lib/types";

interface Hit {
  key: string;
  group: "Screens" | "Items" | "Customers" | "Bills";
  label: string;
  detail?: string;
  href: string;
  icon: IconName;
}

interface BillHit {
  id: string;
  number: string;
  buyerName?: string | null;
  businessDate: string;
  till: { code: string };
}

const MIN = 2;

/** The window itself; it mounts fresh each time it opens, so nothing needs resetting. */
function Panel({ user, onClose }: { user: CurrentUser; onClose: () => void }) {
  const router = useRouter();
  const modules = useModules().modules;
  const [text, setText] = useState("");
  const [remote, setRemote] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });
  const [active, setActive] = useState(0);
  const version = useRef(0);

  const screens = useMemo(() => visibleMenu(user, modules), [user, modules]);
  const q = text.trim();

  // Items, customers and bills from the server, a moment after typing stops.
  useEffect(() => {
    if (q.length < MIN) return;
    const my = ++version.current;
    const timer = setTimeout(async () => {
      const found: Hit[] = [];
      const jobs: Promise<void>[] = [];
      if (hasPermission(user, "catalogue.view")) {
        jobs.push(
          api.get<{ rows: ItemDto[] }>(`/items${query({ search: q, pageSize: 5 })}`).then((r) => {
            for (const i of r.rows) found.push({ key: `item-${i.id}`, group: "Items", label: i.name, detail: i.code, href: `/items/${i.id}`, icon: "box" });
          }),
        );
      }
      if (hasPermission(user, "customers.view")) {
        jobs.push(
          api.get<{ rows: CustomerDto[] }>(`/customers${query({ search: q, pageSize: 5 })}`).then((r) => {
            for (const c of r.rows) found.push({ key: `cust-${c.id}`, group: "Customers", label: c.name, detail: c.mobile ?? c.code, href: `/customers/${c.id}`, icon: "users" });
          }),
        );
      }
      if (hasPermission(user, "pos.reports") || hasPermission(user, "pos.sell")) {
        jobs.push(
          api.get<{ rows: BillHit[] }>(`/pos/bills${query({ search: q, pageSize: 5 })}`).then((r) => {
            for (const b of r.rows) found.push({ key: `bill-${b.id}`, group: "Bills", label: b.number, detail: `${b.till.code} · ${b.businessDate}${b.buyerName ? ` · ${b.buyerName}` : ""}`, href: `/pos/bills/${b.id}`, icon: "receipt" });
          }),
        );
      }
      await Promise.allSettled(jobs);
      if (my === version.current) setRemote({ q, hits: found });
    }, 220);
    return () => clearTimeout(timer);
  }, [q, user]);

  const hits = useMemo<Hit[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const local = screens
      .filter((s) => words.every((w) => s.label.toLowerCase().includes(w) || (s.section ?? "").toLowerCase().includes(w)))
      .slice(0, q ? 6 : 8)
      .map<Hit>((s) => ({ key: `screen-${s.href}`, group: "Screens", label: s.label, detail: s.section, href: s.href, icon: s.icon }));
    // Server results count only while they match what is typed now.
    return [...local, ...(remote.q === q ? remote.hits : [])];
  }, [q, screens, remote]);

  const current = Math.min(active, Math.max(hits.length - 1, 0));

  function go(hit: Hit) {
    onClose();
    router.push(hit.href);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter" && hits[current]) {
      e.preventDefault();
      go(hits[current]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  let lastGroup: Hit["group"] | null = null;
  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className="qs" role="dialog" aria-modal="true" aria-label="Quick search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qs-input-row">
          <Icon name="search" size={18} />
          <input
            className="qs-input"
            placeholder="Search screens, items, customers, bills…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            aria-label="Quick search"
            autoComplete="off"
            autoFocus
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="qs-list" role="listbox">
          {hits.length === 0 ? (
            <li className="qs-empty">{q.length < MIN ? "Type a screen name, item, customer or bill number." : "Nothing found."}</li>
          ) : (
            hits.map((h, i) => {
              const heading = h.group !== lastGroup ? h.group : null;
              lastGroup = h.group;
              return (
                <li key={h.key}>
                  {heading ? <div className="qs-group label-mono">{heading}</div> : null}
                  <button type="button" role="option" aria-selected={i === current} className={`qs-hit${i === current ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                    <Icon name={h.icon} size={16} />
                    <span className="qs-hit-label">{h.label}</span>
                    {h.detail ? <span className="qs-hit-detail">{h.detail}</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="qs-foot label-mono">↑↓ to move · Enter to open</div>
      </div>
    </div>
  );
}

export function QuickSearch({ user, open, onClose }: { user: CurrentUser; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <Panel user={user} onClose={onClose} />;
}
