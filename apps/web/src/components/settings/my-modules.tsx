// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 "My modules": the owner switches optional modules on and off and can
// apply a shop type again. Switching off only hides a module; nothing is deleted.
"use client";

import { useEffect, useState } from "react";
import { MODULE_KEYS, type ModuleKey, type ModuleSwitchResult, neededBy, OPTIONAL_MODULES, SHOP_TYPE_KEYS, SHOP_TYPES, type ShopTypeKey, type ShopTypeResult } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useModules } from "@/lib/modules";

const CORE = "company and shops, users and rights, items, prices, customers, suppliers, stock, the billing counter, accounts, GST, reports, printing, import and export";

const labelOf = (key: ModuleKey) => OPTIONAL_MODULES[key].label;

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function needsOf(key: ModuleKey): ModuleKey[] {
  return [...(OPTIONAL_MODULES[key].needs as readonly ModuleKey[])];
}

/** What the switch answered, in plain words, when the API sends no message. */
function switchMessage(r: ModuleSwitchResult, key: ModuleKey, enabled: boolean): string {
  if (r.message) return r.message;
  const others = (enabled ? r.switchedOn : r.switchedOff).filter((k) => k !== key).map(labelOf);
  const main = `${labelOf(key)} is switched ${enabled ? "on" : "off"}.`;
  return others.length ? `${main} ${listText(others)} ${others.length === 1 ? "is" : "are"} switched ${enabled ? "on" : "off"} too.` : main;
}

interface PendingOff {
  key: ModuleKey;
  result: ModuleSwitchResult;
}

export function MyModulesScreen() {
  const { user } = useAuth();
  const { modules, shopType, setState, refresh } = useModules();
  const isOwner = !!user?.isOwnerAdmin;
  const [busyKey, setBusyKey] = useState<ModuleKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingOff, setPendingOff] = useState<PendingOff | null>(null);
  // Until the owner picks one, the select shows the current shop type.
  const [chosen, setChoice] = useState<ShopTypeKey | null>(null);
  const choice: ShopTypeKey = chosen ?? (shopType as ShopTypeKey | null) ?? "general";
  const [preview, setPreview] = useState<ShopTypeResult | null>(null);
  const [applying, setApplying] = useState(false);

  // The map may have changed elsewhere since the app loaded it.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function switchModule(key: ModuleKey, enabled: boolean, confirm = false) {
    setError(null);
    setNotice(null);
    setBusyKey(key);
    try {
      const r = await api.patch<ModuleSwitchResult>(`/modules/${key}`, confirm ? { enabled, confirm: true } : { enabled });
      if (r.done) {
        setState({ shopType: r.shopType, modules: r.modules });
        setPendingOff(null);
        setNotice(switchMessage(r, key, enabled));
      } else if (r.needsConfirm) {
        setPendingOff({ key, result: r });
      }
    } catch (err) {
      setError(errorMessage(err));
      setPendingOff(null);
    } finally {
      setBusyKey(null);
    }
  }

  async function askShopType() {
    setError(null);
    setNotice(null);
    setApplying(true);
    try {
      setPreview(await api.post<ShopTypeResult>("/modules/shop-type", { type: choice }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  async function applyShopType() {
    if (!preview) return;
    setError(null);
    setApplying(true);
    try {
      const r = await api.post<ShopTypeResult>("/modules/shop-type", { type: preview.type, confirm: true });
      setState({ shopType: r.shopType, modules: r.modules });
      setPreview(null);
      setNotice(r.message || `${r.label} is applied. Nothing was deleted.`);
    } catch (err) {
      setError(errorMessage(err));
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  const columns: Column<ModuleKey>[] = [
    {
      key: "module",
      header: "Module",
      render: (key) => {
        const needs = needsOf(key);
        const usedBy = neededBy(key);
        return (
          <>
            <strong id={`module-${key}-label`}>{labelOf(key)}</strong>
            <div className="muted">{OPTIONAL_MODULES[key].description}</div>
            {needs.length ? <div className="muted">Needs {listText(needs.map(labelOf))}; switching this on switches that on too.</div> : null}
            {usedBy.length ? <div className="muted">{listText(usedBy.map(labelOf))} {usedBy.length === 1 ? "needs" : "need"} this.</div> : null}
          </>
        );
      },
    },
    { key: "status", header: "Status", render: (key) => (modules[key] ? <Badge kind="ok">On</Badge> : <Badge kind="off">Off</Badge>) },
    {
      key: "switch",
      header: "On or off",
      render: (key) => (
        <input
          type="checkbox"
          role="switch"
          aria-labelledby={`module-${key}-label`}
          checked={modules[key]}
          aria-checked={modules[key]}
          disabled={!isOwner || busyKey !== null}
          onChange={(e) => void switchModule(key, e.target.checked)}
        />
      ),
    },
  ];

  const current = shopType ? SHOP_TYPES[shopType as ShopTypeKey] : null;
  const offKey = pendingOff?.key ?? null;
  const alsoOff = pendingOff ? pendingOff.result.switchedOff.filter((k) => k !== pendingOff.key) : [];

  return (
    <>
      <h1>My modules</h1>
      <p className="muted">
        Switch on only what your shop uses. Switching a module off only hides it: its menus, screens, fields, till buttons and reports. Nothing is deleted, and switching it back on
        shows everything as it was.
      </p>
      {!isOwner ? <Alert kind="info">Only the Owner can switch modules or change the shop type.</Alert> : null}
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      <section className="card" aria-labelledby="shop-type-heading">
        <h2 id="shop-type-heading" style={{ marginTop: 0 }}>
          Shop type
        </h2>
        <p>
          {current ? (
            <>
              Your shop type is <strong>{current.label}</strong>: {current.description}
            </>
          ) : (
            "No shop type has been chosen; every module you see switched on stays as it is."
          )}
        </p>
        {isOwner ? (
          <div className="form-grid">
            <SelectInput id="shop-type" label="Apply a shop type" value={choice} onChange={(e) => setChoice(e.target.value as ShopTypeKey)} hint={SHOP_TYPES[choice].description}>
              {SHOP_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SHOP_TYPES[k].label}
                </option>
              ))}
            </SelectInput>
            <div className="actions" style={{ alignSelf: "end" }}>
              <Button busy={applying && !preview} onClick={() => void askShopType()}>
                See what changes
              </Button>
            </div>
          </div>
        ) : null}
        <p className="muted">A shop type sets the modules and adds starting item groups (and size and colour lists for clothes and shoes). It never deletes anything.</p>
      </section>

      <h2>Optional modules</h2>
      <p className="muted">Always on: {CORE}.</p>
      <DataTable columns={columns} rows={MODULE_KEYS} rowKey={(k) => k} />

      <Dialog open={pendingOff !== null} title={offKey ? `Switch off ${labelOf(offKey)}?` : "Switch off?"} onClose={() => setPendingOff(null)}>
        {pendingOff ? (
          <>
            {pendingOff.result.warnings.length ? (
              <>
                <p>Still in use:</p>
                <ul>
                  {pendingOff.result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {alsoOff.length ? (
              <p>
                {listText(alsoOff.map(labelOf))} {alsoOff.length === 1 ? "needs" : "need"} {labelOf(pendingOff.key)}, so {alsoOff.length === 1 ? "it is" : "they are"} switched off too.
              </p>
            ) : null}
            <p className="muted">Nothing is deleted. It is only hidden, and switching it back on shows everything as it was.</p>
            <div className="actions">
              <Button variant="danger" busy={busyKey === pendingOff.key} onClick={() => void switchModule(pendingOff.key, false, true)}>
                Switch off anyway
              </Button>
              <Button onClick={() => setPendingOff(null)}>Keep it on</Button>
            </div>
          </>
        ) : null}
      </Dialog>

      <Dialog open={preview !== null} title={preview ? `Apply “${preview.label}”?` : "Apply shop type?"} onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <p>{preview.switchOn.length ? `Switches on: ${listText(preview.switchOn.map(labelOf))}.` : "Switches on no more modules."}</p>
            <p>{preview.switchOff.length ? `Switches off (hidden, not deleted): ${listText(preview.switchOff.map(labelOf))}.` : "Switches nothing off."}</p>
            {preview.itemGroups.length ? <p>Adds item groups: {listText(preview.itemGroups)}.</p> : <p>Adds no item groups; the starting ones are already there.</p>}
            {preview.attributes.length ? <p>Adds lists: {listText(preview.attributes)}.</p> : null}
            {preview.warnings.length ? (
              <>
                <p>Still in use in the modules it switches off:</p>
                <ul>
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="muted">Nothing is deleted. You can change any module afterwards.</p>
            <div className="actions">
              <Button variant="primary" busy={applying} onClick={() => void applyShopType()}>
                Apply shop type
              </Button>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
