// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { ACCOUNT_KIND_LABELS, ACCOUNT_KINDS, ACCOUNT_ROLES, type AccountKind, approveChartSchema, businessDate, createAccountSchema, STORE_ACCOUNT_ROLES, updateAccountSchema } from "shared";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, CheckInput, Dialog, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type AccountDto, type AccountNode, accountName, accountRights, buildTree, type ChartDto, FAMILY_LABELS, moveTargets } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

type Editing = { mode: "new"; parent: AccountDto; isGroup: boolean } | { mode: "edit"; account: AccountDto } | null;

const ROLE_LABELS: Record<string, string> = { ...ACCOUNT_ROLES, ...STORE_ACCOUNT_ROLES };

function roleLabel(role: string): string {
  // Per-store roles are saved as "cash_in_till:<store id>".
  return ROLE_LABELS[role.split(":")[0]] ?? role;
}

interface TreeProps {
  nodes: AccountNode[];
  showOff: boolean;
  rights: ReturnType<typeof accountRights>;
  busy: string | null;
  onAdd: (parent: AccountDto, isGroup: boolean) => void;
  onEdit: (a: AccountDto) => void;
  onActive: (a: AccountDto, active: boolean) => void;
  onLock: (a: AccountDto, locked: boolean) => void;
}

function AccountTree({ nodes, showOff, rights, busy, onAdd, onEdit, onActive, onLock }: TreeProps) {
  const shown = nodes.filter((n) => showOff || n.active);
  if (shown.length === 0) return null;
  return (
    <ul className="tree">
      {shown.map((n) => (
        <li key={n.id}>
          <div className="tree-row">
            <span>
              {n.isGroup ? <strong>{accountName(n)}</strong> : accountName(n)}
              {!n.parentId && FAMILY_LABELS[n.family] !== n.name ? <span className="muted"> · {FAMILY_LABELS[n.family]}</span> : null}
            </span>
            {!n.isGroup && n.kind ? <Badge kind="neutral">{ACCOUNT_KIND_LABELS[n.kind]}</Badge> : null}
            {n.locked ? <Badge kind="warn">Locked</Badge> : null}
            {!n.active ? <Badge kind="off">Switched off</Badge> : null}
            <span className={`mono${n.balance?.startsWith("-") ? " num-negative" : ""}`} aria-label={`Balance of ${n.name}`}>
              {rupees(n.balance ?? "0")}
            </span>
            {n.usedFor && n.usedFor.length > 0 ? <span className="muted">Used for: {n.usedFor.map(roleLabel).join(", ")}</span> : null}
            {rights.manage || rights.lockBooks ? (
              <span className="row-actions">
                {rights.manage && n.isGroup && n.active ? (
                  <>
                    <Button size="small" onClick={() => onAdd(n, false)}>
                      Add account
                    </Button>
                    <Button size="small" onClick={() => onAdd(n, true)}>
                      Add folder
                    </Button>
                  </>
                ) : null}
                {rights.manage && n.parentId ? (
                  <>
                    <Button size="small" onClick={() => onEdit(n)}>
                      Change
                    </Button>
                    <Button size="small" busy={busy === `active-${n.id}`} onClick={() => onActive(n, !n.active)}>
                      {n.active ? "Switch off" : "Switch on"}
                    </Button>
                  </>
                ) : null}
                {rights.lockBooks && !n.isGroup ? (
                  <Button size="small" busy={busy === `lock-${n.id}`} onClick={() => onLock(n, !n.locked)}>
                    {n.locked ? "Unlock" : "Lock"}
                  </Button>
                ) : null}
              </span>
            ) : null}
          </div>
          <AccountTree nodes={n.children} showOff={showOff} rights={rights} busy={busy} onAdd={onAdd} onEdit={onEdit} onActive={onActive} onLock={onLock} />
        </li>
      ))}
    </ul>
  );
}

/** The Chartered Accountant's approval of the chart (decision 55), recorded by the Owner. */
function ApproveChartDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = approveChartSchema.safeParse({ note });
    setFieldError(parsed.success ? null : (issuesToFieldErrors(parsed).note ?? "Write a short note"));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/accounts/approve-chart", parsed.data);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Record the CA's approval" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <p>Do this only after your Chartered Accountant has checked the chart of accounts and agreed to it. The note is kept in the change history.</p>
        <TextareaInput id="approve-note" label="Note" hint="For example: who approved it and when, or the letter's reference." value={note} onChange={(e) => setNote(e.target.value)} error={fieldError} maxLength={300} required />
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Record approval
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Go back
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface AccountForm {
  number: string;
  name: string;
  kind: string;
  balanceMustBe: string;
  parentId: string;
  storeId: string;
}

/** Add an account or folder under a folder, or change one (name, number, folder, kind). */
function AccountDialog({ editing, accounts, onClose, onSaved }: { editing: Exclude<Editing, null>; accounts: AccountDto[]; onClose: () => void; onSaved: () => void }) {
  const isNew = editing.mode === "new";
  const account = editing.mode === "edit" ? editing.account : null;
  const isGroup = isNew ? editing.isGroup : account!.isGroup;
  const { stores } = useOrderStores();
  const [form, setForm] = useState<AccountForm>(
    account
      ? { number: account.number ?? "", name: account.name, kind: account.kind ?? "", balanceMustBe: account.balanceMustBe ?? "", parentId: account.parentId ?? "", storeId: account.storeId ?? "" }
      : { number: "", name: "", kind: "", balanceMustBe: "", parentId: editing.mode === "new" ? editing.parent.id : "", storeId: "" },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const targets = account ? moveTargets(accounts, account) : [];
  const title = isNew ? `${isGroup ? "New folder" : "New account"} under ${editing.parent.name}` : `Change ${account!.name}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isNew) {
        const body = {
          parentId: form.parentId,
          number: blankToNull(form.number),
          name: form.name,
          isGroup,
          kind: isGroup ? null : form.kind || null,
          storeId: !isGroup && form.kind === "cash" ? form.storeId || null : null,
          balanceMustBe: isGroup ? null : form.balanceMustBe || null,
        };
        const parsed = createAccountSchema.safeParse(body);
        const errs = issuesToFieldErrors(parsed);
        if (!isGroup && !form.kind) errs.kind = "Choose what kind of account it is";
        setErrors(errs);
        if (!parsed.success || Object.keys(errs).length) return;
        setBusy(true);
        await api.post("/accounts", parsed.data);
      } else {
        const body = {
          name: form.name,
          number: blankToNull(form.number),
          ...(account!.parentId && form.parentId !== account!.parentId ? { parentId: form.parentId } : {}),
          ...(!isGroup ? { kind: (form.kind || null) as AccountKind | null, balanceMustBe: (form.balanceMustBe || null) as "debit" | "credit" | null } : {}),
        };
        const parsed = updateAccountSchema.safeParse(body);
        setErrors(issuesToFieldErrors(parsed));
        if (!parsed.success) return;
        setBusy(true);
        await api.patch(`/accounts/${account!.id}`, parsed.data);
      }
      onSaved();
      onClose();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <TextInput id="acc-name" label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={100} required />
          <TextInput id="acc-number" label="Account number" hint="Optional. Keeps the chart in order." value={form.number} onChange={(e) => set("number", e.target.value)} error={errors.number} maxLength={20} />
          {!isGroup ? (
            <>
              <SelectInput id="acc-kind" label="What kind of account" value={form.kind} onChange={(e) => set("kind", e.target.value)} error={errors.kind} required hint="Tells the system how the account is used.">
                <option value="">Choose</option>
                {ACCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ACCOUNT_KIND_LABELS[k]}
                  </option>
                ))}
              </SelectInput>
              <SelectInput id="acc-side" label="Balance must stay" value={form.balanceMustBe} onChange={(e) => set("balanceMustBe", e.target.value)} hint="Optional warning when the balance goes the wrong way.">
                <option value="">No check</option>
                <option value="debit">Debit (money we have or are owed)</option>
                <option value="credit">Credit (money we owe)</option>
              </SelectInput>
              {isNew && form.kind === "cash" ? (
                <SelectInput id="acc-store" label="Store" value={form.storeId} onChange={(e) => set("storeId", e.target.value)} hint="For a shop's own cash account. Leave empty for the head office.">
                  <option value="">No store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </SelectInput>
              ) : null}
            </>
          ) : null}
          {account?.parentId ? (
            <SelectInput id="acc-parent" label="In folder" value={form.parentId} onChange={(e) => set("parentId", e.target.value)} error={errors.parentId} hint="Move it to another folder of the same family.">
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {accountName(t)}
                </option>
              ))}
            </SelectInput>
          ) : null}
        </div>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Go back
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Chart of accounts: the tree with balances, the approval banner and the changes the user may make. */
export function ChartOfAccounts() {
  const { user } = useAuth();
  const rights = accountRights(user);
  const chart = useLoad(() => api.get<ChartDto>("/accounts"));
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      await run();
      setNotice(done);
      await chart.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const data = chart.data;
  const tree = data ? buildTree(data.accounts) : [];

  return (
    <>
      <h1>Chart of accounts</h1>
      {data && !data.approval ? (
        <Alert kind="info">
          <strong>Proposed chart, waiting for the Chartered Accountant&apos;s approval.</strong> Everything works for testing. Before the shop goes live, the Owner records the CA&apos;s approval here.
        </Alert>
      ) : null}
      {data?.approval ? (
        <p className="muted">
          Approved by the Chartered Accountant, recorded on {formatDate(businessDate(new Date(data.approval.approvedAt)))}
          {data.approval.note ? `: ${data.approval.note}` : "."}
        </p>
      ) : null}
      <div className="toolbar">
        <CheckInput id="chart-show-off" label="Show switched-off accounts" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
        <span className="spacer" />
        {data && !data.approval && rights.approveChart ? (
          <Button variant="primary" onClick={() => setApproving(true)}>
            Record the CA&apos;s approval
          </Button>
        ) : null}
      </div>
      <p className="muted">Balances are shown the natural way round: what the shop owns and its expenses as money in hand, the rest as money owed or earned. A minus sign means the balance has gone the other way.</p>
      <Alert kind="error">{chart.error ?? error}</Alert>
      <Alert kind="success">{notice}</Alert>
      {chart.loading && !data ? <p className="muted">Loading…</p> : null}
      <AccountTree
        nodes={tree}
        showOff={showOff}
        rights={rights}
        busy={busy}
        onAdd={(parent, isGroup) => setEditing({ mode: "new", parent, isGroup })}
        onEdit={(account) => setEditing({ mode: "edit", account })}
        onActive={(a, active) => act(`active-${a.id}`, () => api.patch(`/accounts/${a.id}`, { active }), `${a.name} ${active ? "switched on" : "switched off"}.`)}
        onLock={(a, locked) => act(`lock-${a.id}`, () => api.post(`/accounts/${a.id}/lock`, { locked }), `${a.name} ${locked ? "locked: only the Accountant can post to it now" : "unlocked"}.`)}
      />
      {editing && data ? <AccountDialog editing={editing} accounts={data.accounts} onClose={() => setEditing(null)} onSaved={() => void chart.reload()} /> : null}
      <ApproveChartDialog open={approving} onClose={() => setApproving(false)} onDone={() => void chart.reload()} />
    </>
  );
}
