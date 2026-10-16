// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type FormEvent, useState } from "react";
import { bankAccountSchema, createAccountSchema, updateBankAccountSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, RadioInput, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type AccountDto, accountName, accountRights, type BankAccountDto } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { useChart } from "./accounts-shared";

interface BankForm {
  ledger: "existing" | "new";
  accountId: string;
  ledgerName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  isDefault: boolean;
  active: boolean;
}

function BankDialog({ bank, accounts, linked, onClose, onSaved }: { bank: BankAccountDto | null; accounts: AccountDto[]; linked: Set<string>; onClose: () => void; onSaved: () => void }) {
  const free = accounts.filter((a) => a.kind === "bank" && !a.isGroup && a.active && !linked.has(a.id));
  const folder = accounts.find((a) => a.systemKey === "bank_group");
  const [form, setForm] = useState<BankForm>(
    bank
      ? { ledger: "existing", accountId: bank.account.id, ledgerName: "", bankName: bank.bankName, accountNumber: "", ifsc: bank.ifsc ?? "", branch: bank.branch ?? "", isDefault: bank.isDefault, active: bank.active }
      : { ledger: free.length ? "existing" : "new", accountId: free[0]?.id ?? "", ledgerName: "", bankName: "", accountNumber: "", ifsc: "", branch: "", isDefault: false, active: true },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BankForm>(k: K, v: BankForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (bank) {
        const body = { bankName: form.bankName, ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber } : {}), ifsc: blankToNull(form.ifsc), branch: blankToNull(form.branch), isDefault: form.isDefault, active: form.active };
        const parsed = updateBankAccountSchema.safeParse(body);
        setErrors(issuesToFieldErrors(parsed));
        if (!parsed.success) return;
        setBusy(true);
        await api.patch(`/bank-accounts/${bank.id}`, parsed.data);
      } else {
        const details = { bankName: form.bankName, accountNumber: form.accountNumber, ifsc: blankToNull(form.ifsc), branch: blankToNull(form.branch), isDefault: form.isDefault };
        const parsed = bankAccountSchema.omit({ accountId: true }).safeParse(details);
        const errs = issuesToFieldErrors(parsed);
        if (form.ledger === "existing" && !form.accountId) errs.accountId = "Choose the bank account in the chart";
        if (form.ledger === "new" && !form.ledgerName.trim()) errs.ledgerName = "Give the account a name, for example HDFC current account";
        if (form.ledger === "new" && !folder) errs.ledgerName = "The Bank accounts folder is missing from the chart";
        setErrors(errs);
        if (!parsed.success || Object.keys(errs).length) return;
        setBusy(true);
        let accountId = form.accountId;
        if (form.ledger === "new") {
          const input = createAccountSchema.parse({ parentId: folder!.id, name: form.ledgerName, isGroup: false, kind: "bank", balanceMustBe: null });
          const created = await api.post<AccountDto>("/accounts", input);
          accountId = created.id;
        }
        await api.post("/bank-accounts", { ...parsed.data, accountId });
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
    <Dialog open title={bank ? `Change ${bank.bankName}` : "Add a bank account"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        {!bank ? (
          <fieldset className="card">
            <legend>Account in the chart</legend>
            <p className="muted">Every bank account has its own account in the chart, under Bank accounts, where its money is recorded.</p>
            <RadioInput id="bank-ledger-existing" name="bank-ledger" label="Use a bank account already in the chart" checked={form.ledger === "existing"} disabled={free.length === 0} onChange={() => set("ledger", "existing")} />
            <RadioInput id="bank-ledger-new" name="bank-ledger" label="Make a new one in the chart now" checked={form.ledger === "new"} onChange={() => set("ledger", "new")} />
            {form.ledger === "existing" ? (
              <SelectInput id="bank-account" label="Account in the chart" value={form.accountId} onChange={(e) => set("accountId", e.target.value)} error={errors.accountId} required>
                <option value="">Choose</option>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountName(a)}
                  </option>
                ))}
              </SelectInput>
            ) : (
              <TextInput id="bank-ledger-name" label="Name in the chart" value={form.ledgerName} onChange={(e) => set("ledgerName", e.target.value)} error={errors.ledgerName} maxLength={100} required hint="Added under the Bank accounts folder." />
            )}
          </fieldset>
        ) : (
          <p>
            Account in the chart: <strong>{accountName(bank.account)}</strong>
          </p>
        )}
        <div className="form-grid">
          <TextInput id="bank-name" label="Bank" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} error={errors.bankName} maxLength={100} required />
          <TextInput
            id="bank-number"
            label="Account number"
            value={form.accountNumber}
            onChange={(e) => set("accountNumber", e.target.value)}
            error={errors.accountNumber}
            autoComplete="off"
            required={!bank}
            hint={bank ? `Now ${bank.maskedNumber}. Leave empty to keep it.` : "Shown with only the last four digits in lists."}
          />
          <TextInput id="bank-ifsc" label="IFSC" value={form.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} error={errors.ifsc} maxLength={11} />
          <TextInput id="bank-branch" label="Branch" value={form.branch} onChange={(e) => set("branch", e.target.value)} error={errors.branch} maxLength={100} />
        </div>
        <CheckInput id="bank-default" label="Main bank account" description="Offered first on receipts and payments." checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
        {bank ? <CheckInput id="bank-active" label="In use" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> : null}
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

/** The shop's bank accounts, linked to their accounts in the chart. */
export function BankAccounts() {
  const { user } = useAuth();
  const canManage = accountRights(user).manage;
  const banks = useLoad(() => api.get<BankAccountDto[]>("/bank-accounts"));
  const chart = useChart();
  const [editing, setEditing] = useState<BankAccountDto | "new" | null>(null);
  const linked = new Set((banks.data ?? []).map((b) => b.account.id));

  const columns: Column<BankAccountDto>[] = [
    {
      key: "bank",
      header: "Bank",
      render: (b) => (
        <>
          {b.bankName} {b.isDefault ? <Badge kind="ok">Main</Badge> : null}
        </>
      ),
    },
    { key: "number", header: "Account number", render: (b) => <span className="mono">{b.maskedNumber}</span> },
    { key: "ifsc", header: "IFSC", render: (b) => <span className="mono">{b.ifsc ?? "—"}</span> },
    { key: "branch", header: "Branch", render: (b) => b.branch ?? "—" },
    { key: "ledger", header: "Account in the chart", render: (b) => accountName(b.account) },
    { key: "active", header: "Status", render: (b) => <ActiveBadge active={b.active} /> },
    ...(canManage
      ? ([
          {
            key: "actions",
            header: "",
            render: (b) => (
              <Button size="small" onClick={() => setEditing(b)}>
                Change
              </Button>
            ),
          },
        ] satisfies Column<BankAccountDto>[])
      : []),
  ];

  return (
    <>
      <h1>Bank accounts</h1>
      {canManage ? (
        <div className="toolbar">
          <Button variant="primary" disabled={!chart.data} onClick={() => setEditing("new")}>
            Add a bank account
          </Button>
        </div>
      ) : null}
      <Alert kind="error">{banks.error ?? chart.error}</Alert>
      <DataTable columns={columns} rows={banks.data} rowKey={(b) => b.id} loading={banks.loading} empty="No bank accounts yet." />
      {editing && chart.data ? <BankDialog bank={editing === "new" ? null : editing} accounts={chart.data.accounts} linked={linked} onClose={() => setEditing(null)} onSaved={() => void Promise.all([banks.reload(), chart.reload()])} /> : null}
    </>
  );
}
