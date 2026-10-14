// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { BARCODE_TYPES, barcodeProblem, type BarcodeType, createBarcodeSchema, guessBarcodeType } from "shared";
import { Alert, Button, Dialog, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { ItemDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface BarcodeDialogProps {
  item: ItemDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/** Adds a barcode to an item. The type is guessed from the code; check digits are tested before sending. */
export function BarcodeDialog({ item, open, onClose, onSaved }: BarcodeDialogProps) {
  const [code, setCode] = useState("");
  const [type, setType] = useState<BarcodeType>("other");
  const [typeChosen, setTypeChosen] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onCodeChange(value: string) {
    const trimmed = value.trim();
    setCode(trimmed);
    if (!typeChosen) setType(guessBarcodeType(trimmed));
  }

  function close() {
    setCode("");
    setType("other");
    setTypeChosen(false);
    setUnitId("");
    setErrors({});
    setError(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = barcodeProblem(code, type);
    if (problem) {
      setErrors({ code: problem });
      return;
    }
    const parsed = createBarcodeSchema.safeParse({ code, type, unitId: unitId || null });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post(`/items/${item.id}/barcodes`, parsed.data);
      await onSaved();
      close();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={`Add barcode to ${item.code}`} onClose={close}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <TextInput id="barcode-code" label="Barcode" value={code} onChange={(e) => onCodeChange(e.target.value)} error={errors.code} required autoComplete="off" className="mono" hint="Scan it or type it. EAN-13, EAN-8 and UPC-A check digits are verified." />
        <SelectInput
          id="barcode-type"
          label="Type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as BarcodeType);
            setTypeChosen(true);
          }}
          error={errors.type}
          hint={typeChosen ? undefined : "Guessed from the code; change it if the scanner says otherwise."}
        >
          {BARCODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === "other" ? "Other" : t}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="barcode-unit" label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} error={errors.unitId} hint="A carton barcode stands for the carton unit; leave empty for the basic unit.">
          <option value="">Basic unit ({item.baseUnit.code})</option>
          {item.units
            .filter((u) => u.unitId !== item.baseUnit.id)
            .map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {u.code} — {u.name} (× {u.factor})
              </option>
            ))}
        </SelectInput>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Add barcode
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
