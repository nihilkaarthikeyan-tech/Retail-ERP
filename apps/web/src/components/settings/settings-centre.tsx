// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §5: the settings centre. Every company-wide setting in one place,
// grouped by area, each with a plain label, one line on what it changes, its
// default and "Back to default". Values are read and saved through each
// module's own settings API (shared/settings-centre.ts lists them), so the
// rules stay with the module; sections of switched-off modules are hidden; a
// search box finds any setting by name. The older settings screens still work
// and are linked from here.
"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  changeableHere,
  Decimal,
  hasSettingsRight,
  matchesSearch,
  MODULE_KEYS,
  type SettingDef,
  SETTINGS,
  SETTINGS_SECTIONS,
  SETTINGS_SOURCES,
  type SettingsSection,
  type SettingsSourceKey,
  SHOP_TYPES,
  type ShopTypeKey,
} from "shared";
import { Badge, Button, TextInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useModules } from "@/lib/modules";

/** The "My modules" page (switching optional modules on and off, and the shop type). */
export const MY_MODULES_HREF = "/settings/modules";

type Values = Record<string, unknown>;
type SourceState = { values: Values | null; error: string | null };
interface LookupRow {
  id: string;
  code: string;
  name: string;
  active?: boolean;
  isLeaf?: boolean;
  children?: LookupRow[];
  [k: string]: unknown;
}
type LookupState = { rows: LookupRow[] | null; error: string | null };

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

function flatten(rows: LookupRow[], depth = 0): (LookupRow & { depth: number })[] {
  return rows.flatMap((r) => [{ ...r, depth }, ...flatten(r.children ?? [], depth + 1)]);
}

/** The default value as the API would send it, or undefined while its list is still loading. */
export function defaultValue(s: SettingDef, lookups: Record<string, LookupState>): unknown {
  if (s.kind === "reference" && s.lookup?.defaultCode) {
    const rows = lookups[s.lookup.url]?.rows;
    if (!rows) return undefined;
    return flatten(rows).find((r) => r.code === s.lookup!.defaultCode)?.id ?? null;
  }
  return s.default;
}

/** Is this value the default? Money and percentages compare as numbers ("100.00" = "100"). */
export function isAtDefault(s: SettingDef, value: unknown, def: unknown): boolean {
  if (def === undefined) return false;
  if ((s.kind === "money" || s.kind === "percent") && !isEmpty(value) && !isEmpty(def)) {
    try {
      return new Decimal(String(value)).eq(String(def));
    } catch {
      return false;
    }
  }
  if (isEmpty(value) && isEmpty(def)) return true;
  return JSON.stringify(value) === JSON.stringify(def);
}

/** How a value reads in plain words. */
function shown(s: SettingDef, value: unknown, lookups: Record<string, LookupState>): string {
  if (s.kind === "boolean") return value ? "On" : "Off";
  if (s.kind === "choice") return s.choices?.find((c) => c.value === value)?.label ?? String(value ?? "—");
  if (s.kind === "money") return isEmpty(value) ? "None" : rupees(String(value));
  if (s.kind === "percent") return isEmpty(value) ? "None" : `${String(value)}%`;
  if (s.kind === "date") return isEmpty(value) ? s.defaultText : formatDate(String(value));
  if (s.kind === "reference") {
    if (isEmpty(value)) return "None";
    const rows = s.lookup ? lookups[s.lookup.url]?.rows : null;
    return rows ? (flatten(rows).find((r) => r.id === value)?.name ?? "A row that was removed") : "Set";
  }
  if (s.kind === "elsewhere") {
    switch (s.show) {
      case "onOff":
        return value ? "On" : "Off";
      case "approved":
        return value ? "Approved" : "Not approved";
      case "setOrNot":
        return value ? "Set" : "Not set";
      case "count": {
        const n = Array.isArray(value) ? value.length : Number(value);
        return Array.isArray(value) && n === 0 ? s.defaultText : `${n} ${s.unit ?? ""}`.trim();
      }
      case "list":
        if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
        if (value && typeof value === "object") {
          const entries = Object.entries(value as Record<string, unknown>);
          return entries.length ? entries.map(([k, v]) => `${k}: ${rupees(String(v))}`).join(", ") : "None";
        }
        return "None";
    }
  }
  return isEmpty(value) ? "None" : String(value);
}

// ---- The page ----

export function SettingsCentre() {
  const { user, loading } = useAuth();
  const modules = useModules();
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Partial<Record<SettingsSourceKey, SourceState>>>({});
  const [lookups, setLookups] = useState<Record<string, LookupState>>({});

  const readable = useMemo(() => (Object.keys(SETTINGS_SOURCES) as SettingsSourceKey[]).filter((k) => hasSettingsRight(user, SETTINGS_SOURCES[k].read)), [user]);
  const sectionOn = (sec: SettingsSection) => !sec.module || modules.isOn(sec.module);

  // Every settings API this user may read, once.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    for (const key of readable) {
      api.get<Values>(SETTINGS_SOURCES[key].get).then(
        (values) => !cancelled && setSources((s) => ({ ...s, [key]: { values, error: null } })),
        (err: unknown) => !cancelled && setSources((s) => ({ ...s, [key]: { values: null, error: errorMessage(err) } })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [user, readable]);

  // The lists that "choose from a list" settings need, once each.
  const lookupUrls = useMemo(() => [...new Set(SETTINGS.filter((s) => s.kind === "reference" && s.lookup && readable.includes(s.source)).map((s) => s.lookup!.url))], [readable]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    for (const url of lookupUrls) {
      api.get<LookupRow[]>(url).then(
        (rows) => !cancelled && setLookups((l) => ({ ...l, [url]: { rows, error: null } })),
        (err: unknown) => !cancelled && setLookups((l) => ({ ...l, [url]: { rows: null, error: errorMessage(err) } })),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [user, lookupUrls]);

  if (loading) return <p className="muted">Loading…</p>;

  const q = query.trim();
  const visible = SETTINGS_SECTIONS.filter(sectionOn).map((sec) => {
    const settings = SETTINGS.filter((s) => s.section === sec.key && readable.includes(s.source) && matchesSearch(s, q));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const links = sec.links.filter((l) => hasSettingsRight(user, l.right) && (!q || words.every((w) => `${l.label} ${sec.title}`.toLowerCase().includes(w))));
    return { sec, settings, links };
  });
  const shownSections = visible.filter((v) => v.settings.length > 0 || v.links.length > 0);
  const found = shownSections.reduce((n, v) => n + v.settings.length, 0);
  const shopType = modules.shopType && modules.shopType in SHOP_TYPES ? SHOP_TYPES[modules.shopType as ShopTypeKey] : null;
  const onCount = MODULE_KEYS.filter((k) => modules.isOn(k)).length;

  return (
    <div className="settings-centre">
      <h1>Settings</h1>
      <p className="muted">Everything your business can set, in one place. Each setting says what it changes and what it starts as; “Back to default” puts it back.</p>

      <div className="settings-top">
        {user?.isOwnerAdmin ? (
          <Link href={MY_MODULES_HREF} className="card settings-top-card">
            <strong>My modules</strong>
            <span className="muted">
              {onCount} of {MODULE_KEYS.length} optional modules on. Switch parts of the product on or off; nothing is ever deleted.
            </span>
          </Link>
        ) : null}
        <div className="card settings-top-card">
          <strong>Shop type</strong>
          <span className="muted">
            {shopType ? `${shopType.label}: ${shopType.description}` : "Not chosen. Every optional module is on."}
            {user?.isOwnerAdmin ? (
              <>
                {" "}
                <Link href={MY_MODULES_HREF}>See or change it</Link>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="settings-search">
        <TextInput id="settings-search" type="search" label="Find a setting" placeholder="For example: receipt, credit limit, paper" value={query} onChange={(e) => setQuery(e.target.value)} />
        {q ? (
          <p className="muted" role="status">
            {found === 0 ? "No setting matches that." : `${found} ${found === 1 ? "setting" : "settings"} found.`}
          </p>
        ) : null}
      </div>

      {!q && shownSections.length > 1 ? (
        <nav className="settings-jump" aria-label="Settings areas">
          {shownSections.map(({ sec }) => (
            <a key={sec.key} href={`#settings-${sec.key}`} className={`area-${sec.area}`}>
              {sec.title}
            </a>
          ))}
        </nav>
      ) : null}

      {shownSections.map(({ sec, settings, links }) => (
        <section key={sec.key} id={`settings-${sec.key}`} className={`card settings-section area-${sec.area}`} aria-labelledby={`settings-${sec.key}-title`}>
          <h2 id={`settings-${sec.key}-title`}>{sec.title}</h2>
          <p className="muted">{sec.lead}</p>
          {settings.length ? (
            <ul className="settings-list">
              {settings.map((s) => (
                <SettingRow
                  key={s.id}
                  s={s}
                  source={sources[s.source]}
                  canChange={hasSettingsRight(user, SETTINGS_SOURCES[s.source].change)}
                  lookups={lookups}
                  onSaved={(values) => setSources((all) => ({ ...all, [s.source]: { values, error: null } }))}
                />
              ))}
            </ul>
          ) : null}
          {links.length ? (
            <p className="settings-links">
              <span className="muted">Also: </span>
              {links.map((l, i) => (
                <span key={l.href + l.label}>
                  {i > 0 ? " · " : null}
                  <Link href={l.href}>{l.label}</Link>
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

// ---- One setting ----

function SettingRow({ s, source, canChange, lookups, onSaved }: { s: SettingDef; source: SourceState | undefined; canChange: boolean; lookups: Record<string, LookupState>; onSaved: (v: Values) => void }) {
  const value = source?.values ? source.values[s.field] : undefined;
  const def = defaultValue(s, lookups);
  const atDefault = isAtDefault(s, value, def);
  const editable = canChange && changeableHere(s) && !(s.kind === "reference" && (!s.lookup || !lookups[s.lookup.url]?.rows));
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = `setting-${s.id.replace(/\./g, "-")}`;

  async function save(next: unknown) {
    const how = SETTINGS_SOURCES[s.source].save;
    if (!how || !source?.values) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = how.fields ? { ...Object.fromEntries(how.fields.map((f) => [f, source.values![f]])), [s.field]: next } : { [s.field]: next };
      const updated = how.method === "PUT" ? await api.put<Values>(how.path, body) : await api.patch<Values>(how.path, body);
      onSaved(updated);
      setDraft(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.errors.length ? err.errors.map((e) => e.message).join("; ") : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submitDraft(e: FormEvent) {
    e.preventDefault();
    if (draft === null) return;
    const t = draft.trim();
    void save(s.kind === "date" || s.kind === "text" ? t || null : t);
  }

  let control: ReactNode;
  if (source?.error) control = <span className="field-error">{source.error}</span>;
  else if (value === undefined && !source?.values) control = <span className="muted">Loading…</span>;
  else if (!editable) {
    control = (
      <span className="settings-value">
        <strong>{shown(s, value, lookups)}</strong>
        {s.screen ? (
          <>
            {" "}
            <Link href={s.screen.href}>{s.kind === "elsewhere" && canChange ? `Change on ${s.screen.label}` : `Open ${s.screen.label}`}</Link>
          </>
        ) : null}
      </span>
    );
  } else if (s.kind === "boolean") {
    control = (
      <label className="settings-switch">
        <input id={id} type="checkbox" checked={!!value} disabled={busy} onChange={(e) => void save(e.target.checked)} />
        <span>{value ? "On" : "Off"}</span>
      </label>
    );
  } else if (s.kind === "choice") {
    control = (
      <select id={id} className="input" value={String(value ?? "")} disabled={busy} aria-label={s.label} onChange={(e) => void save(s.choices!.find((c) => String(c.value) === e.target.value)?.value)}>
        {s.choices!.map((c) => (
          <option key={String(c.value)} value={String(c.value)}>
            {c.label}
          </option>
        ))}
      </select>
    );
  } else if (s.kind === "reference") {
    const rows = flatten(lookups[s.lookup!.url]!.rows!).filter((r) => (!s.lookup!.onlyWhere || r[s.lookup!.onlyWhere] === true) && (r.active !== false || r.id === value));
    control = (
      <select id={id} className="input" value={String(value ?? "")} disabled={busy} aria-label={s.label} onChange={(e) => void save(e.target.value || null)}>
        <option value="">None</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id} disabled={r.isLeaf === false}>
            {`${"  ".repeat(r.depth)}${r.name}`}
          </option>
        ))}
      </select>
    );
  } else {
    const typed = draft ?? (isEmpty(value) ? "" : String(value));
    control = (
      <form className="settings-inline" onSubmit={submitDraft} noValidate>
        <input
          id={id}
          className="input"
          aria-label={s.label}
          type={s.kind === "date" ? "date" : s.kind === "time" ? "time" : "text"}
          inputMode={s.kind === "money" || s.kind === "percent" ? "decimal" : undefined}
          value={typed}
          disabled={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
        />
        {draft !== null && draft !== (isEmpty(value) ? "" : String(value)) ? (
          <Button type="submit" size="small" variant="primary" busy={busy}>
            Save
          </Button>
        ) : null}
      </form>
    );
  }

  return (
    <li className="settings-row">
      <div className="settings-row-text">
        {editable ? (
          <label htmlFor={id} className="settings-label">
            {s.label}
          </label>
        ) : (
          <span className="settings-label">{s.label}</span>
        )}
        <span className="settings-help">{s.help}</span>
        <span className="settings-default">
          Default: {s.defaultText}
          {source?.values && atDefault ? (
            <>
              {" "}
              <Badge kind="neutral">At default</Badge>
            </>
          ) : null}
        </span>
        {s.note && !editable ? <span className="settings-help">{s.note}</span> : null}
      </div>
      <div className="settings-row-control">
        {control}
        {editable && source?.values ? (
          <Button size="small" variant="link" disabled={busy || atDefault || def === undefined} onClick={() => void save(def)} aria-label={`Back to default: ${s.label}`}>
            Back to default
          </Button>
        ) : null}
        {saved ? (
          <span className="settings-saved" role="status">
            Saved
          </span>
        ) : null}
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </li>
  );
}
