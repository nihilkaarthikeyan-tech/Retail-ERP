// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createLocationSchema, hasPermission } from "shared";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { ActiveBadge, Alert, Badge, Button, Dialog, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LOCATION_KIND_LABELS, storesFromLocations } from "@/lib/stock";
import type { StockLocationDto, StoreRef } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface NewLocation {
  storeId: string;
  parentId: string;
  code: string;
  name: string;
  kind: "folder" | "shelf" | "rejected";
}

function LocationTree({ nodes, all, canManage, busyId, onToggle }: { nodes: StockLocationDto[]; all: StockLocationDto[]; canManage: boolean; busyId: string | null; onToggle: (l: StockLocationDto) => void }) {
  return (
    <ul className="tree">
      {nodes.map((l) => {
        const children = all.filter((c) => c.parentId === l.id);
        return (
          <li key={l.id}>
            <div className="tree-row">
              <span className="mono">{l.code}</span>
              <span>{l.name}</span>
              <Badge kind="neutral">{LOCATION_KIND_LABELS[l.kind] ?? l.kind}</Badge>
              <ActiveBadge active={l.active} />
              {canManage && l.kind !== "transit" && l.parentId ? (
                <Button size="small" busy={busyId === l.id} onClick={() => onToggle(l)}>
                  {l.active ? "Switch off" : "Switch on"}
                </Button>
              ) : null}
            </div>
            {children.length ? <LocationTree nodes={children} all={all} canManage={canManage} busyId={busyId} onToggle={onToggle} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function LocationsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "stock.locations.manage");
  const locations = useStockLocations();
  const [adding, setAdding] = useState<NewLocation | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = locations.data ?? [];
  const stores = storesFromLocations(all);
  const transit = all.filter((l) => l.kind === "transit");

  function rootsOf(store: StoreRef) {
    const inStore = all.filter((l) => l.store?.id === store.id);
    return inStore.filter((l) => !l.parentId || !inStore.some((p) => p.id === l.parentId));
  }

  function openAdd(store: StoreRef) {
    setErrors({});
    setError(null);
    setAdding({ storeId: store.id, parentId: "", code: "", name: "", kind: "shelf" });
  }

  async function toggle(l: StockLocationDto) {
    setBusyId(l.id);
    setPageError(null);
    try {
      await api.patch(`/stock/locations/${l.id}`, { active: !l.active });
      await locations.reload();
    } catch (err) {
      setPageError(`${l.name}: ${errorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!adding) return;
    setError(null);
    const parsed = createLocationSchema.safeParse({ ...adding, parentId: adding.parentId || null });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/stock/locations", parsed.data);
      setAdding(null);
      await locations.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const folders = adding ? all.filter((l) => l.store?.id === adding.storeId && l.kind === "folder") : [];

  return (
    <>
      <h1>Stock locations</h1>
      <p className="muted">
        Each store has its own locations. Stock is kept only in shelves and the rejected (quarantine) location, never in folders. Transit is shared by the whole
        company and is used only by transfers between stores.
      </p>
      <Alert kind="error">{locations.error ?? pageError}</Alert>
      {locations.loading && !locations.data ? <p className="muted">Loading…</p> : null}
      {stores.map((s) => (
        <section key={s.id} className="card">
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>
              {s.code} — {s.name}
            </h2>
            <span className="spacer" />
            {canManage ? (
              <Button size="small" variant="primary" onClick={() => openAdd(s)}>
                Add location
              </Button>
            ) : null}
          </div>
          <LocationTree nodes={rootsOf(s)} all={all} canManage={canManage} busyId={busyId} onToggle={toggle} />
        </section>
      ))}
      {transit.length ? (
        <section className="card">
          <h2>Company</h2>
          <LocationTree nodes={transit} all={all} canManage={false} busyId={null} onToggle={toggle} />
        </section>
      ) : null}

      <Dialog open={adding !== null} title="Add location" onClose={() => setAdding(null)}>
        {adding ? (
          <form onSubmit={submit} noValidate>
            <Alert kind="error">{error}</Alert>
            <SelectInput id="loc-parent" label="Inside folder" value={adding.parentId} onChange={(e) => setAdding({ ...adding, parentId: e.target.value })} error={errors.parentId} hint="Blank: directly under the store.">
              <option value="">The store itself</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </SelectInput>
            <TextInput id="loc-code" label="Code" className="mono" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value })} error={errors.code} required autoComplete="off" hint="Unique in the company, for example MAIN-GODOWN." />
            <TextInput id="loc-name" label="Name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} error={errors.name} required autoComplete="off" />
            <SelectInput id="loc-kind" label="Kind" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as NewLocation["kind"] })} error={errors.kind}>
              <option value="shelf">Shelf (holds stock)</option>
              <option value="rejected">Rejected / quarantine (holds stock)</option>
              <option value="folder">Folder (groups other locations)</option>
            </SelectInput>
            <div className="actions">
              <Button type="submit" variant="primary" busy={busy}>
                Add
              </Button>
              <Button onClick={() => setAdding(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
