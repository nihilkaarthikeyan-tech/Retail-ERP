// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type PlatformLeadDto, type PlatformShopDto, SHOP_TYPES, type ShopTypeKey } from "shared";
import { Alert, Badge, Button, type Column, DataTable, Dialog, TextareaInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";

interface Admin {
  id: string;
  email: string;
  name: string;
}

const kind = (k: string | null) => (k && k in SHOP_TYPES ? SHOP_TYPES[k as ShopTypeKey].label : "—");

/** The trial: days left, ended, or "On a plan" for shops without a trial. */
function Trial({ ends, now }: { ends: string | null; now: number }) {
  if (!ends) return <span className="muted">On a plan</span>;
  const days = Math.ceil((new Date(ends).getTime() - now) / 86_400_000);
  if (days < 0) return <Badge kind="warn">Ended {formatDate(ends)}</Badge>;
  return (
    <span>
      {days} day{days === 1 ? "" : "s"} left <span className="muted">({formatDate(ends)})</span>
    </span>
  );
}

/** Plan 14: the Retail ERP admin screen — every shop on the system, and the landing page messages. */
export default function AdminPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [tab, setTab] = useState<"shops" | "leads">("shops");
  const [shops, setShops] = useState<PlatformShopDto[] | null>(null);
  const [leads, setLeads] = useState<PlatformLeadDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<PlatformShopDto | null>(null);
  /** When the list was loaded: the trial days are counted from then. */
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([api.get<PlatformShopDto[]>("/platform/shops", { redirectOnUnauthorized: false }), api.get<PlatformLeadDto[]>("/platform/leads", { redirectOnUnauthorized: false })]);
      setNow(Date.now());
      setShops(s);
      setLeads(l);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Admin>("/platform/me", { redirectOnUnauthorized: false })
      .then((me) => {
        if (cancelled) return;
        setAdmin(me);
        void load();
      })
      .catch((err) => {
        if (!cancelled && err instanceof ApiError && err.statusCode === 401) router.replace("/admin/login");
        else if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [load, router]);

  async function logout() {
    await api.post("/platform/logout", {}, { redirectOnUnauthorized: false }).catch(() => undefined);
    router.replace("/admin/login");
  }

  async function toggleLead(l: PlatformLeadDto) {
    try {
      const updated = await api.patch<PlatformLeadDto>(`/platform/leads/${l.id}`, { handled: !l.handledAt }, { redirectOnUnauthorized: false });
      setLeads((all) => all?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!admin) {
    return (
      <main className="public-page">
        {error ? <Alert kind="error">{error}</Alert> : <p className="muted">Loading…</p>}
      </main>
    );
  }

  const open = leads?.filter((l) => !l.handledAt).length ?? 0;
  const shopColumns: Column<PlatformShopDto>[] = [
    {
      key: "shop",
      header: "Shop",
      render: (s) => (
        <>
          <strong>{s.name}</strong>
          <div className="muted mono">{s.code}{s.city ? ` · ${s.city}` : ""}</div>
        </>
      ),
    },
    { key: "owner", header: "Owner", render: (s) => (s.owner ? <>{s.owner.name}<div className="muted">{s.owner.email}</div></> : "—") },
    { key: "kind", header: "Kind", render: (s) => kind(s.shopType) },
    { key: "signed", header: "Signed up", render: (s) => formatDate(s.createdAt) },
    { key: "setup", header: "Setup", render: (s) => (s.setupCompletedAt ? <Badge kind="ok">Done</Badge> : <Badge kind="neutral">Not yet</Badge>) },
    { key: "trial", header: "Trial", render: (s) => <Trial ends={s.trialEndsAt} now={now} /> },
    { key: "users", header: "People", align: "right", render: (s) => s.users },
    { key: "bills", header: "Bills", align: "right", render: (s) => s.bills },
    { key: "last", header: "Last used", render: (s) => (s.lastActiveAt ? formatDateTime(s.lastActiveAt) : "—") },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <span className="toolbar" style={{ margin: 0 }}>
          {s.active ? <Badge kind="ok">On</Badge> : <Badge kind="off">Off</Badge>}
          <Button size="small" onClick={() => setSwitching(s)}>
            {s.active ? "Switch off" : "Switch on"}
          </Button>
        </span>
      ),
    },
  ];
  const leadColumns: Column<PlatformLeadDto>[] = [
    { key: "when", header: "Received", render: (l) => formatDateTime(l.createdAt) },
    { key: "who", header: "Name and phone", render: (l) => <><strong>{l.name}</strong><div className="mono">{l.phone}</div>{l.email ? <div className="muted">{l.email}</div> : null}</> },
    { key: "shop", header: "Shop", render: (l) => <>{l.shopName ?? "—"}<div className="muted">{kind(l.shopType)}</div></> },
    { key: "message", header: "Message", render: (l) => l.message ?? <span className="muted">—</span> },
    {
      key: "handled",
      header: "Handled",
      render: (l) => (
        <span className="toolbar" style={{ margin: 0 }}>
          {l.handledAt ? <Badge kind="ok">{formatDate(l.handledAt)}</Badge> : <Badge kind="warn">Open</Badge>}
          <Button size="small" onClick={() => void toggleLead(l)}>
            {l.handledAt ? "Reopen" : "Mark handled"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <main className="admin-page">
      <header className="toolbar">
        <div className="public-brand" style={{ margin: 0 }}>
          <span className="shell-brand-mark" aria-hidden="true" />
          Retail ERP admin
        </div>
        <span className="spacer" />
        <span className="muted">{admin.name}</span>
        <Button size="small" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <Alert kind="error">{error}</Alert>
      <p className="muted">Every shop on Retail ERP. You see how much each one uses the system, never its bills, customers or items.</p>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "shops"} className="tab" onClick={() => setTab("shops")}>
          Shops {shops ? `(${shops.length})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "leads"} className="tab" onClick={() => setTab("leads")}>
          Contact messages {open ? `(${open} open)` : ""}
        </button>
      </div>

      {tab === "shops" ? (
        <DataTable columns={shopColumns} rows={shops} rowKey={(s) => s.id} loading={shops === null} empty="No shop has signed up yet." />
      ) : (
        <DataTable columns={leadColumns} rows={leads} rowKey={(l) => l.id} loading={leads === null} empty="No messages yet." />
      )}

      <SwitchDialog
        shop={switching}
        onClose={() => setSwitching(null)}
        onDone={(updated) => {
          setShops((all) => all?.map((s) => (s.id === updated.id ? updated : s)) ?? null);
          setSwitching(null);
        }}
      />
    </main>
  );
}

/** Switching a shop off or on, with the reason kept in that shop's history. */
function SwitchDialog({ shop, onClose, onDone }: { shop: PlatformShopDto | null; onClose: () => void; onDone: (s: PlatformShopDto) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!shop) return null;
  const off = shop.active;

  async function save() {
    if (!shop) return;
    if (!reason.trim()) return setError("Write the reason; it is kept in the shop's history.");
    setBusy(true);
    setError(null);
    try {
      onDone(await api.patch<PlatformShopDto>(`/platform/shops/${shop.id}`, { active: !shop.active, reason: reason.trim() }, { redirectOnUnauthorized: false }));
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={off ? `Switch off ${shop.name}?` : `Switch on ${shop.name}?`} onClose={onClose}>
      <Alert kind="info">{off ? "Its people cannot log in until it is switched on again, and anyone logged in is logged out. Nothing is deleted." : "Its people can log in again, with everything as they left it."}</Alert>
      <TextareaInput id="switch-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required hint={off ? "For example: trial ended, payment due." : "For example: plan paid."} />
      <Alert kind="error">{error}</Alert>
      <div className="actions">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={off ? "danger" : "primary"} busy={busy} onClick={() => void save()}>
          {off ? "Switch off" : "Switch on"}
        </Button>
      </div>
    </Dialog>
  );
}
