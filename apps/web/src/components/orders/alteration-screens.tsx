// Copyright (c) 2026, Rademics. All rights reserved.
// Alteration jobs in the back office (plan 11 part 2 §2): due today, overdue,
// ready but not collected, and the rest; a job slip (garments and the work on
// each, tailor, promised date, charge and when it is paid); moving a job
// through the tailor with who and when; printing the slip and the garment tag.
// The charge itself is billed at the till.
"use client";

import Link from "next/link";
import { useState } from "react";
import { ALTERATION_NEXT, ALTERATION_STATUS_LABELS, type AlterationView, alterationJobSchema } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { PartyPicker } from "@/components/parties/party-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Badge, Button, type Column, DataTable, Dialog, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { formatDate, formatDateTime, todayIso } from "@/lib/format";
import { type AlterationDto, JOB_STATUS_TONE } from "@/lib/orders";
import { rupees } from "@/lib/purchasing";
import { storesFromLocations } from "@/lib/stock";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const VIEWS: { key: AlterationView; label: string }[] = [
  { key: "open", label: "In hand" },
  { key: "due_today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "ready", label: "Ready, not collected" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export function AlterationsScreen() {
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [view, setView] = useState<AlterationView>("open");
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const list = useLoad(() => api.get<{ rows: AlterationDto[]; total: number }>(`/alterations${query({ view, storeId: storeId || undefined, search: search.trim() || undefined, pageSize: "200" })}`), [view, storeId, search]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AlterationDto | "new" | null>(null);

  const columns: Column<AlterationDto>[] = [
    {
      key: "number",
      header: "Job",
      render: (r) => (
        <Button variant="link" onClick={() => setOpenId(r.id)}>
          <span className="mono">{r.number}</span>
        </Button>
      ),
    },
    { key: "customer", header: "Customer", render: (r) => `${r.name ?? ""}${r.phone ? ` · ${r.phone}` : ""}` },
    { key: "work", header: "Work", render: (r) => r.lines.map((l) => `${l.garment}: ${l.work}`).join("; ") },
    { key: "tailor", header: "Tailor", render: (r) => r.tailor ?? "—" },
    { key: "promised", header: "Promised", render: (r) => <>{formatDate(r.promisedOn)} {r.overdue ? <Badge kind="warn">Overdue</Badge> : r.dueToday ? <Badge kind="neutral">Today</Badge> : null}</> },
    { key: "charge", header: "Charge", align: "right", render: (r) => `${rupees(r.charge)}${r.chargeBill ? " (billed)" : ""}` },
    { key: "status", header: "Status", render: (r) => <Badge kind={JOB_STATUS_TONE[r.status]}>{ALTERATION_STATUS_LABELS[r.status]}</Badge> },
  ];

  return (
    <>
      <h1>Alterations</h1>
      <p className="muted">Alteration and tailoring jobs. The charge is billed at the till, with the purchase or when the garment is collected, never both.</p>
      <div className="filter-row">
        <SelectInput id="alt-view" label="Show" value={view} onChange={(e) => setView(e.target.value as AlterationView)}>
          {VIEWS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="alt-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="alt-search" label="Search" placeholder="Number, name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="primary" onClick={() => setEditing("new")}>
          New job slip
        </Button>
      </div>
      <Alert kind="error">{list.error}</Alert>
      <DataTable columns={columns} rows={list.data?.rows ?? null} rowKey={(r) => r.id} loading={list.loading} empty="No alteration jobs." />
      {editing ? (
        <AlterationEditor
          job={editing === "new" ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onSaved={(j) => {
            setEditing(null);
            setOpenId(j.id);
            void list.reload();
          }}
        />
      ) : null}
      {openId && !editing ? <AlterationPanel id={openId} onClose={() => setOpenId(null)} onEdit={(j) => setEditing(j)} onChanged={() => void list.reload()} /> : null}
    </>
  );
}

interface Staff {
  id: string;
  code: string;
  name: string;
}

export function AlterationEditor({ job, stores, onClose, onSaved }: { job: AlterationDto | null; stores: { id: string; code: string; name: string }[]; onClose: () => void; onSaved: (j: AlterationDto) => void }) {
  const [storeId, setStoreId] = useState(job?.storeId ?? stores[0]?.id ?? "");
  const staff = useLoad(() => (storeId ? api.get<Staff[]>(`/sales-staff${query({ storeId, active: "true" })}`).catch(() => [] as Staff[]) : Promise.resolve([] as Staff[])), [storeId]);
  const [customer, setCustomer] = useState<PartyRef | null>(null);
  const [form, setForm] = useState({
    name: job?.name ?? "",
    phone: job?.phone ?? "",
    billNumber: job?.bill?.number ?? "",
    tailorStaffId: job?.tailorStaffId ?? "",
    tailorName: job?.tailorName ?? "",
    promisedOn: job?.promisedOn ?? todayIso(),
    charge: job?.charge ?? "0",
    chargePaidWith: job?.chargePaidWith ?? ("collection" as "bill" | "collection"),
    remarks: job?.remarks ?? "",
  });
  const [lines, setLines] = useState(job?.lines.map((l) => ({ itemId: l.itemId, garment: l.garment, work: l.work })) ?? [{ itemId: null as string | null, garment: "", work: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      // The bill the garment came from, found by its number.
      let billId: string | null = job?.bill?.id ?? null;
      if (form.billNumber.trim() && form.billNumber.trim() !== job?.bill?.number) {
        const found = await api.get<{ rows: { id: string; number: string }[] }>(`/pos/bills${query({ search: form.billNumber.trim(), kind: "sale", pageSize: "5" })}`);
        const bill = found.rows.find((b) => b.number.toUpperCase() === form.billNumber.trim().toUpperCase());
        if (!bill) throw new Error(`Bill ${form.billNumber.trim()} was not found`);
        billId = bill.id;
      } else if (!form.billNumber.trim()) billId = null;
      const body = {
        storeId,
        customerId: customer?.id ?? job?.customerId ?? null,
        name: form.name.trim() || null,
        phone: form.phone.trim() || null,
        billId,
        tailorStaffId: form.tailorStaffId || null,
        tailorName: form.tailorStaffId ? null : form.tailorName.trim() || null,
        promisedOn: form.promisedOn,
        charge: form.charge.trim() || "0",
        chargePaidWith: form.chargePaidWith,
        remarks: form.remarks.trim() || null,
        lines: lines.filter((l) => l.garment.trim() || l.work.trim()),
      };
      const parsed = alterationJobSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the job slip");
      onSaved(job ? await api.patch<AlterationDto>(`/alterations/${job.id}`, parsed.data) : await api.post<AlterationDto>("/alterations", parsed.data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={job ? `Change job ${job.number}` : "New alteration job"} onClose={onClose}>
      <Alert kind="error">{error}</Alert>
      <SelectInput id="alt-ed-store" label="Store" value={storeId} disabled={!!job} onChange={(e) => setStoreId(e.target.value)}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </SelectInput>
      <PartyPicker id="alt-ed-customer" label="Customer (optional)" kind="customer" value={customer} onChange={setCustomer} hint="Or type a name and phone for a walk-in customer" />
      <TextInput id="alt-ed-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <TextInput id="alt-ed-phone" label="Phone" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <TextInput id="alt-ed-bill" label="Bought on bill (optional)" value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} />
      <table className="table" aria-label="Garments and work">
        <thead>
          <tr>
            <th>Garment</th>
            <th>Work</th>
            <th>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input className="input" aria-label={`Garment ${i + 1}`} value={l.garment} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, garment: e.target.value } : x)))} />
              </td>
              <td>
                <input className="input" aria-label={`Work ${i + 1}`} placeholder="e.g. shorten 2 cm" value={l.work} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, work: e.target.value } : x)))} />
              </td>
              <td>
                <Button variant="link" aria-label={`Remove garment ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button size="small" onClick={() => setLines([...lines, { itemId: null, garment: "", work: "" }])}>
        Add a garment
      </Button>
      <SelectInput id="alt-ed-tailor" label="Tailor" value={form.tailorStaffId} onChange={(e) => setForm({ ...form, tailorStaffId: e.target.value })}>
        <option value="">Someone else (type the name)</option>
        {(staff.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.code})
          </option>
        ))}
      </SelectInput>
      {!form.tailorStaffId ? <TextInput id="alt-ed-tailor-name" label="Tailor's name" value={form.tailorName} onChange={(e) => setForm({ ...form, tailorName: e.target.value })} /> : null}
      <TextInput id="alt-ed-promised" label="Promised on" type="date" value={form.promisedOn} onChange={(e) => setForm({ ...form, promisedOn: e.target.value })} />
      <TextInput id="alt-ed-charge" label="Charge (₹, GST included)" inputMode="decimal" value={form.charge} disabled={!!job?.chargeBill} onChange={(e) => setForm({ ...form, charge: e.target.value })} />
      <SelectInput id="alt-ed-paid" label="Charge paid" value={form.chargePaidWith} disabled={!!job?.chargeBill} onChange={(e) => setForm({ ...form, chargePaidWith: e.target.value as "bill" | "collection" })}>
        <option value="bill">With the purchase bill</option>
        <option value="collection">When the garment is collected</option>
      </SelectInput>
      <TextareaInput id="alt-ed-remarks" label="Remarks" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {job ? "Save changes" : "Save the job slip"}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function AlterationPanel({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (j: AlterationDto) => void; onChanged: () => void }) {
  const job = useLoad(() => api.get<AlterationDto>(`/alterations/${id}`), [id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const j = job.data;

  async function move(status: string, remarks?: string) {
    setError(null);
    setBusy(true);
    try {
      job.setData(await api.post<AlterationDto>(`/alterations/${id}/status`, { status, remarks: remarks ?? null }));
      setCancelling(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const next = j ? ALTERATION_NEXT[j.status] : null;
  const working = j && j.status !== "delivered" && j.status !== "cancelled";
  return (
    <Dialog open title={j ? `Alteration ${j.number}` : "Alteration"} onClose={onClose}>
      <Alert kind="error">{job.error ?? error}</Alert>
      {!j ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p>
            <strong>{j.name}</strong> {j.phone ? <span className="muted">{j.phone}</span> : null} · <Badge kind={JOB_STATUS_TONE[j.status]}>{ALTERATION_STATUS_LABELS[j.status]}</Badge> · promised {formatDate(j.promisedOn)} {j.overdue ? <Badge kind="warn">Overdue</Badge> : null}
          </p>
          {j.bill ? (
            <p>
              Bought on bill <Link href={`/pos/bills/${j.bill.id}`} className="mono">{j.bill.number}</Link>
            </p>
          ) : null}
          <ul>
            {j.lines.map((l) => (
              <li key={l.id}>
                {l.garment}: {l.work}
              </li>
            ))}
          </ul>
          <p>
            Tailor: {j.tailor ?? "—"} · Charge {rupees(j.charge)}{" "}
            {j.chargeBill ? (
              <>
                billed on <Link href={`/pos/bills/${j.chargeBill.id}`} className="mono">{j.chargeBill.number}</Link>
              </>
            ) : j.chargePaidWith === "bill" ? "(with the purchase bill)" : "(on collection, at the till)"}
          </p>
          <h3>History</h3>
          <ol aria-label="History">
            {j.history.map((h, i) => (
              <li key={i}>
                {ALTERATION_STATUS_LABELS[h.status]} — {formatDateTime(h.at)}
                {h.by ? `, ${h.by}` : ""}
                {h.remarks ? ` (${h.remarks})` : ""}
              </li>
            ))}
          </ol>
          {cancelling ? (
            <div className="card">
              <TextareaInput id="alt-cancel-reason" label="Reason for cancelling" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="actions">
                <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => void move("cancelled", reason.trim())}>
                  Cancel the job
                </Button>
                <Button onClick={() => setCancelling(false)}>Back</Button>
              </div>
            </div>
          ) : (
            <div className="actions">
              {next ? (
                <Button variant="primary" busy={busy} onClick={() => void move(next)}>
                  {next === "with_tailor" ? "Given to the tailor" : next === "ready" ? "Back from the tailor: ready" : "Handed back to the customer"}
                </Button>
              ) : null}
              {working ? <Button onClick={() => onEdit(j)}>Change</Button> : null}
              {working && !j.chargeBill ? (
                <Button variant="danger" onClick={() => setCancelling(true)}>
                  Cancel the job
                </Button>
              ) : null}
              <PrintButton kind="alteration_job" id={j.id} label="Print the job slip" />
              <PrintButton kind="alteration_tag" id={j.id} label="Print the garment tag" />
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
