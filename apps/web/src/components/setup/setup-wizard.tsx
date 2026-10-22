// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12 §3 and plan 14: the step-by-step setup of a new shop, for its owner
// after signing up (logged in). Each "Next" checks the step and saves the answers
// so far on the server (PUT /setup/progress), so closing the browser or a power
// cut loses nothing: opening the setup again comes back at the next step with
// every answer kept.
"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  FILING_FREQUENCIES,
  GETTING_STARTED_STEPS,
  GST_SCHEMES,
  gstinProblem,
  indianFinancialYear,
  INDIAN_STATE_OPTIONS,
  isStateCode,
  MODULE_KEYS,
  type ModuleKey,
  neededBy,
  OPTIONAL_MODULES,
  SETUP_STEPS,
  type SetupAnswerKey,
  type SetupDraft,
  setupBusinessSchema,
  setupDraftSchema,
  setupGstSchema,
  setupShopSchema,
  setupSellSchema,
  type SetupStepKey,
  setupTills,
  SHOP_TYPE_KEYS,
  SHOP_TYPES,
  type ShopTypeKey,
  suggestedModules,
  TURNOVER_BANDS,
  withNeeds,
} from "shared";
import { Icon, type IconName } from "@/components/icons";
import { Alert, Button, CheckInput, RadioInput, SelectInput, TextInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { blankToNull, formatDate } from "@/lib/format";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { BrandMark } from "@/components/brand-mark";

// ---- The form, as typed (strings), and to and from the saved answers ----

export interface WizardForms {
  business: { legalName: string; tradeName: string; pan: string; stateCode: string; addressLine1: string; addressLine2: string; city: string; pincode: string; phone: string; email: string; startDate: string; endDate: string };
  gst: { registered: "" | "yes" | "no"; gstin: string; legalNameOnCertificate: string; scheme: string; filingFrequency: string; turnoverBand: string };
  shop: { name: string; code: string; tills: string };
  sell: { shopType: ShopTypeKey | ""; modules: Record<ModuleKey, boolean> };
}

const noModules = () => Object.fromEntries(MODULE_KEYS.map((k) => [k, false])) as Record<ModuleKey, boolean>;
const text = (v: string | null | undefined) => v ?? "";

/** Empty forms; the financial year is filled in once the page is open (not while it is prerendered). */
export function blankForms(year: { startDate: string; endDate: string } = { startDate: "", endDate: "" }): WizardForms {
  return {
    business: { legalName: "", tradeName: "", pan: "", stateCode: "", addressLine1: "", addressLine2: "", city: "", pincode: "", phone: "", email: "", startDate: year.startDate, endDate: year.endDate },
    gst: { registered: "", gstin: "", legalNameOnCertificate: "", scheme: "regular", filingFrequency: "quarterly", turnoverBand: "up_to_5cr" },
    shop: { name: "", code: "", tills: "1" },
    sell: { shopType: "", modules: noModules() },
  };
}

/** The forms filled from the answers saved on the server. */
export function formsFromDraft(d: SetupDraft, now: Date = new Date()): WizardForms {
  const f = blankForms(indianFinancialYear(now));
  if (d.business) {
    const b = d.business;
    f.business = { legalName: b.legalName, tradeName: text(b.tradeName), pan: text(b.pan), stateCode: b.stateCode, addressLine1: text(b.addressLine1), addressLine2: text(b.addressLine2), city: text(b.city), pincode: text(b.pincode), phone: text(b.phone), email: text(b.email), startDate: b.financialYear?.startDate ?? f.business.startDate, endDate: b.financialYear?.endDate ?? f.business.endDate };
  }
  if (d.gst) f.gst = d.gst.registered ? { registered: "yes", gstin: d.gst.gstin, legalNameOnCertificate: text(d.gst.legalNameOnCertificate), scheme: d.gst.scheme, filingFrequency: d.gst.filingFrequency, turnoverBand: d.gst.turnoverBand } : { ...f.gst, registered: "no" };
  if (d.shop) f.shop = { name: d.shop.name, code: d.shop.code, tills: String(d.shop.tills) };
  if (d.sell) f.sell = { shopType: d.sell.shopType, modules: { ...noModules(), ...d.sell.modules } };
  return f;
}

/** What one step sends, before checking. */
export function stepInput(key: SetupAnswerKey, f: WizardForms): unknown {
  switch (key) {
    case "business": {
      const b = f.business;
      return { legalName: b.legalName, tradeName: blankToNull(b.tradeName), pan: blankToNull(b.pan.toUpperCase()), stateCode: b.stateCode, addressLine1: blankToNull(b.addressLine1), addressLine2: blankToNull(b.addressLine2), city: blankToNull(b.city), pincode: blankToNull(b.pincode), phone: blankToNull(b.phone), email: blankToNull(b.email), financialYear: { startDate: b.startDate, endDate: b.endDate } };
    }
    case "gst":
      if (f.gst.registered === "no") return { registered: false };
      if (f.gst.registered !== "yes") return {};
      return { registered: true, gstin: f.gst.gstin, legalNameOnCertificate: blankToNull(f.gst.legalNameOnCertificate), scheme: f.gst.scheme, filingFrequency: f.gst.filingFrequency, turnoverBand: f.gst.turnoverBand };
    case "shop":
      return { name: f.shop.name, code: f.shop.code, tills: f.shop.tills.trim() === "" ? Number.NaN : Number(f.shop.tills) };
    case "sell":
      return { shopType: f.sell.shopType || undefined, modules: f.sell.modules };
  }
}

const STEP_SCHEMAS = { business: setupBusinessSchema, gst: setupGstSchema, shop: setupShopSchema, sell: setupSellSchema } as const;

const TURNOVER_LABELS: Record<(typeof TURNOVER_BANDS)[number], string> = {
  up_to_5cr: "Up to ₹5 crore",
  "5cr_to_10cr": "Above ₹5 crore, below ₹10 crore",
  above_10cr: "₹10 crore and above",
  above_500cr: "Above ₹500 crore",
};
const SCHEME_LABELS: Record<(typeof GST_SCHEMES)[number], string> = { regular: "Regular (tax invoices with GST)", composition: "Composition scheme (bills of supply)" };
const FILING_LABELS: Record<(typeof FILING_FREQUENCIES)[number], string> = { quarterly: "Quarterly", monthly: "Monthly" };
const SHOP_ICONS: Record<ShopTypeKey, IconName> = { fancy: "tag", clothing: "ruler", footwear: "box", cosmetics: "clock", mobiles: "devices", general: "store" };
const stateName = (code: string) => INDIAN_STATE_OPTIONS.find(([c]) => c === code)?.[1] ?? code;

/** "data.gst.gstin" or "gst.gstin" → "gstin", for the step being shown. */
function stepErrors(errors: Record<string, string>, key: SetupAnswerKey): FieldErrors {
  const out: FieldErrors = {};
  for (const [path, message] of Object.entries(errors)) {
    const p = path.replace(/^data\./, "");
    if (p.startsWith(`${key}.`)) out[p.slice(key.length + 1)] ??= message;
    else if (p === key) out._ ??= message;
  }
  return out;
}

// ---- The wizard ----

export function SetupWizard() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready" | "closed">("loading");
  const [step, setStep] = useState(1);
  const [forms, setForms] = useState<WizardForms>(() => blankForms());
  const [saved, setSaved] = useState<SetupDraft>({});
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const routerRef = useRef(router);

  // Once, when the page opens: where the setup stands.
  useEffect(() => {
    const router = routerRef.current;
    let cancelled = false;
    (async () => {
      try {
        // Plan 14: the owner is logged in (signed up just now, or came back later).
        const status = await api.get<{ needed: boolean }>("/setup/status");
        if (cancelled) return;
        if (!status.needed) {
          router.replace("/dashboard");
          return;
        }
        const progress = await api.get<{ step: number; data: SetupDraft }>("/setup/progress");
        if (cancelled) return;
        setSaved(progress.data);
        const filled = formsFromDraft(progress.data);
        // Plan 14: the shop name typed at sign-up starts the legal name.
        if (!progress.data.business) {
          const company = await api.get<{ legalName: string }>("/company");
          if (cancelled) return;
          filled.business.legalName = company.legalName;
        }
        setForms(filled);
        setStep(progress.step);
        if (progress.step > 1) setResumedAt(progress.step);
        setPhase("ready");
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err));
          setPhase("closed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = SETUP_STEPS[step - 1];
  const key = current.key as SetupStepKey;

  function goTo(n: number) {
    setErrors({});
    setError(null);
    setNotice(null);
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo?.({ top: 0 });
  }

  /** Checks this step, saves the answers so far, and moves on. */
  async function next(e?: FormEvent) {
    e?.preventDefault();
    if (key === "done") return;
    setError(null);
    setNotice(null);
    const answerKey = key as SetupAnswerKey;
    const parsed = STEP_SCHEMAS[answerKey].safeParse(stepInput(answerKey, forms));
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed));
      setError(answerKey === "gst" && forms.gst.registered === "" ? "Choose whether the business has a GSTIN." : "Please correct the highlighted fields.");
      return;
    }
    const data: SetupDraft = { ...saved, [answerKey]: parsed.data };
    const whole = setupDraftSchema.safeParse(data);
    if (!whole.success) {
      setErrors(stepErrors(issuesToFieldErrors(whole), answerKey));
      setError("Please correct the highlighted fields.");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await api.put<{ step: number; data: SetupDraft }>("/setup/progress", { step: step + 1, data: whole.data });
      setSaved(res.data);
      setResumedAt(null);
      goTo(step + 1);
      setNotice("Saved. You can close the browser and carry on later.");
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(stepErrors(err.fieldErrors, answerKey));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <main className="public-page">
        <p className="muted">Checking…</p>
      </main>
    );
  }
  if (phase === "closed") {
    return (
      <main className="public-page">
        <h1>Set up your shop</h1>
        <Alert kind="error">{error ?? "Setup is not available."}</Alert>
      </main>
    );
  }

  return (
    <main className="public-page setup-page">
      <div className="public-brand">
        <BrandMark />
        Retail ERP
      </div>
      <h1>Set up your shop</h1>
      <StepTracker step={step} saved={saved} onJump={goTo} />
      {resumedAt ? <Alert kind="info">Welcome back. Your earlier answers were kept, so you carry on from step {resumedAt}.</Alert> : null}
      <Alert kind="success">{notice}</Alert>

      <section className="card setup-step" aria-labelledby="setup-step-title">
        <p className="setup-step-count">
          Step {step} of {SETUP_STEPS.length}
        </p>
        <h2 id="setup-step-title">{current.title}</h2>
        <p className="muted">{current.lead}</p>

        {key === "done" ? (
          <DoneStep saved={saved} onChange={goTo} onFinished={() => router.replace("/dashboard")} />
        ) : (
          <form onSubmit={(e) => void next(e)} noValidate>
            <Alert kind="error">{error}</Alert>
            {key === "business" ? <BusinessStep forms={forms} setForms={setForms} errors={errors} /> : null}
            {key === "gst" ? <GstStep forms={forms} setForms={setForms} errors={errors} /> : null}
            {key === "shop" ? <ShopStep forms={forms} setForms={setForms} errors={errors} /> : null}
            {key === "sell" ? <SellStep forms={forms} setForms={setForms} errors={errors} /> : null}
            <div className="actions setup-actions">
              {step > 1 ? (
                <Button onClick={() => goTo(step - 1)} disabled={busy}>
                  Back
                </Button>
              ) : null}
              <Button type="submit" variant="primary" busy={busy}>
                Next
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

/** The steps; a step already saved can be opened again. */
function StepTracker({ step, saved, onJump }: { step: number; saved: SetupDraft; onJump: (n: number) => void }) {
  return (
    <ol className="setup-tracker" aria-label="Setup steps">
      {SETUP_STEPS.map((s, i) => {
        const n = i + 1;
        const done = s.key !== "done" && !!saved[s.key as SetupAnswerKey];
        const reachable = n <= step || done;
        const state = n === step ? "current" : done ? "done" : "todo";
        return (
          <li key={s.key} className={`setup-tracker-step is-${state}`} aria-current={n === step ? "step" : undefined}>
            {reachable && n !== step ? (
              <button type="button" className="setup-tracker-button" onClick={() => onJump(n)}>
                <span className="setup-tracker-dot" aria-hidden="true">
                  {done ? "✓" : n}
                </span>
                <span className="setup-tracker-label">{s.title}</span>
              </button>
            ) : (
              <span className="setup-tracker-button">
                <span className="setup-tracker-dot" aria-hidden="true">
                  {n}
                </span>
                <span className="setup-tracker-label">{s.title}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface StepProps {
  forms: WizardForms;
  setForms: (update: (f: WizardForms) => WizardForms) => void;
  errors: FieldErrors;
}

function BusinessStep({ forms, setForms, errors }: StepProps) {
  const b = forms.business;
  const set = (k: keyof WizardForms["business"]) => (e: { target: { value: string } }) => setForms((f) => ({ ...f, business: { ...f.business, [k]: e.target.value } }));
  return (
    <>
      <div className="form-grid">
        <TextInput id="biz-legalName" label="Legal name" value={b.legalName} onChange={set("legalName")} error={errors.legalName} required hint="As on your PAN or GST certificate." />
        <TextInput id="biz-tradeName" label="Shop name on bills" value={b.tradeName} onChange={set("tradeName")} error={errors.tradeName} hint="If different from the legal name." />
        <TextInput id="biz-pan" label="PAN" value={b.pan} onChange={set("pan")} error={errors.pan} hint="Optional. 10 letters and digits." autoCapitalize="characters" />
        <SelectInput id="biz-state" label="State" value={b.stateCode} onChange={set("stateCode")} error={errors.stateCode} required>
          <option value="">Select a state…</option>
          {INDIAN_STATE_OPTIONS.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="biz-city" label="City or town" value={b.city} onChange={set("city")} error={errors.city} />
        <TextInput id="biz-address1" label="Address" value={b.addressLine1} onChange={set("addressLine1")} error={errors.addressLine1} />
        <TextInput id="biz-address2" label="Address (second line)" value={b.addressLine2} onChange={set("addressLine2")} error={errors.addressLine2} />
        <TextInput id="biz-pincode" label="PIN code" value={b.pincode} onChange={set("pincode")} error={errors.pincode} inputMode="numeric" />
        <TextInput id="biz-phone" label="Phone" value={b.phone} onChange={set("phone")} error={errors.phone} type="tel" />
        <TextInput id="biz-email" label="Business email" type="email" value={b.email} onChange={set("email")} error={errors.email} />
      </div>
      <fieldset className="setup-subtle">
        <legend>First financial year</legend>
        <p className="field-hint">Usually 1 April to 31 March. Change it only if your accountant asks.</p>
        <div className="form-grid">
          <TextInput id="biz-fyStart" label="Starts on" type="date" value={b.startDate} onChange={set("startDate")} error={errors["financialYear.startDate"]} />
          <TextInput id="biz-fyEnd" label="Ends on" type="date" value={b.endDate} onChange={set("endDate")} error={errors["financialYear.endDate"] ?? errors.financialYear} />
        </div>
      </fieldset>
    </>
  );
}

function GstStep({ forms, setForms, errors }: StepProps) {
  const g = forms.gst;
  const set = (patch: Partial<WizardForms["gst"]>) => setForms((f) => ({ ...f, gst: { ...f.gst, ...patch } }));
  const [checked, setChecked] = useState<string | null>(null);
  const live = g.gstin.trim().length >= 15 ? gstinProblem(g.gstin, isStateCode) : null;
  const gstinState = g.gstin.trim().length >= 2 && isStateCode(g.gstin.trim().slice(0, 2)) ? g.gstin.trim().slice(0, 2) : null;
  const otherState = gstinState && forms.business.stateCode && gstinState !== forms.business.stateCode ? gstinState : null;
  return (
    <>
      <div className="check-row" role="radiogroup" aria-label="GST registration">
        <RadioInput id="gst-yes" name="gst-registered" label="Yes, the business has a GSTIN" checked={g.registered === "yes"} onChange={() => set({ registered: "yes" })} />
        <RadioInput id="gst-no" name="gst-registered" label="Not registered yet" description="Bills are made without GST. Add the GSTIN later on the Company page." checked={g.registered === "no"} onChange={() => set({ registered: "no" })} />
      </div>
      {g.registered === "yes" ? (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <TextInput
            id="gst-gstin"
            label="GSTIN"
            value={g.gstin}
            onChange={(e) => {
              set({ gstin: e.target.value.toUpperCase() });
              setChecked(null);
            }}
            onBlur={() => setChecked(g.gstin.trim() ? (gstinProblem(g.gstin, isStateCode) ?? "ok") : null)}
            error={errors.gstin ?? (checked && checked !== "ok" ? checked : live)}
            hint={checked === "ok" || (!live && g.gstin.trim().length === 15) ? "Looks right. Your accountant confirms it on the GST portal." : "15 letters and digits, e.g. 33ABCDE1234F1Z5. We check its last character for typing mistakes."}
            required
            autoCapitalize="characters"
            className="mono"
          />
          <TextInput id="gst-legalName" label="Legal name on the certificate" value={g.legalNameOnCertificate} onChange={(e) => set({ legalNameOnCertificate: e.target.value })} error={errors.legalNameOnCertificate} hint="Optional." />
          <SelectInput
            id="gst-scheme"
            label="GST scheme"
            value={g.scheme}
            error={errors.scheme}
            onChange={(e) => set({ scheme: e.target.value, ...(e.target.value === "composition" ? { filingFrequency: "quarterly", turnoverBand: "up_to_5cr" } : {}) })}
            hint="Composition: bills of supply without GST, and no input credit."
          >
            {GST_SCHEMES.map((s) => (
              <option key={s} value={s}>
                {SCHEME_LABELS[s]}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            id="gst-turnover"
            label="Turnover last year (all GSTINs of your PAN)"
            value={g.turnoverBand}
            error={errors.turnoverBand}
            onChange={(e) => set({ turnoverBand: e.target.value, ...(e.target.value !== "up_to_5cr" ? { filingFrequency: "monthly" } : {}) })}
          >
            {TURNOVER_BANDS.map((t) => (
              <option key={t} value={t} disabled={g.scheme === "composition" && t !== "up_to_5cr"}>
                {TURNOVER_LABELS[t]}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="gst-filing" label="Returns filed" value={g.filingFrequency} error={errors.filingFrequency} onChange={(e) => set({ filingFrequency: e.target.value })} disabled={g.scheme === "composition"} hint="Quarterly is only for a turnover up to ₹5 crore.">
            {FILING_FREQUENCIES.map((x) => (
              <option key={x} value={x} disabled={x === "quarterly" && g.turnoverBand !== "up_to_5cr"}>
                {FILING_LABELS[x]}
              </option>
            ))}
          </SelectInput>
        </div>
      ) : null}
      {otherState ? <Alert kind="info">This GSTIN is registered in {stateName(otherState)}; your first shop will bill under it.</Alert> : null}
      {g.registered === "yes" && g.turnoverBand !== "up_to_5cr" ? <Alert kind="info">Above ₹5 crore, business invoices must be registered on the e-invoice portal; e-invoicing will be switched on.</Alert> : null}
    </>
  );
}

function ShopStep({ forms, setForms, errors }: StepProps) {
  const s = forms.shop;
  const set = (k: keyof WizardForms["shop"]) => (e: { target: { value: string } }) => setForms((f) => ({ ...f, shop: { ...f.shop, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value } }));
  const tills = Number(s.tills);
  return (
    <div className="form-grid">
      <TextInput id="shop-name" label="Shop name" value={s.name} onChange={set("name")} error={errors.name} required hint="For example the area it is in: Anna Nagar." />
      <TextInput id="shop-code" label="Short code" value={s.code} onChange={set("code")} error={errors.code} required hint="2–10 letters or digits, e.g. MAIN. Used in document numbers." autoCapitalize="characters" />
      <TextInput
        id="shop-tills"
        label="How many billing counters (tills)?"
        type="number"
        min={0}
        max={20}
        inputMode="numeric"
        value={s.tills}
        onChange={set("tills")}
        error={errors.tills}
        hint={Number.isInteger(tills) && tills > 0 ? `${setupTills(tills).map((t) => t.name).join(", ")} — each takes cash, card and UPI.` : "You can add tills later too."}
      />
    </div>
  );
}

function SellStep({ forms, setForms, errors }: StepProps) {
  const sell = forms.sell;
  const [note, setNote] = useState<string | null>(null);

  function pick(type: ShopTypeKey) {
    setNote(null);
    setForms((f) => ({ ...f, sell: { shopType: type, modules: suggestedModules(type, f.gst.registered === "yes" ? f.gst.turnoverBand : null) } }));
  }

  function tick(key: ModuleKey, on: boolean) {
    const m = { ...sell.modules };
    if (on) {
      const extra = withNeeds(key).filter((k) => k !== key && !m[k]);
      for (const k of withNeeds(key)) m[k] = true;
      setNote(extra.length ? `${OPTIONAL_MODULES[key].label} needs ${extra.map((k) => OPTIONAL_MODULES[k].label).join(" and ")}, so that is switched on too.` : null);
    } else {
      const dependants = neededBy(key).filter((k) => m[k]);
      m[key] = false;
      for (const k of dependants) m[k] = false;
      setNote(dependants.length ? `${dependants.map((k) => OPTIONAL_MODULES[k].label).join(" and ")} cannot work without ${OPTIONAL_MODULES[key].label}, so that is switched off too.` : null);
    }
    setForms((f) => ({ ...f, sell: { ...f.sell, modules: m } }));
  }

  return (
    <>
      {/*
        Plan 12 §6 (built later, after the rest): the optional "Describe your shop" helper goes here,
        above the cards. Off unless the owner switches it on; it sends only the owner's sentence to the
        AI service and returns a suggested shop type and modules that the owner confirms with these
        same cards and ticks — it never changes anything by itself.
      */}
      <fieldset className="setup-subtle">
        <legend>Kind of shop</legend>
        {errors.shopType ? (
          <p className="field-error" role="alert">
            Choose the kind of shop.
          </p>
        ) : null}
        <div className="shop-types" role="radiogroup" aria-label="Kind of shop">
          {SHOP_TYPE_KEYS.map((t) => {
            const chosen = sell.shopType === t;
            return (
              <button key={t} type="button" role="radio" aria-checked={chosen} className={`shop-type${chosen ? " is-chosen" : ""}`} onClick={() => pick(t)}>
                <span className="shop-type-icon" aria-hidden="true">
                  <Icon name={SHOP_ICONS[t]} size={22} />
                </span>
                <span className="shop-type-text">
                  <strong>{SHOP_TYPES[t].label}</strong>
                  <span>{SHOP_TYPES[t].description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {sell.shopType ? (
        <fieldset className="setup-subtle">
          <legend>What to switch on</legend>
          <p className="field-hint">Ticked for a {SHOP_TYPES[sell.shopType].label.toLowerCase()} shop. Change any tick; you can switch modules on or off later under Settings, and nothing is ever deleted.</p>
          <Alert kind="info">{note}</Alert>
          <div className="check-list setup-modules">
            {MODULE_KEYS.map((k) => (
              <CheckInput key={k} id={`mod-${k}`} label={OPTIONAL_MODULES[k].label} description={OPTIONAL_MODULES[k].description} checked={!!sell.modules[k]} onChange={(e) => tick(k, e.target.checked)} />
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

// ---- Last step: summary and finish ----

function Summary({ title, step, onChange, children }: { title: string; step: number; onChange: (n: number) => void; children: ReactNode }) {
  return (
    <div className="setup-summary-block">
      <div className="toolbar" style={{ margin: 0 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="spacer" />
        <Button variant="link" size="small" onClick={() => onChange(step)} aria-label={`Change ${title.toLowerCase()}`}>
          Change
        </Button>
      </div>
      <dl className="kv">{children}</dl>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: ReactNode }) =>
  value === null || value === undefined || value === "" ? null : (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );

function DoneStep({ saved, onChange, onFinished }: { saved: SetupDraft; onChange: (n: number) => void; onFinished: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = SETUP_STEPS.findIndex((s) => s.key !== "done" && !saved[s.key as SetupAnswerKey]);
  const year = saved.business?.financialYear ?? indianFinancialYear();
  const on = useMemo(() => (saved.sell ? MODULE_KEYS.filter((k) => saved.sell!.modules[k]) : []), [saved.sell]);

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/setup/finish", {});
      onFinished();
    } catch (err) {
      const step = err instanceof ApiError && err.body && typeof err.body === "object" && "step" in err.body ? Number((err.body as { step: unknown }).step) : null;
      setError(errorMessage(err));
      if (step && step < SETUP_STEPS.length) onChange(step);
      setBusy(false);
    }
  }

  if (missing >= 0) {
    return (
      <Alert kind="error">
        Step {missing + 1}, “{SETUP_STEPS[missing].title}”, is not finished yet.{" "}
        <Button variant="link" onClick={() => onChange(missing + 1)}>
          Go to step {missing + 1}
        </Button>
      </Alert>
    );
  }
  const b = saved.business!;
  const g = saved.gst!;
  const shop = saved.shop!;
  const sell = saved.sell!;

  return (
    <>
      <div className="setup-summary">
        <Summary title="Your business" step={1} onChange={onChange}>
          <Row label="Legal name" value={b.legalName} />
          <Row label="Name on bills" value={b.tradeName} />
          <Row label="PAN" value={b.pan} />
          <Row label="State" value={stateName(b.stateCode)} />
          <Row label="Address" value={[b.addressLine1, b.addressLine2, b.city, b.pincode].filter(Boolean).join(", ")} />
          <Row label="Financial year" value={`${formatDate(year.startDate)} to ${formatDate(year.endDate)}`} />
        </Summary>
        <Summary title="GST" step={2} onChange={onChange}>
          {g.registered ? (
            <>
              <Row label="GSTIN" value={<span className="mono">{g.gstin}</span>} />
              <Row label="Scheme" value={SCHEME_LABELS[g.scheme]} />
              <Row label="Returns" value={FILING_LABELS[g.filingFrequency]} />
              <Row label="Turnover" value={TURNOVER_LABELS[g.turnoverBand]} />
            </>
          ) : (
            <Row label="Registration" value="Not registered yet" />
          )}
        </Summary>
        <Summary title="Your first shop" step={3} onChange={onChange}>
          <Row label="Shop" value={`${shop.name} (${shop.code})`} />
          <Row label="Tills" value={shop.tills === 0 ? "None yet" : `${setupTills(shop.tills).map((t) => t.name).join(", ")}, each taking cash, card and UPI`} />
        </Summary>
        <Summary title="What you sell" step={4} onChange={onChange}>
          <Row label="Kind of shop" value={SHOP_TYPES[sell.shopType].label} />
          <Row label="Switched on" value={on.length ? on.map((k) => OPTIONAL_MODULES[k].label).join(", ") : "Only the core: billing, stock, accounts and GST"} />
        </Summary>
      </div>

      <form onSubmit={(e) => void finish(e)} noValidate>
        <Alert kind="error">{error}</Alert>
        <div className="actions setup-actions">
          <Button onClick={() => onChange(SETUP_STEPS.length - 1)} disabled={busy}>
            Back
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Finish setup
          </Button>
        </div>
      </form>

      <div className="setup-next">
        <h3>After this</h3>
        <p className="muted">Your dashboard shows these next steps and ticks each one off as you do it:</p>
        <ol>
          {GETTING_STARTED_STEPS.map((s) => (
            <li key={s.key}>{s.label}</li>
          ))}
        </ol>
      </div>
    </>
  );
}
