// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C2 (owner decision of 16 October 2026): buying a style by size and
// colour. Pick a style, type quantities in a grid (its last attribute across,
// usually sizes; the other down, usually colours), and one line per variant
// with a quantity is added to the document. Screen only: the lines are the
// same as lines added one by one.
"use client";

import { useState } from "react";
import { Decimal } from "shared";
import { Alert, Button, Dialog, Field } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useModules } from "@/lib/modules";
import { styleLayout } from "@/lib/styles-seasons";
import type { AttributeDto, ItemDto, ItemPage } from "@/lib/types";

export interface GridLine {
  item: ItemDto;
  /** In the variant's basic unit, as typed. */
  quantity: string;
}

/** Why a variant cannot be bought, or null. */
function notBuyable(v: ItemDto): string | null {
  if (!v.active) return "switched off";
  if (!v.canBuy) return "not bought";
  return null;
}

/** A positive quantity, or null when the cell is empty; throws on anything else. */
function quantityOf(text: string, allowsFractions: boolean): Decimal | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(t)) throw new Error(`"${t}" is not a quantity`);
  const q = new Decimal(t);
  if (!allowsFractions && !q.isInteger()) throw new Error(`"${t}": whole pieces only`);
  return q.isZero() ? null : q;
}

/** Shown only while "Sizes and colours" is on (plan 12); the lines it adds are ordinary item lines. */
export function SizeColourGrid({ onAdd }: { onAdd: (lines: GridLine[]) => void }) {
  const { isOn } = useModules();
  return isOn("variants") ? <SizeColourGridButton onAdd={onAdd} /> : null;
}

function SizeColourGridButton({ onAdd }: { onAdd: (lines: GridLine[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [styles, setStyles] = useState<ItemDto[] | null>(null);
  const [style, setStyle] = useState<ItemDto | null>(null);
  const [variants, setVariants] = useState<ItemDto[]>([]);
  const [attributes, setAttributes] = useState<AttributeDto[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setText("");
    setStyles(null);
    setStyle(null);
    setVariants([]);
    setQty({});
    setProblem(null);
  }

  async function search() {
    setProblem(null);
    const t = text.trim();
    if (!t) return;
    try {
      const page = await api.get<ItemPage>(`/items${query({ search: t, kind: "style", active: "true", pageSize: 20 })}`);
      setStyles(page.rows);
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  async function pick(s: ItemDto) {
    setBusy(true);
    setProblem(null);
    try {
      const [vs, attrs] = await Promise.all([api.get<ItemDto[]>(`/items/${s.id}/variants`), api.get<AttributeDto[]>("/catalogue/attributes").catch(() => [] as AttributeDto[])]);
      setStyle(s);
      setVariants(vs);
      setAttributes(attrs);
      setQty({});
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    setProblem(null);
    const lines: GridLine[] = [];
    try {
      for (const v of variants) {
        const q = quantityOf(qty[v.id] ?? "", v.baseUnit.allowsFractions);
        if (q) lines.push({ item: v, quantity: q.toString() });
      }
    } catch (err) {
      setProblem(errorMessage(err));
      return;
    }
    if (!lines.length) {
      setProblem("Type a quantity under at least one size.");
      return;
    }
    onAdd(lines);
    setOpen(false);
    reset();
  }

  const grid = style && variants.length ? styleLayout(style, variants, attributes) : null;
  const attrName = (id: string) => style?.variantAttributes.find((a) => a.id === id)?.name ?? "";
  const total = Object.values(qty).reduce((s, t) => {
    try {
      return s.add(new Decimal(t.trim() || "0"));
    } catch {
      return s;
    }
  }, new Decimal(0));

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        Add by size and colour
      </Button>
      <Dialog
        open={open}
        title={style ? `Quantities of ${style.name}` : "Add by size and colour"}
        onClose={() => {
          setOpen(false);
          reset();
        }}
      >
        <Alert kind="error">{problem}</Alert>
        {!style ? (
          <>
            <Field id="grid-style-search" label="Style" hint="Type part of the style's code or name, then Enter.">
              <div className="toolbar" style={{ margin: 0 }}>
                <input
                  id="grid-style-search"
                  className="input"
                  value={text}
                  autoComplete="off"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void search();
                    }
                  }}
                />
                <Button size="small" onClick={() => void search()}>
                  Find
                </Button>
              </div>
            </Field>
            {styles && styles.length === 0 ? <p className="muted">No styles match “{text.trim()}”.</p> : null}
            {styles?.length ? (
              <ul className="picker-results picker-results-static">
                {styles.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="picker-result" disabled={busy} onClick={() => void pick(s)}>
                      <span className="mono">{s.code}</span> {s.name} <span className="muted">· {s.variantCount} variants</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : !grid ? (
          <p className="muted">{style.code} has no sizes or colours yet. Add them on the item page first.</p>
        ) : (
          <>
            <p className="muted">
              Quantities in {variants[0].baseUnit.code}. One line is added for each size and colour with a quantity; a dash means there is no such variant.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{grid.downAttributeIds.map(attrName).join(" / ") || attrName(grid.acrossAttributeId)}</th>
                    {grid.across.map((a) => (
                      <th key={a} scope="col" className="num">
                        {a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.down.map((d) => (
                    <tr key={d ?? "all"}>
                      <th scope="row">{d ?? style.name}</th>
                      {grid.across.map((a) => {
                        const v = grid.cell(d, a);
                        const why = v ? notBuyable(v.item) : null;
                        return (
                          <td key={a} className="num">
                            {!v ? (
                              "—"
                            ) : why ? (
                              <span className="muted" title={`${v.item.code} is ${why}`}>
                                ×
                              </span>
                            ) : (
                              <input
                                className="input grid-qty mono"
                                inputMode="decimal"
                                aria-label={`Quantity of ${[d, a].filter(Boolean).join(" ")}`}
                                title={v.item.code}
                                value={qty[v.id] ?? ""}
                                onChange={(e) => setQty((q) => ({ ...q, [v.id]: e.target.value }))}
                                style={{ width: "5em" }}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Total: <strong className="mono">{total.toString()}</strong>
            </p>
            <div className="actions">
              <Button variant="primary" onClick={add}>
                Add the lines
              </Button>
              <Button onClick={() => reset()}>Choose another style</Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
