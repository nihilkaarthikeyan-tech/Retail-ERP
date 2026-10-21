// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 §1 in the back office: the loyalty scheme at a glance (its numbers
// are changed in the Settings centre), the tiers, who joins, and the points
// reports: the liability checked against the accounts, points by month and
// points expiring next month. The Owner can run tonight's expiry now.
"use client";

import Link from "next/link";
import { useState } from "react";
import { hasPermission, type LoyaltySettingsDto, type LoyaltyTierDto } from "shared";
import { Alert, Badge, Button, CheckInput, type Column, DataTable, Dialog, RadioInput, TextInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { monthName, type PointsExpiring, type PointsLiability, type PointsMonth } from "@/lib/loyalty";
import { rupees } from "@/lib/purchasing";
import type { PartyGroupNode } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Tab = "scheme" | "reports";

export function LoyaltyScreen() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "loyalty.manage");
  const canView = hasPermission(user, "loyalty.view") || canManage;
  const settings = useLoad(() => api.get<LoyaltySettingsDto>("/loyalty/settings"));
  const [tab, setTab] = useState<Tab>("scheme");

  return (
    <>
      <h1>Loyalty points</h1>
      <p className="muted">Customers earn points on what they spend and pay with them later. Points are money the shop owes, so they are kept in the accounts until spent or expired.</p>
      <div className="tabs" role="tablist" aria-label="Loyalty sections">
        <button type="button" role="tab" aria-selected={tab === "scheme"} className="tab" onClick={() => setTab("scheme")}>
          Scheme and tiers
        </button>
        {canView ? (
          <button type="button" role="tab" aria-selected={tab === "reports"} className="tab" onClick={() => setTab("reports")}>
            Reports
          </button>
        ) : null}
      </div>
      <Alert kind="error">{settings.error}</Alert>
      {tab === "scheme" && settings.data ? <SchemePanel settings={settings.data} canManage={canManage} onChanged={(s) => settings.setData(s)} /> : null}
      {tab === "scheme" && !settings.data && settings.loading ? <p className="muted">Loading…</p> : null}
      {tab === "reports" && canView ? <PointsReports canRun={canManage} /> : null}
    </>
  );
}

function SchemePanel({ settings, canManage, onChanged }: { settings: LoyaltySettingsDto; canManage: boolean; onChanged: (s: LoyaltySettingsDto) => void }) {
  const s = settings;
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{s.schemeName}</h2>
        <ul data-testid="scheme-summary">
          <li>
            {rupees(s.earnSpend)} spent earns {s.earnPoints} {s.earnPoints === 1 ? "point" : "points"} (unless a tier gives more).
          </li>
          <li>One point is worth {rupees(s.pointValue)} when spent.</li>
          <li>Points last {s.validityDays} days.</li>
          <li>
            At least {s.minRedeem} points at a time, and at most {s.maxSharePercent}% of a bill paid with points.
          </li>
          <li>Expired points are written back to {s.expiryTo === "other_income" ? "other income" : "loyalty points expense"}.</li>
        </ul>
        <p className="muted">
          These are changed in <Link href="/settings">Settings → Loyalty points</Link>.
        </p>
      </div>
      <Tiers settings={s} canManage={canManage} onChanged={onChanged} />
      <WhoJoins settings={s} canManage={canManage} onChanged={onChanged} />
    </>
  );
}

interface TierForm {
  name: string;
  spendFrom: string;
  earnSpend: string;
  earnPoints: string;
}

export function Tiers({ settings, canManage, onChanged }: { settings: LoyaltySettingsDto; canManage: boolean; onChanged: (s: LoyaltySettingsDto) => void }) {
  const [editing, setEditing] = useState<LoyaltyTierDto | "new" | null>(null);
  const [form, setForm] = useState<TierForm>({ name: "", spendFrom: "", earnSpend: "100", earnPoints: "1" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(t: LoyaltyTierDto | "new") {
    setError(null);
    setForm(t === "new" ? { name: "", spendFrom: settings.tiers.length ? "" : "0", earnSpend: settings.earnSpend, earnPoints: String(settings.earnPoints) } : { name: t.name, spendFrom: t.spendFrom, earnSpend: t.earnSpend, earnPoints: String(t.earnPoints) });
    setEditing(t);
  }

  async function save() {
    setError(null);
    const points = Number(form.earnPoints);
    if (!form.name.trim()) return setError("Give the tier a name");
    if (!Number.isInteger(points) || points < 1) return setError("Points earned must be a whole number of at least 1");
    const body = { name: form.name.trim(), spendFrom: form.spendFrom.trim() || "0", earnSpend: form.earnSpend.trim(), earnPoints: points };
    setBusy(true);
    try {
      onChanged(editing === "new" ? await api.post<LoyaltySettingsDto>("/loyalty/tiers", body) : await api.patch<LoyaltySettingsDto>(`/loyalty/tiers/${(editing as LoyaltyTierDto).id}`, body));
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: LoyaltyTierDto) {
    setError(null);
    try {
      onChanged(await api.delete<LoyaltySettingsDto>(`/loyalty/tiers/${t.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const columns: Column<LoyaltyTierDto>[] = [
    { key: "name", header: "Tier", render: (t) => t.name },
    { key: "from", header: "From spend in a year", align: "right", render: (t) => rupees(t.spendFrom) },
    { key: "rate", header: "Earns", render: (t) => `${rupees(t.earnSpend)} = ${t.earnPoints} ${t.earnPoints === 1 ? "point" : "points"}` },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (t: LoyaltyTierDto) => (
              <span className="row-actions">
                <Button size="small" onClick={() => open(t)}>
                  Change
                </Button>
                <Button size="small" onClick={() => void remove(t)}>
                  Remove
                </Button>
              </span>
            ),
          } satisfies Column<LoyaltyTierDto>,
        ]
      : []),
  ];

  return (
    <div className="card">
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Tiers</h2>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add a tier
          </Button>
        ) : null}
      </div>
      <p className="muted">Optional. A customer&apos;s tier comes from what they spent in the last 12 months; the lowest tier starts at ₹0. Without tiers everyone earns at the scheme&apos;s rate.</p>
      {!editing ? <Alert kind="error">{error}</Alert> : null}
      <DataTable columns={columns} rows={settings.tiers} rowKey={(t) => t.id} loading={false} empty="No tiers: one rate for everyone." />
      <Dialog open={editing !== null} title={editing === "new" ? "Add a tier" : "Change the tier"} onClose={() => setEditing(null)}>
        <Alert kind="error">{error}</Alert>
        <TextInput id="tier-name" label="Name" value={form.name} placeholder="Gold" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextInput id="tier-from" label="From spend in a year (₹)" inputMode="decimal" value={form.spendFrom} onChange={(e) => setForm({ ...form, spendFrom: e.target.value })} />
        <TextInput id="tier-spend" label="Rupees spent (₹)" inputMode="decimal" value={form.earnSpend} onChange={(e) => setForm({ ...form, earnSpend: e.target.value })} />
        <TextInput id="tier-points" label="Points earned for that" inputMode="numeric" value={form.earnPoints} onChange={(e) => setForm({ ...form, earnPoints: e.target.value })} />
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  );
}

function flatGroups(nodes: PartyGroupNode[], depth = 0): (PartyGroupNode & { depth: number })[] {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flatGroups(n.children ?? [], depth + 1)]);
}

function WhoJoins({ settings, canManage, onChanged }: { settings: LoyaltySettingsDto; canManage: boolean; onChanged: (s: LoyaltySettingsDto) => void }) {
  const groups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const [joinAll, setJoinAll] = useState(settings.joinAll);
  const [chosen, setChosen] = useState<string[]>(settings.customerGroupIds);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = flatGroups(groups.data ?? []);

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      onChanged(await api.patch<LoyaltySettingsDto>("/loyalty/settings", { joinAll, customerGroupIds: chosen }));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Who joins</h2>
      <p className="muted">Walk-in bills never earn points.</p>
      <Alert kind="error">{error ?? groups.error}</Alert>
      {saved ? <Alert kind="success">Saved.</Alert> : null}
      <RadioInput id="join-all" name="loyalty-join" label="Every named customer" checked={joinAll} disabled={!canManage} onChange={() => setJoinAll(true)} />
      <RadioInput id="join-groups" name="loyalty-join" label="Only customers in these groups" checked={!joinAll} disabled={!canManage} onChange={() => setJoinAll(false)} />
      {!joinAll ? (
        <div style={{ marginLeft: "1.5rem" }}>
          {list.map((g) => (
            <div key={g.id} style={{ marginLeft: `${g.depth * 1.25}rem` }}>
              <CheckInput id={`join-${g.id}`} label={g.name} checked={chosen.includes(g.id)} disabled={!canManage} onChange={(e) => setChosen(e.target.checked ? [...chosen, g.id] : chosen.filter((x) => x !== g.id))} />
            </div>
          ))}
        </div>
      ) : null}
      {canManage ? (
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save who joins
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PointsReports({ canRun }: { canRun: boolean }) {
  const liability = useLoad(() => api.get<PointsLiability>("/loyalty/reports/liability"));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const months = useLoad(() => api.get<PointsMonth[]>(`/loyalty/reports/by-month${query({ from: from || undefined, to: to || undefined })}`), [from, to]);
  const expiring = useLoad(() => api.get<PointsExpiring>("/loyalty/reports/expiring"));
  const [confirm, setConfirm] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ points: number; value: string; customers: number }>("/loyalty/expiry/run", { confirm: true });
      setRan(r.points ? `${r.points} points of ${r.customers} ${r.customers === 1 ? "customer" : "customers"} expired; ${rupees(r.value)} written back.` : "No points were due to expire today.");
      setConfirm(false);
      await Promise.all([liability.reload(), months.reload(), expiring.reload()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const l = liability.data;
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Points owed to customers</h2>
        <Alert kind="error">{liability.error}</Alert>
        {l ? (
          <>
            <p>
              <strong>{l.points}</strong> points held, worth <strong>{rupees(l.value)}</strong> at {rupees(l.pointValue)} a point.
            </p>
            <p data-testid="points-check">
              {l.ok ? <Badge kind="ok">Matches the accounts</Badge> : <Badge kind="warn">Does not match: difference {rupees(l.difference)}</Badge>}{" "}
              <span className="muted">
                In the accounts {rupees(l.ledger)}
                {l.pending !== "0.00" ? `, ${rupees(l.pending)} still to post when open till shifts close` : ""}.
              </span>
            </p>
            {l.pastExpiry ? <p className="muted">{l.pastExpiry} points are past their expiry day and will be written back tonight.</p> : null}
            {l.topMembers.length ? (
              <table className="table" aria-label="Top members">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="num">Points</th>
                    <th className="num">Worth</th>
                  </tr>
                </thead>
                <tbody>
                  {l.topMembers.map((m) => (
                    <tr key={m.customerId}>
                      <td>
                        <Link href={`/customers/${m.customerId}`}>
                          <span className="mono">{m.code}</span> {m.name}
                        </Link>
                      </td>
                      <td className="num">{m.points}</td>
                      <td className="num">{rupees(m.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Points by month</h2>
        <div className="filter-row">
          <TextInput id="pts-from" label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput id="pts-to" label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Alert kind="error">{months.error}</Alert>
        <table className="table" aria-label="Points by month">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Earned</th>
              <th className="num">Spent</th>
              <th className="num">Expired</th>
              <th className="num">Taken back</th>
              <th className="num">Given back</th>
            </tr>
          </thead>
          <tbody>
            {(months.data ?? []).map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                {[m.earned, m.spent, m.expired, m.takenBack, m.givenBack].map((a, i) => (
                  <td key={i} className="num">
                    {a.points} <span className="muted">({rupees(a.value)})</span>
                  </td>
                ))}
              </tr>
            ))}
            {months.data && !months.data.length ? (
              <tr>
                <td colSpan={6} className="muted">
                  No points yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Points expiring next month</h2>
        <Alert kind="error">{expiring.error}</Alert>
        {expiring.data ? (
          <>
            <p className="muted">
              {formatDate(expiring.data.from)} to {formatDate(expiring.data.to)}: {expiring.data.points} points worth {rupees(expiring.data.value)}. A reminder to these customers may bring them back.
            </p>
            {expiring.data.rows.length ? (
              <table className="table" aria-label="Points expiring">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Mobile</th>
                    <th className="num">Points</th>
                    <th>First expires on</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.data.rows.map((r) => (
                    <tr key={r.customerId}>
                      <td>
                        <Link href={`/customers/${r.customerId}`}>
                          <span className="mono">{r.code}</span> {r.name}
                        </Link>
                      </td>
                      <td>{r.mobile ?? "—"}</td>
                      <td className="num">{r.points}</td>
                      <td>{formatDate(r.firstExpiry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
      </div>

      {canRun ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Expiry</h2>
          <p className="muted">Every night, points past their expiry day are written back. You can run today&apos;s now; running it twice changes nothing.</p>
          <Alert kind="error">{error}</Alert>
          {ran ? <Alert kind="success">{ran}</Alert> : null}
          {confirm ? (
            <div className="actions">
              <span>Expire today&apos;s points now?</span>
              <Button variant="primary" busy={busy} onClick={() => void run()}>
                Yes, expire them
              </Button>
              <Button onClick={() => setConfirm(false)}>No</Button>
            </div>
          ) : (
            <Button onClick={() => setConfirm(true)}>Run today&apos;s expiry now</Button>
          )}
        </div>
      ) : null}
    </>
  );
}
