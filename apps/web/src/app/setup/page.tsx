// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { INDIAN_STATE_OPTIONS, type SetupInput, setupSchema } from "shared";
import { Alert, Button, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull, blankToUndefined, financialYearFor } from "@/lib/format";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

const defaultYear = financialYearFor(new Date());

const initial = {
  firstName: "",
  lastName: "",
  adminEmail: "",
  password: "",
  confirmPassword: "",
  legalName: "",
  tradeName: "",
  code: "",
  pan: "",
  stateCode: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  pincode: "",
  phone: "",
  companyEmail: "",
  gstin: "",
  legalNameOnCertificate: "",
  startDate: defaultYear.startDate,
  endDate: defaultYear.endDate,
  storeCode: "",
  storeName: "",
};

type Form = typeof initial;

function toPayload(f: Form): SetupInput {
  return {
    admin: {
      firstName: f.firstName,
      lastName: blankToNull(f.lastName),
      email: f.adminEmail,
      password: f.password,
    },
    company: {
      legalName: f.legalName,
      tradeName: blankToNull(f.tradeName),
      code: blankToUndefined(f.code),
      pan: blankToNull(f.pan),
      stateCode: f.stateCode,
      addressLine1: blankToNull(f.addressLine1),
      addressLine2: blankToNull(f.addressLine2),
      city: blankToNull(f.city),
      pincode: blankToNull(f.pincode),
      phone: blankToNull(f.phone),
      email: blankToNull(f.companyEmail),
    },
    gstRegistration: f.gstin.trim()
      ? { gstin: f.gstin, legalNameOnCertificate: blankToNull(f.legalNameOnCertificate) }
      : null,
    financialYear: { startDate: f.startDate, endDate: f.endDate },
    store: { code: f.storeCode, name: f.storeName },
  };
}

export default function SetupPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ needed: boolean }>("/setup/status", { redirectOnUnauthorized: false })
      .then((s) => {
        if (cancelled) return;
        if (!s.needed) router.replace("/login");
        else setAllowed(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAllowed(false);
          setError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function set<K extends keyof Form>(key: K) {
    return (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = setupSchema.safeParse(toPayload(form));
    const issues = issuesToFieldErrors(parsed);
    if (form.password !== form.confirmPassword) issues["admin.confirmPassword"] = "Passwords do not match";
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) {
      setError("Please correct the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/setup", parsed.data, { redirectOnUnauthorized: false });
      router.replace("/login?setup=done");
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (allowed === null) {
    return (
      <main className="public-page">
        <p className="muted">Checking…</p>
      </main>
    );
  }

  if (allowed === false) {
    return (
      <main className="public-page">
        <h1>First-run setup</h1>
        <Alert kind="error">{error ?? "Setup is not available."}</Alert>
      </main>
    );
  }

  return (
    <main className="public-page">
      <h1>First-run setup</h1>
      <p className="muted">
        Create the owner account, the company, its GST registration, the first financial year and the first store.
        This screen is available only once.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <Alert kind="error">{error}</Alert>

        <fieldset>
          <legend>Owner account</legend>
          <div className="form-grid">
            <TextInput id="firstName" label="First name" value={form.firstName} onChange={set("firstName")} error={errors["admin.firstName"]} required autoComplete="given-name" />
            <TextInput id="lastName" label="Last name" value={form.lastName} onChange={set("lastName")} error={errors["admin.lastName"]} autoComplete="family-name" />
            <TextInput id="adminEmail" label="Email" type="email" value={form.adminEmail} onChange={set("adminEmail")} error={errors["admin.email"]} required autoComplete="username" />
            <div />
            <TextInput id="password" label="Password" type="password" value={form.password} onChange={set("password")} error={errors["admin.password"]} required autoComplete="new-password" hint="At least 10 characters." />
            <TextInput id="confirmPassword" label="Confirm password" type="password" value={form.confirmPassword} onChange={set("confirmPassword")} error={errors["admin.confirmPassword"]} required autoComplete="new-password" />
          </div>
        </fieldset>

        <fieldset>
          <legend>Company</legend>
          <div className="form-grid">
            <TextInput id="legalName" label="Legal name" value={form.legalName} onChange={set("legalName")} error={errors["company.legalName"]} required className="span-2" />
            <TextInput id="tradeName" label="Trade name" value={form.tradeName} onChange={set("tradeName")} error={errors["company.tradeName"]} hint="Shown on bills if different from the legal name." />
            <TextInput id="code" label="Short code" value={form.code} onChange={set("code")} error={errors["company.code"]} hint="Optional; made from the initials if left blank." />
            <TextInput id="pan" label="PAN" value={form.pan} onChange={set("pan")} error={errors["company.pan"]} hint="Optional." />
            <SelectInput id="stateCode" label="State" value={form.stateCode} onChange={set("stateCode")} error={errors["company.stateCode"]} required>
              <option value="">Select a state…</option>
              {INDIAN_STATE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </SelectInput>
            <TextInput id="addressLine1" label="Address line 1" value={form.addressLine1} onChange={set("addressLine1")} error={errors["company.addressLine1"]} />
            <TextInput id="addressLine2" label="Address line 2" value={form.addressLine2} onChange={set("addressLine2")} error={errors["company.addressLine2"]} />
            <TextInput id="city" label="City" value={form.city} onChange={set("city")} error={errors["company.city"]} />
            <TextInput id="pincode" label="PIN code" value={form.pincode} onChange={set("pincode")} error={errors["company.pincode"]} inputMode="numeric" />
            <TextInput id="phone" label="Phone" value={form.phone} onChange={set("phone")} error={errors["company.phone"]} type="tel" />
            <TextInput id="companyEmail" label="Company email" type="email" value={form.companyEmail} onChange={set("companyEmail")} error={errors["company.email"]} />
          </div>
        </fieldset>

        <fieldset>
          <legend>GST registration (optional)</legend>
          <div className="form-grid">
            <TextInput id="gstin" label="GSTIN" value={form.gstin} onChange={set("gstin")} error={errors["gstRegistration.gstin"] ?? errors["gstRegistration"]} hint="Leave blank if the business is not GST-registered yet." />
            <TextInput id="legalNameOnCertificate" label="Legal name on certificate" value={form.legalNameOnCertificate} onChange={set("legalNameOnCertificate")} error={errors["gstRegistration.legalNameOnCertificate"]} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Financial year</legend>
          <div className="form-grid">
            <TextInput id="startDate" label="Starts on" type="date" value={form.startDate} onChange={set("startDate")} error={errors["financialYear.startDate"]} required />
            <TextInput id="endDate" label="Ends on" type="date" value={form.endDate} onChange={set("endDate")} error={errors["financialYear.endDate"]} required />
          </div>
        </fieldset>

        <fieldset>
          <legend>First store</legend>
          <div className="form-grid">
            <TextInput id="storeCode" label="Store code" value={form.storeCode} onChange={set("storeCode")} error={errors["store.code"]} required hint="2–10 letters or digits, e.g. MAIN." />
            <TextInput id="storeName" label="Store name" value={form.storeName} onChange={set("storeName")} error={errors["store.name"]} required />
          </div>
        </fieldset>

        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Complete setup
          </Button>
        </div>
      </form>
    </main>
  );
}
