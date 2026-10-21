// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 §2 in the back office: the gift card list (search by the last
// digits or the holder), one card with its history and block / unblock (a lost
// or stolen card), and the reports: the liability checked against the
// accounts, sold and spent by month, and cards expiring soon. Cards are sold
// and reloaded at the till, not here.
"use client";

import Link from "next/link";
import { useState } from "react";
import { formatGiftCardNumber, type GiftCardDto, hasPermission } from "shared";
import { Alert, Badge, Button, type Column, DataTable, Dialog, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { CARD_ENTRY_LABELS, CARD_STATUS_LABELS, CARD_STATUS_TONE, type GiftCardLiability, type GiftCardMonth, type GiftCardPage, type GiftCardsExpiring, monthName } from "@/lib/loyalty";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

/** The number as the API sent it: in groups of four when it is the full number, masked otherwise. */
export function cardNumber(n: string): string {
  return /^\d{16}$/.test(n) ? formatGiftCardNumber(n) : n;
}

type Tab = "cards" | "reports";

export function GiftCardsScreen() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "giftcards.manage");
  const [tab, setTab] = useState<Tab>("cards");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const list = useLoad(() => api.get<GiftCardPage>(`/gift-cards${query({ status: status || undefined, search: search.trim() || undefined, pageSize: "200" })}`), [status, search]);

  const columns: Column<GiftCardDto>[] = [
    {
      key: "number",
      header: "Card",
      render: (c) => (
        <Link href={`/gift-cards/${c.id}`}>
          <span className="mono">{cardNumber(c.number)}</span>
        </Link>
      ),
    },
    { key: "holder", header: "Holder", render: (c) => [c.holderName, c.holderPhone].filter(Boolean).join(" · ") || "—" },
    { key: "issued", header: "Sold on", render: (c) => formatDate(c.issuedOn) },
    { key: "balance", header: "Balance", align: "right", render: (c) => rupees(c.balance) },
    { key: "expires", header: "Expires on", render: (c) => formatDate(c.expiresOn) },
    { key: "status", header: "Status", render: (c) => <Badge kind={CARD_STATUS_TONE[c.status]}>{CARD_STATUS_LABELS[c.status]}</Badge> },
  ];

  return (
    <>
      <h1>Gift cards</h1>
      <p className="muted">Prepaid cards the shop owes money on. They are sold and reloaded at the till; here you see them, block a lost card and check the totals.</p>
      <div className="tabs" role="tablist" aria-label="Gift card sections">
        <button type="button" role="tab" aria-selected={tab === "cards"} className="tab" onClick={() => setTab("cards")}>
          Cards
        </button>
        <button type="button" role="tab" aria-selected={tab === "reports"} className="tab" onClick={() => setTab("reports")}>
          Reports
        </button>
      </div>
      {tab === "cards" ? (
        <>
          <div className="filter-row">
            <SelectInput id="gc-status" label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All cards</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="expired">Expired</option>
            </SelectInput>
            <TextInput id="gc-search" label="Search" placeholder="Last digits, holder or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {list.data ? (
            <p data-testid="gc-total">
              {list.data.total} {list.data.total === 1 ? "card" : "cards"}, holding <strong>{rupees(list.data.balanceTotal)}</strong>
            </p>
          ) : null}
          <Alert kind="error">{list.error}</Alert>
          <DataTable columns={columns} rows={list.data?.rows ?? null} rowKey={(c) => c.id} loading={list.loading} empty="No gift cards yet. They are sold at the till." />
        </>
      ) : (
        <GiftCardReports canRun={canManage} />
      )}
    </>
  );
}

export function GiftCardDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const canManage = hasPermission(user, "giftcards.manage");
  const card = useLoad(() => api.get<GiftCardDto>(`/gift-cards/${id}`), [id]);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function block() {
    setError(null);
    if (!reason.trim()) return setError("Say why the card is blocked (for example: lost by the customer)");
    setBusy(true);
    try {
      card.setData(await api.post<GiftCardDto>(`/gift-cards/${id}/block`, { reason: reason.trim() }));
      setBlocking(false);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setError(null);
    setBusy(true);
    try {
      card.setData(await api.post<GiftCardDto>(`/gift-cards/${id}/unblock`, {}));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const c = card.data;
  return (
    <>
      <p>
        <Link href="/gift-cards">← Gift cards</Link>
      </p>
      <Alert kind="error">{card.error}</Alert>
      {!c ? (
        card.loading ? <p className="muted">Loading…</p> : null
      ) : (
        <>
          <div className="toolbar">
            <h1 style={{ margin: 0 }}>
              Gift card <span className="mono">{cardNumber(c.number)}</span>
            </h1>
            <Badge kind={CARD_STATUS_TONE[c.status]}>{CARD_STATUS_LABELS[c.status]}</Badge>
            <span className="spacer" />
            {canManage && c.status === "active" ? <Button onClick={() => setBlocking(true)}>Block the card</Button> : null}
            {canManage && c.status === "blocked" ? (
              <Button busy={busy} onClick={() => void unblock()}>
                Unblock
              </Button>
            ) : null}
          </div>
          {!blocking ? <Alert kind="error">{error}</Alert> : null}
          <div className="card">
            <dl className="details">
              <dt>Balance</dt>
              <dd>
                <strong>{rupees(c.balance)}</strong> of {rupees(c.loadedTotal)} loaded
              </dd>
              <dt>Holder</dt>
              <dd>{[c.holderName, c.holderPhone].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>Sold on</dt>
              <dd>{formatDate(c.issuedOn)}</dd>
              <dt>Expires on</dt>
              <dd>{formatDate(c.expiresOn)}</dd>
              {c.status === "blocked" ? (
                <>
                  <dt>Blocked because</dt>
                  <dd>{c.blockedReason ?? "—"}</dd>
                </>
              ) : null}
            </dl>
          </div>
          <h2>History</h2>
          <table className="table" aria-label="Card history">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Bill</th>
                <th className="num">Amount</th>
                <th className="num">Balance after</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(c.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.createdAt)}</td>
                  <td>{CARD_ENTRY_LABELS[e.kind] ?? e.kind}</td>
                  <td>{e.billId && e.billNumber ? <Link href={`/pos/bills/${e.billId}`}>{e.billNumber}</Link> : "—"}</td>
                  <td className="num">{rupees(e.amount)}</td>
                  <td className="num">{rupees(e.balanceAfter)}</td>
                  <td>{e.remark ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Dialog open={blocking} title="Block the gift card" onClose={() => setBlocking(false)}>
        <p className="muted">A blocked card cannot be spent or reloaded until it is unblocked. Its money stays on it.</p>
        <Alert kind="error">{error}</Alert>
        <TextareaInput id="gc-block-reason" label="Why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void block()}>
            Block
          </Button>
          <Button onClick={() => setBlocking(false)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}

export function GiftCardReports({ canRun }: { canRun: boolean }) {
  const liability = useLoad(() => api.get<GiftCardLiability>("/gift-cards/reports/liability"));
  const months = useLoad(() => api.get<GiftCardMonth[]>("/gift-cards/reports/by-month"));
  const expiring = useLoad(() => api.get<GiftCardsExpiring>("/gift-cards/reports/expiring"));
  const [confirm, setConfirm] = useState(false);
  const [ran, setRan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ cards: number; value: string }>("/gift-cards/expiry/run", { confirm: true });
      setRan(r.cards ? `${r.cards} ${r.cards === 1 ? "card" : "cards"} expired; ${rupees(r.value)} written back.` : "No cards were due to expire today.");
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
        <h2 style={{ marginTop: 0 }}>Money on gift cards</h2>
        <Alert kind="error">{liability.error}</Alert>
        {l ? (
          <>
            <p>
              <strong>{l.cards}</strong> {l.cards === 1 ? "card holds" : "cards hold"} <strong>{rupees(l.balance)}</strong>
              {l.byStatus.length ? ` (${l.byStatus.map((s) => `${CARD_STATUS_LABELS[s.status as GiftCardDto["status"]] ?? s.status}: ${s.cards}, ${rupees(s.balance)}`).join("; ")})` : ""}.
            </p>
            <p data-testid="cards-check">
              {l.ok ? <Badge kind="ok">Matches the accounts</Badge> : <Badge kind="warn">Does not match: difference {rupees(l.difference)}</Badge>}{" "}
              <span className="muted">
                In the accounts {rupees(l.ledger)}
                {l.pending !== "0.00" ? `, ${rupees(l.pending)} spent on bills of till shifts still open` : ""}.
              </span>
            </p>
          </>
        ) : null}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sold and spent by month</h2>
        <Alert kind="error">{months.error}</Alert>
        <table className="table" aria-label="Gift cards by month">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Sold and reloaded</th>
              <th className="num">Spent</th>
              <th className="num">Refunds to cards</th>
              <th className="num">Expired</th>
            </tr>
          </thead>
          <tbody>
            {(months.data ?? []).map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                <td className="num">{rupees(m.loaded)}</td>
                <td className="num">{rupees(m.spent)}</td>
                <td className="num">{rupees(m.refunded)}</td>
                <td className="num">{rupees(m.expired)}</td>
              </tr>
            ))}
            {months.data && !months.data.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cards expiring soon</h2>
        <Alert kind="error">{expiring.error}</Alert>
        {expiring.data ? (
          <>
            <p className="muted">
              {formatDate(expiring.data.from)} to {formatDate(expiring.data.to)}: {rupees(expiring.data.balance)} on {expiring.data.rows.length} {expiring.data.rows.length === 1 ? "card" : "cards"}. What is left when a card expires is written back at night.
            </p>
            {expiring.data.rows.length ? (
              <table className="table" aria-label="Cards expiring">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Holder</th>
                    <th className="num">Balance</th>
                    <th>Expires on</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.data.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/gift-cards/${c.id}`}>
                          <span className="mono">{cardNumber(c.number)}</span>
                        </Link>
                      </td>
                      <td>{[c.holderName, c.holderPhone].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="num">{rupees(c.balance)}</td>
                      <td>{formatDate(c.expiresOn)}</td>
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
          <p className="muted">Every night, the balance of cards past their expiry day is written back. You can run today&apos;s now; running it twice changes nothing.</p>
          <Alert kind="error">{error}</Alert>
          {ran ? <Alert kind="success">{ran}</Alert> : null}
          {confirm ? (
            <div className="actions">
              <span>Expire today&apos;s cards now?</span>
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
