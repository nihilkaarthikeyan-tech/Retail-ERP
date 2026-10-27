// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { COUNT_TYPES, createCountSchema, Decimal, hasPermission, quantityProblem, updateCountSchema } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { Alert, Button, CheckInput, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import { defaultStoreId, indianTime, showQuantity, splitLines, stockLocationsOf, storesFromLocations, useBusinessToday } from "@/lib/stock";
import type { BatchStockRow, ItemDto, StockBalanceResult, StockBalanceRow, StockDocLineDto, StockDocumentDto, StockLocationDto } from "@/lib/types";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { CancelDocumentDialog, StockStatusBadge } from "./stock-doc-parts";
import { StockItemAdder } from "./stock-item-adder";
import { BatchSelect, newLineKey } from "./stock-line-grid";

/** One counted line as typed on screen. */
interface CountLine {
  key: string;
  itemId: string;
  code: string;
  name: string;
  /** Basic unit code and whether it takes fractions, when known. */
  unitCode: string;
  allowsFractions: boolean | null;
  trackBatches: boolean;
  trackSerials: boolean;
  batchId: string;
  batchLabel: string;
  batchNumber: string;
  expiryDate: string;
  counted: string;
  unitCost: string;
  serials: string;
  /** What the system expects, as last returned by the API (null: hidden or not yet saved). */
  expected: string | null;
}

function fromDto(l: StockDocLineDto, previous: CountLine[]): CountLine {
  const known = previous.find((p) => p.itemId === l.item.id);
  return {
    key: newLineKey(),
    itemId: l.item.id,
    code: l.item.code,
    name: l.item.name,
    unitCode: known?.unitCode ?? "",
    allowsFractions: known?.allowsFractions ?? null,
    trackBatches: l.item.trackBatches,
    trackSerials: l.item.trackSerials,
    batchId: l.batch?.id ?? "",
    batchLabel: l.batch?.batchNumber ?? "",
    batchNumber: l.newBatchNumber ?? "",
    expiryDate: l.newExpiryOn ?? "",
    counted: showQuantity(l.countedQuantity ?? l.quantity),
    unitCost: l.unitCost ?? "",
    serials: l.serialNumbers.join("\n"),
    expected: l.expectedQuantity,
  };
}

function fromItem(item: ItemDto): CountLine {
  return {
    key: newLineKey(),
    itemId: item.id,
    code: item.code,
    name: item.name,
    unitCode: item.baseUnit.code,
    allowsFractions: item.baseUnit.allowsFractions,
    trackBatches: item.trackBatches,
    trackSerials: item.trackSerials,
    batchId: "",
    batchLabel: "",
    batchNumber: "",
    expiryDate: "",
    counted: "",
    unitCost: "",
    serials: "",
    expected: null,
  };
}

/** A line for an item found in the stock balance (its unit rules are not known here; the API checks them). */
function fromBalance(row: StockBalanceRow): CountLine {
  return {
    key: newLineKey(),
    itemId: row.item.id,
    code: row.item.code,
    name: row.item.name,
    unitCode: row.item.unit,
    allowsFractions: null,
    trackBatches: false,
    trackSerials: false,
    batchId: "",
    batchLabel: "",
    batchNumber: "",
    expiryDate: "",
    counted: "",
    unitCost: "",
    serials: "",
    expected: null,
  };
}

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function countProblem(l: CountLine, opening: boolean): string | null {
  const typed = l.counted.trim();
  if (!typed) return `${l.code}: enter the quantity counted (0 if none)`;
  if (l.allowsFractions !== null) {
    const p = quantityProblem(typed, { code: l.unitCode, allowsFractions: l.allowsFractions });
    if (p) return `${l.code}: ${p}`;
  }
  const q = parse(typed);
  if (!q || q.isNegative()) return `${l.code}: the counted quantity must be zero or more`;
  if (l.trackBatches && !l.batchId && !l.batchNumber.trim()) return `${l.code}: count each batch separately (choose the batch or type a new batch number)`;
  if (l.trackSerials && !q.eq(splitLines(l.serials).length)) return `${l.code}: list the ${q.toString()} serial numbers counted`;
  if (opening && !l.unitCost.trim()) return `${l.code}: opening stock needs a cost per unit`;
  if (l.unitCost.trim()) {
    const c = parse(l.unitCost);
    if (!c || c.isNegative()) return `${l.code}: the cost must be zero or more`;
  }
  return null;
}

function difference(l: CountLine): string | null {
  if (l.expected === null) return null;
  const counted = parse(l.counted);
  const expected = parse(l.expected);
  if (!counted || !expected) return null;
  return counted.sub(expected).toString();
}

interface CountEditorProps {
  doc: StockDocumentDto | null;
  locations: StockLocationDto[];
  onSaved: (doc: StockDocumentDto) => void;
}

/** Opening-stock load or normal stock count at one location, with a blind option. */
export function CountEditor({ doc, locations, onSaved }: CountEditorProps) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const stores = storesFromLocations(locations);
  const canDraft = hasPermission(user, "stock.count");
  const canFinalise = hasPermission(user, "stock.adjust_finalise");
  const editable = canDraft && (!doc || doc.status === "draft");

  const [storeId, setStoreId] = useState(doc?.storeId ?? defaultStoreId(user, stores));
  const [locationId, setLocationId] = useState(doc?.toLocationId ?? "");
  const [countType, setCountType] = useState<string>(doc?.countType ?? "normal");
  const [blind, setBlind] = useState(doc?.blind ?? false);
  const [postingDate, setPostingDate] = useState(doc?.postingDate ?? "");
  const [postingTime, setPostingTime] = useState(doc ? indianTime(doc.postingAt) : "");
  const [dateTouched, setDateTouched] = useState(false);
  const [remarks, setRemarks] = useState(doc?.remarks ?? "");
  const [lines, setLinesState] = useState<CountLine[]>(() => (doc ? doc.lines.map((l) => fromDto(l, [])) : []));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "finalise" | "fill" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const shelves = storeId ? stockLocationsOf(locations, storeId) : [];
  const opening = countType === "opening";
  const hiddenExpected = !!doc && doc.blind && doc.lines.some((l) => l.expectedQuantity === null);

  function touch() {
    setDirty(true);
    setNote(null);
  }
  function setLines(next: CountLine[]) {
    setLinesState(next);
    touch();
  }
  function update(key: string, patch: Partial<CountLine>) {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function addAllInStock() {
    if (!locationId) {
      setErrors({ ...errors, locationId: "Choose the location first" });
      return;
    }
    setBusy("fill");
    setError(null);
    try {
      const [balance, batches] = await Promise.all([
        api.get<StockBalanceResult>(`/stock/balance${query({ storeId, locationId })}`),
        api.get<BatchStockRow[]>("/stock/batches"),
      ]);
      const batchesHere = batches.filter((b) => b.location.id === locationId);
      const have = new Set(lines.map((l) => `${l.itemId}|${l.batchId}`));
      const added: CountLine[] = [];
      for (const row of balance.rows) {
        const itemBatches = batchesHere.filter((b) => b.item.id === row.item.id);
        const base = fromBalance(row);
        if (itemBatches.length > 0) {
          for (const b of itemBatches) {
            if (have.has(`${row.item.id}|${b.batch.id}`)) continue;
            added.push({ ...base, key: newLineKey(), trackBatches: true, batchId: b.batch.id, batchLabel: b.batch.batchNumber, expected: blind ? null : b.quantity });
          }
        } else if (!have.has(`${row.item.id}|`)) {
          // Launch check, 27 October 2026: on a normal count, what is in stock now shows at once;
          // saving works it out again at the count's own date and time.
          added.push({ ...base, key: newLineKey(), expected: blind ? null : row.quantity });
        }
      }
      setLines([...lines, ...added]);
      setNote(added.length ? `${added.length} line${added.length === 1 ? "" : "s"} added. Type what you count on each.` : "Every item in stock here is already listed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function prepare(): Record<string, unknown> | null {
    setError(null);
    const headerErrors: FieldErrors = {};
    if (!storeId) headerErrors.storeId = "Choose the store";
    if (!locationId) headerErrors.locationId = "Choose the location counted";
    if (postingDate && today && postingDate > today) headerErrors.postingDate = "A count cannot be dated in the future";
    const issues: Record<string, string> = {};
    for (const l of lines) {
      const p = countProblem(l, opening);
      if (p) issues[l.key] = p;
    }
    setProblems(issues);
    const sendDate = !doc || dateTouched;
    const body = {
      locationId,
      blind,
      postingDate: sendDate && postingDate ? postingDate : undefined,
      postingTime: sendDate && postingTime ? postingTime : undefined,
      remarks: blankToNull(remarks),
      lines: lines.map((l) => ({
        itemId: l.itemId,
        ...(l.batchId ? { batchId: l.batchId } : l.trackBatches && l.batchNumber.trim() ? { batchNumber: l.batchNumber.trim(), expiryDate: l.expiryDate || null } : {}),
        countedQuantity: l.counted.trim(),
        ...(l.unitCost.trim() ? { unitCost: l.unitCost.trim() } : {}),
        ...(l.trackSerials ? { serialNumbers: splitLines(l.serials) } : {}),
      })),
    };
    const parsed = doc ? updateCountSchema.safeParse(body) : createCountSchema.safeParse({ ...body, countType, storeId });
    const all = { ...issuesToFieldErrors(parsed), ...headerErrors };
    setErrors(all);
    if (lines.length === 0) {
      setError("Add at least one item.");
      return null;
    }
    if (Object.keys(issues).length) {
      setError(`Please fix the lines marked below: ${Object.values(issues).join("; ")}`);
      return null;
    }
    if (Object.keys(all).length || !parsed.success) {
      setError("Please fix the fields marked below.");
      return null;
    }
    return parsed.data as Record<string, unknown>;
  }

  function took(after: StockDocumentDto) {
    setLinesState(after.lines.map((l) => fromDto(l, lines)));
    setDirty(false);
    onSaved(after);
  }

  async function save() {
    const body = prepare();
    if (!body) return;
    setBusy("save");
    try {
      const after = doc ? await api.patch<StockDocumentDto>(`/stock/counts/${doc.id}`, body) : await api.post<StockDocumentDto>("/stock/counts", body);
      took(after);
      setNote("Count saved. The expected quantities are worked out at the count's date and time.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finalise() {
    if (!doc) return;
    setBusy("finalise");
    try {
      if (dirty && editable) {
        const body = prepare();
        if (!body) return;
        await api.patch<StockDocumentDto>(`/stock/counts/${doc.id}`, body);
        setDirty(false);
      } else {
        setError(null);
      }
      const after = await api.post<StockDocumentDto>(`/stock/documents/${doc.id}/finalise`);
      onSaved(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const anySerials = lines.some((l) => l.trackSerials);
  const anyBatches = lines.some((l) => l.trackBatches);

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{doc ? `Stock count ${doc.number}` : "New stock count"}</h1>
        {doc ? <StockStatusBadge status={doc.status} /> : null}
        <span className="spacer" />
        {doc ? <PrintButton kind="count_sheet" id={doc.id} label="Print count sheet" /> : null}
      </div>
      {!canDraft ? <Alert kind="info">You can look at this count but not change it.</Alert> : null}

      <div className="card">
        <div className="form-grid">
          <SelectInput
            id="count-store"
            label="Store"
            value={storeId}
            disabled={!!doc || !editable}
            onChange={(e) => {
              setStoreId(e.target.value);
              setLocationId("");
              touch();
            }}
            error={errors.storeId}
            required
          >
            <option value="">Choose…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            id="count-location"
            label="Location counted"
            value={locationId}
            disabled={!editable}
            onChange={(e) => {
              setLocationId(e.target.value);
              touch();
            }}
            error={errors.locationId}
            required
          >
            <option value="">Choose…</option>
            {shelves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            id="count-type"
            label="Type of count"
            value={countType}
            disabled={!!doc || !editable}
            onChange={(e) => {
              setCountType(e.target.value);
              touch();
            }}
          >
            {COUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "opening" ? "Opening stock (needs a cost per unit)" : "Normal count"}
              </option>
            ))}
          </SelectInput>
          <TextInput
            id="count-date"
            label="Count date"
            type="date"
            value={postingDate || today}
            max={today || undefined}
            disabled={!editable}
            onChange={(e) => {
              setPostingDate(e.target.value);
              setDateTouched(true);
              touch();
            }}
            error={errors.postingDate}
          />
          <TextInput
            id="count-time"
            label="Time (optional)"
            type="time"
            value={postingTime}
            disabled={!editable}
            onChange={(e) => {
              setPostingTime(e.target.value);
              setDateTouched(true);
              touch();
            }}
            error={errors.postingTime}
          />
        </div>
        <CheckInput
          id="count-blind"
          label="Blind count"
          description="The people counting do not see the expected quantities."
          checked={blind}
          disabled={!editable}
          onChange={(e) => {
            setBlind(e.target.checked);
            // Quantities shown before saving are hidden again once the count is blind.
            if (e.target.checked && !doc) setLines(lines.map((l) => ({ ...l, expected: null })));
            touch();
          }}
        />
        <TextareaInput id="count-remarks" label="Remarks" value={remarks} disabled={!editable} onChange={(e) => {
            setRemarks(e.target.value);
            touch();
          }} maxLength={300} />
      </div>

      <h2>Items counted</h2>
      {editable ? (
        <>
          <StockItemAdder onAdd={(item) => setLines([...lines, fromItem(item)])} />
          <div className="actions">
            <Button busy={busy === "fill"} disabled={busy !== null} onClick={addAllInStock}>
              Add all items in stock at this location
            </Button>
          </div>
        </>
      ) : null}
      {hiddenExpected ? <p className="muted">This is a blind count: expected quantities are hidden from you.</p> : null}

      {lines.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : (
        <div className="table-wrap line-grid">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                {anyBatches ? <th scope="col">Batch</th> : null}
                <th scope="col" className="num">
                  Expected
                </th>
                <th scope="col" className="num">
                  Counted
                </th>
                <th scope="col" className="num">
                  Difference
                </th>
                {anySerials ? <th scope="col">Serial numbers</th> : null}
                <th scope="col" className="num">
                  Cost per unit{opening ? " *" : " (optional)"}
                </th>
                {editable ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const diff = difference(l);
                const problem = problems[l.key];
                return (
                  <tr key={l.key} className={problem ? "row-alert" : undefined}>
                    <td>
                      <span className="mono">{l.code}</span> {l.name}
                      {l.unitCode ? <span className="muted"> · {l.unitCode}</span> : null}
                      {problem ? (
                        <p className="field-error" role="alert">
                          {problem}
                        </p>
                      ) : null}
                    </td>
                    {anyBatches ? (
                      <td>
                        {!l.trackBatches ? (
                          <span className="muted">—</span>
                        ) : l.batchId && l.batchLabel ? (
                          <span className="mono">{l.batchLabel}</span>
                        ) : (
                          <div className="form-grid">
                            <BatchSelect id={`count-${i}-batch`} itemId={l.itemId} locationId={locationId} value={l.batchId} disabled={!editable} onChange={(batchId) => update(l.key, { batchId, batchNumber: "" })} />
                            {!l.batchId ? (
                              <>
                                <input className="input" aria-label={`New batch number for line ${i + 1}`} placeholder="or a new batch number" value={l.batchNumber} disabled={!editable} onChange={(e) => update(l.key, { batchNumber: e.target.value })} />
                                <input className="input" type="date" aria-label={`Expiry of the new batch for line ${i + 1}`} value={l.expiryDate} disabled={!editable} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                              </>
                            ) : null}
                          </div>
                        )}
                      </td>
                    ) : null}
                    <td className="num">{l.expected !== null ? showQuantity(l.expected) : doc && doc.blind ? <span className="muted">hidden</span> : <span className="muted">after saving</span>}</td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Counted quantity for line ${i + 1}`} value={l.counted} disabled={!editable} onChange={(e) => update(l.key, { counted: e.target.value })} />
                    </td>
                    <td className={`num${diff && diff.startsWith("-") ? " num-negative" : ""}`}>{diff === null ? "—" : diff.startsWith("-") || diff === "0" ? diff : `+${diff}`}</td>
                    {anySerials ? (
                      <td>
                        {l.trackSerials ? (
                          <textarea className="input" aria-label={`Serial numbers counted for line ${i + 1}`} placeholder="One per line: every serial at this location" value={l.serials} disabled={!editable} onChange={(e) => update(l.key, { serials: e.target.value })} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Cost per unit for line ${i + 1}`} value={l.unitCost} disabled={!editable} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
                    </td>
                    {editable ? (
                      <td>
                        <Button size="small" variant="link" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Cost per unit is per basic unit. Lines with no difference are left out when the count is finalised.</p>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{note}</Alert>
      <div className="actions">
        {editable ? (
          <Button variant={doc ? "secondary" : "primary"} busy={busy === "save"} disabled={busy !== null} onClick={() => save()}>
            Save draft
          </Button>
        ) : null}
        {doc && doc.status === "draft" && canFinalise ? (
          <Button variant="primary" busy={busy === "finalise"} disabled={busy !== null} onClick={finalise}>
            Finalise
          </Button>
        ) : null}
        {doc && doc.status === "draft" && canDraft ? (
          <Button variant="danger" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
            Cancel draft
          </Button>
        ) : null}
      </div>
      {!doc ? (
        <p className="muted">
          {blind
            ? "Expected quantities stay hidden on a blind count. Save the draft, then it can be finalised."
            : "Lines added with “Add all in stock” show what is in stock now. Saving the draft works the expected quantities out at the count's date and time; then it can be finalised."}
        </p>
      ) : null}
      {doc && doc.status === "draft" && !canFinalise ? <p className="muted">The Store Manager (or someone else with the right) finalises the count.</p> : null}
      {doc ? <CancelDocumentDialog doc={doc} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onSaved} /> : null}
    </div>
  );
}
