// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { setItemUnitsSchema } from "shared";
import { BarcodeDialog } from "@/components/items/barcode-dialog";
import { ActiveBadge, Alert, Badge, Button, DataTable, Field, SelectInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { BarcodeDto, ItemDto, UnitDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface UnitRow {
  unitId: string;
  code: string;
  name: string;
  factor: string;
  mrp: string;
}

function rowsFrom(item: ItemDto): UnitRow[] {
  return item.units.map((u) => ({ unitId: u.unitId, code: u.code, name: u.name, factor: u.factor, mrp: u.mrp ?? "" }));
}

interface ItemUnitsBarcodesProps {
  item: ItemDto;
  units: UnitDto[];
  readOnly: boolean;
  onChanged: (item: ItemDto) => void;
}

/** Units & barcodes tab: the item's pack units (saved as a whole list) and its barcodes. */
export function ItemUnitsBarcodes({ item, units, readOnly, onChanged }: ItemUnitsBarcodesProps) {
  const [rows, setRows] = useState<UnitRow[]>(() => rowsFrom(item));
  const [addUnitId, setAddUnitId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitsSaved, setUnitsSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const baseId = item.baseUnit.id;
  const available = units.filter((u) => u.active && !rows.some((r) => r.unitId === u.id));

  function addUnit() {
    const unit = units.find((u) => u.id === addUnitId);
    if (!unit) return;
    setRows((r) => [...r, { unitId: unit.id, code: unit.code, name: unit.name, factor: "", mrp: "" }]);
    setAddUnitId("");
    setUnitsSaved(false);
  }

  function updateRow(unitId: string, patch: Partial<UnitRow>) {
    setRows((r) => r.map((row) => (row.unitId === unitId ? { ...row, ...patch } : row)));
    setUnitsSaved(false);
  }

  async function saveUnits() {
    setUnitsError(null);
    setUnitsSaved(false);
    const parsed = setItemUnitsSchema.safeParse({
      units: rows.map((r) => ({ unitId: r.unitId, factor: r.unitId === baseId ? "1" : r.factor.trim(), mrp: blankToNull(r.mrp) })),
    });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = await api.put<ItemDto>(`/items/${item.id}/units`, parsed.data);
      setRows(rowsFrom(saved));
      setUnitsSaved(true);
      onChanged(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setUnitsError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reloadItem() {
    const fresh = await api.get<ItemDto>(`/items/${item.id}`);
    onChanged(fresh);
  }

  async function switchBarcode(b: BarcodeDto, active: boolean) {
    setBarcodeError(null);
    try {
      await api.patch(`/items/${item.id}/barcodes/${b.id}`, { active });
      await reloadItem();
    } catch (err) {
      setBarcodeError(errorMessage(err));
    }
  }

  const barcodeColumns: Column<BarcodeDto>[] = [
    { key: "code", header: "Barcode", render: (b) => <span className="mono">{b.code}</span> },
    { key: "type", header: "Type", render: (b) => (b.type === "other" ? "Other" : b.type) },
    { key: "unit", header: "Unit", render: (b) => b.unit?.code ?? <span className="muted">basic ({item.baseUnit.code})</span> },
    { key: "active", header: "Status", render: (b) => <ActiveBadge active={b.active} /> },
    ...(readOnly
      ? []
      : [
          {
            key: "actions",
            header: "",
            render: (b: BarcodeDto) =>
              b.active ? (
                <Button size="small" variant="danger" onClick={() => switchBarcode(b, false)}>
                  Switch off
                </Button>
              ) : (
                <Button size="small" onClick={() => switchBarcode(b, true)}>
                  Switch on
                </Button>
              ),
          } satisfies Column<BarcodeDto>,
        ]),
  ];

  return (
    <>
      <h2>Units</h2>
      <p className="muted">
        The basic unit ({item.baseUnit.code}) always has factor 1. Other units say how many basic units they hold: a box of 12 has factor 12.
      </p>
      <Alert kind="error">{unitsError}</Alert>
      {unitsSaved ? <Alert kind="success">Units saved.</Alert> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col" className="num">
                Basic units per unit
              </th>
              <th scope="col" className="num">
                MRP for this pack
              </th>
              {!readOnly ? <th scope="col"></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => {
              const isBase = r.unitId === baseId;
              return (
                <tr key={r.unitId}>
                  <td>
                    {r.code} — {r.name}
                    {isBase ? <Badge kind="neutral">basic</Badge> : null}
                  </td>
                  <td className="num">
                    {isBase ? (
                      <span className="mono">1</span>
                    ) : (
                      <Field id={`unit-factor-${r.unitId}`} label={<span className="sr-only">Factor for {r.code}</span>} error={errors[`units.${index}.factor`]}>
                        <input id={`unit-factor-${r.unitId}`} className="input mono" inputMode="decimal" value={r.factor} disabled={readOnly} onChange={(e) => updateRow(r.unitId, { factor: e.target.value })} />
                      </Field>
                    )}
                  </td>
                  <td className="num">
                    <Field id={`unit-mrp-${r.unitId}`} label={<span className="sr-only">MRP for {r.code}</span>} error={errors[`units.${index}.mrp`]}>
                      <input id={`unit-mrp-${r.unitId}`} className="input mono" inputMode="decimal" value={r.mrp} disabled={readOnly} placeholder={isBase ? (item.mrp ?? "") : ""} onChange={(e) => updateRow(r.unitId, { mrp: e.target.value })} />
                    </Field>
                  </td>
                  {!readOnly ? (
                    <td>
                      {!isBase ? (
                        <Button size="small" variant="danger" onClick={() => setRows((rs) => rs.filter((x) => x.unitId !== r.unitId))}>
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div className="toolbar">
          <SelectInput id="unit-add" label="Add unit" value={addUnitId} onChange={(e) => setAddUnitId(e.target.value)}>
            <option value="">Choose a unit</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </SelectInput>
          <Button onClick={addUnit} disabled={!addUnitId}>
            Add
          </Button>
          <span className="spacer" />
          <Button variant="primary" busy={busy} onClick={saveUnits}>
            Save units
          </Button>
        </div>
      ) : null}

      <h2>Barcodes</h2>
      <p className="muted">Each barcode is unique across the catalogue. A barcode tied to a unit sells that pack when scanned.</p>
      <Alert kind="error">{barcodeError}</Alert>
      <DataTable columns={barcodeColumns} rows={item.barcodes} rowKey={(b) => b.id} empty="No barcodes yet." />
      {!readOnly ? (
        <div className="actions" style={{ marginTop: 0 }}>
          <Button variant="primary" onClick={() => setBarcodeOpen(true)}>
            Add barcode
          </Button>
        </div>
      ) : null}
      <BarcodeDialog item={item} open={barcodeOpen} onClose={() => setBarcodeOpen(false)} onSaved={reloadItem} />
    </>
  );
}
