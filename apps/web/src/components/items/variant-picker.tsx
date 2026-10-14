// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { type AttributeValueChoice, combinationCount, createVariantsSchema, MAX_VARIANTS_PER_REQUEST, variantCombinations } from "shared";
import { Alert, Button, CheckInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AttributeDto, CreatedVariants, ItemDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface VariantPickerProps {
  /** The parent style. */
  item: ItemDto;
  /** The attributes the style varies by, with their values. */
  attributes: AttributeDto[];
  onCreated: (result: CreatedVariants) => Promise<void> | void;
}

/** Numeric attribute values typed as "38, 40, 42" → ["38", "40", "42"]. */
function splitNumbers(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** Short code for a numeric value: the number itself (dots allowed by the API's rule). */
function numericShortCode(value: string): string {
  return value.toUpperCase();
}

/** Tick values per attribute, see the combination count live, then create the variants. */
export function VariantPicker({ item, attributes, onCreated }: VariantPickerProps) {
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [numeric, setNumeric] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedVariants | null>(null);
  const [busy, setBusy] = useState(false);

  const ordered = item.variantAttributes.map((ref) => attributes.find((a) => a.id === ref.id) ?? null);

  const choices: AttributeValueChoice[] = ordered.map((a, i) => {
    const attributeId = a?.id ?? item.variantAttributes[i].id;
    if (!a || a.kind === "numeric") {
      return { attributeId, values: splitNumbers(numeric[attributeId] ?? "").map((v) => ({ value: v, shortCode: numericShortCode(v) })) };
    }
    const chosen = ticked[attributeId] ?? [];
    return { attributeId, values: a.values.filter((v) => chosen.includes(v.value)).map((v) => ({ value: v.value, shortCode: v.shortCode })) };
  });
  const complete = choices.length > 0 && choices.every((c) => c.values.length > 0);
  const count = complete ? combinationCount(choices) : 0;

  let preview: string[] = [];
  let previewProblem: string | null = null;
  if (complete) {
    try {
      preview = variantCombinations(item.code, item.name, choices)
        .slice(0, 6)
        .map((c) => c.code);
    } catch (err) {
      previewProblem = errorMessage(err);
    }
  }

  function toggle(attributeId: string, value: string, on: boolean) {
    setTicked((t) => {
      const current = t[attributeId] ?? [];
      return { ...t, [attributeId]: on ? [...new Set([...current, value])] : current.filter((v) => v !== value) };
    });
    setResult(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!complete) {
      setErrors({ values: "Tick at least one value for every attribute" });
      return;
    }
    if (count > MAX_VARIANTS_PER_REQUEST) {
      setErrors({ values: `${count} combinations is more than the limit of ${MAX_VARIANTS_PER_REQUEST} at a time` });
      return;
    }
    const parsed = createVariantsSchema.safeParse({ values: Object.fromEntries(choices.map((c) => [c.attributeId, c.values.map((v) => v.value)])) });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const created = await api.post<CreatedVariants>(`/items/${item.id}/variants`, parsed.data);
      setResult(created);
      await onCreated(created);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card">
      <h3 style={{ marginTop: 0 }}>Create variants</h3>
      <Alert kind="error">{error}</Alert>
      {result ? (
        <Alert kind="success">
          {result.created.length} variant{result.created.length === 1 ? "" : "s"} created
          {result.skippedExisting > 0 ? `, ${result.skippedExisting} already existed and ${result.skippedExisting === 1 ? "was" : "were"} skipped` : ""}.
        </Alert>
      ) : null}
      {errors.values ? <p className="field-error">{errors.values}</p> : null}
      {ordered.map((a, i) => {
        const ref = item.variantAttributes[i];
        if (!a) {
          return (
            <p key={ref.id} className="muted">
              Attribute {ref.name} could not be loaded.
            </p>
          );
        }
        if (a.kind === "numeric") {
          return (
            <TextInput
              key={a.id}
              id={`variant-num-${a.id}`}
              label={a.name}
              value={numeric[a.id] ?? ""}
              onChange={(e) => {
                setNumeric((n) => ({ ...n, [a.id]: e.target.value }));
                setResult(null);
              }}
              hint={`Numbers separated by commas, between ${a.rangeStart ?? "?"} and ${a.rangeEnd ?? "?"} in steps of ${a.rangeStep ?? "?"}.`}
              className="mono"
            />
          );
        }
        return (
          <fieldset key={a.id}>
            <legend>{a.name}</legend>
            <div className="check-row">
              {a.values.length === 0 ? <p className="muted">This attribute has no values yet.</p> : null}
              {a.values.map((v) => (
                <CheckInput key={v.id} id={`variant-${a.id}-${v.id}`} label={`${v.value} (${v.shortCode})`} checked={(ticked[a.id] ?? []).includes(v.value)} onChange={(e) => toggle(a.id, v.value, e.target.checked)} />
              ))}
            </div>
          </fieldset>
        );
      })}
      <p aria-live="polite">
        <strong>{count} combination{count === 1 ? "" : "s"}</strong>
        {preview.length > 0 ? (
          <span className="muted">
            {" "}
            — for example {preview.join(", ")}
            {count > preview.length ? ", …" : ""}
          </span>
        ) : null}
        {previewProblem ? <span className="field-error"> {previewProblem}</span> : null}
      </p>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!complete || count > MAX_VARIANTS_PER_REQUEST}>
          Create variants
        </Button>
      </div>
    </form>
  );
}
