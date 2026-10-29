// Copyright (c) 2026, Rademics. All rights reserved.
// Price and barcode labels (plan 10 §1.B): choose what to print (items with
// copies, everything on a goods receipt, or items whose price changed since a
// date, or the items of a markdown with the old and new price), a template, a store and a price list; see every label laid out as it
// will print; then print through the browser.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { hasPermission } from "shared";
import { ItemSearchBox } from "@/components/items/item-search-box";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, DataTable, RadioInput, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type LabelDataDto, type LabelTemplatesDto, sheetLayout, sheetsOf } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { type GoodsReceiptHeader, type Page, rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import type { MarkdownDto } from "@/lib/styles-seasons";
import type { ItemDto, ItemPage, PriceListDto, ScanResult } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { LabelPageStyle, LabelSheets } from "./label-view";
import { sizeText } from "./label-templates";

type Source = "items" | "receipt" | "changed" | "markdown";

interface Chosen {
  item: ItemDto;
  unitId: string;
  copies: string;
}

/** The units an item's labels can be for: the basic unit first. */
function unitsOf(item: ItemDto): { id: string; code: string }[] {
  return [{ id: item.baseUnit.id, code: item.baseUnit.code }, ...(item.units ?? []).filter((u) => u.unitId !== item.baseUnit.id).map((u) => ({ id: u.unitId, code: u.code }))];
}

export function LabelsScreen() {
  const { user, loading } = useAuth();
  const params = useSearchParams();
  const allowed = hasPermission(user, "labels.print");
  // Plan 12: markdown labels only while "Seasons and markdowns" is on.
  const markdownsOn = useModules().isOn("seasons");
  const canSeeReceipts = hasPermission(user, "purchase.view");
  const startReceipt = params.get("receiptId") ?? "";
  const startMarkdown = params.get("markdownId") ?? "";
  const today = useBusinessToday();

  const templates = useLoad<LabelTemplatesDto | null>(() => (allowed ? api.get<LabelTemplatesDto>("/labels/templates") : Promise.resolve(null)), [allowed]);
  const priceLists = useLoad<PriceListDto[]>(() => (allowed ? api.get<PriceListDto[]>("/price-lists").catch(() => []) : Promise.resolve([])), [allowed]);
  const receipts = useLoad<GoodsReceiptHeader[]>(
    () => (allowed && canSeeReceipts ? api.get<Page<GoodsReceiptHeader>>(`/purchase/receipts${query({ isReturn: "false", pageSize: 50 })}`).then((p) => p.rows.filter((r) => r.status !== "draft" && r.status !== "cancelled")) : Promise.resolve([])),
    [allowed, canSeeReceipts],
  );
  const { stores } = useOrderStores();
  // Plan 11 C5: markdowns, to print "was ₹X, now ₹Y" labels.
  const markdowns = useLoad<MarkdownDto[]>(() => (allowed && markdownsOn ? api.get<MarkdownDto[]>("/markdowns").catch(() => []) : Promise.resolve([])), [allowed, markdownsOn]);

  const [source, setSource] = useState<Source>(startMarkdown ? "markdown" : startReceipt ? "receipt" : "items");
  const [markdownId, setMarkdownId] = useState(startMarkdown);
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [search, setSearch] = useState("");
  const [receiptId, setReceiptId] = useState(startReceipt);
  const [since, setSince] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [skip, setSkip] = useState("0");
  const [result, setResult] = useState<LabelDataDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useLoad<ItemDto[]>(() => (search.trim() ? api.get<ItemPage>(`/items${query({ search: search.trim(), active: "true", pageSize: 20 })}`).then((p) => p.rows.filter((r) => !r.isParentStyle)) : Promise.resolve([])), [search]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Labels</h1>
        <Alert kind="error">You do not have the right to print labels. Ask the owner if you need it.</Alert>
      </>
    );
  }

  const list = templates.data?.templates ?? [];
  const template = list.find((t) => t.id === templateId) ?? list.find((t) => t.isDefault) ?? list[0] ?? null;
  const sinceDate = since || today;
  // Anything changed after a preview makes it out of date.
  const changed = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setResult(null);
  };

  function add(item: ItemDto, unitId?: string) {
    setResult(null);
    setChosen((list) => {
      const unit = unitId ?? item.baseUnit.id;
      const same = list.find((c) => c.item.id === item.id && c.unitId === unit);
      if (same) return list.map((c) => (c === same ? { ...c, copies: String(Number(c.copies || "0") + 1) } : c));
      return [...list, { item, unitId: unit, copies: "1" }];
    });
  }

  function onScanned(r: ScanResult) {
    if (!r.usable) {
      setProblem(r.reason ?? `${r.item.name} cannot have labels.`);
      return;
    }
    setProblem(null);
    add(r.item, r.unit.id);
  }

  async function show() {
    setProblem(null);
    const base = { templateId: template?.id, storeId: storeId || undefined, priceListId: priceListId || undefined };
    let body: Record<string, unknown>;
    if (source === "items") {
      if (!chosen.length) return setProblem("Add at least one item.");
      const bad = chosen.find((c) => !/^\d+$/.test(c.copies) || Number(c.copies) < 1 || Number(c.copies) > 500);
      if (bad) return setProblem(`Copies of ${bad.item.name} must be a whole number from 1 to 500.`);
      body = { ...base, items: chosen.map((c) => ({ itemId: c.item.id, unitId: c.unitId, copies: Number(c.copies) })) };
    } else if (source === "receipt") {
      if (!receiptId) return setProblem("Choose a goods receipt.");
      body = { ...base, receiptId };
    } else if (source === "markdown") {
      if (!markdownId) return setProblem("Choose a markdown.");
      body = { templateId: base.templateId, storeId: base.storeId, markdownId };
    } else {
      if (!sinceDate) return setProblem("Choose a date.");
      body = { ...base, priceChangedSince: sinceDate };
    }
    setBusy(true);
    try {
      setResult(await api.post<LabelDataDto>("/labels/data", body));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const chosenColumns: Column<Chosen>[] = [
    { key: "code", header: "Code", render: (c) => <span className="mono">{c.item.code}</span> },
    { key: "name", header: "Item", render: (c) => c.item.name },
    {
      key: "unit",
      header: "Unit",
      render: (c) => {
        const units = unitsOf(c.item);
        return units.length > 1 ? (
          <select className="input" aria-label={`Unit for ${c.item.name}`} value={c.unitId} onChange={(e) => changed(setChosen)(chosen.map((x) => (x === c ? { ...x, unitId: e.target.value } : x)))}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code}
              </option>
            ))}
          </select>
        ) : (
          units[0].code
        );
      },
    },
    {
      key: "copies",
      header: "Copies",
      align: "right",
      render: (c) => (
        <input className="input label-copies" type="number" min={1} max={500} step={1} aria-label={`Copies of ${c.item.name}`} value={c.copies} onChange={(e) => changed(setChosen)(chosen.map((x) => (x === c ? { ...x, copies: e.target.value } : x)))} />
      ),
    },
    {
      key: "remove",
      header: "",
      render: (c) => (
        <Button size="small" variant="link" onClick={() => changed(setChosen)(chosen.filter((x) => x !== c))} aria-label={`Remove ${c.item.name}`}>
          Remove
        </Button>
      ),
    },
  ];

  const layout = result && result.template.media === "sheet" ? sheetLayout(result.template) : null;
  const skipCount = layout ? Math.min(Math.max(0, Math.floor(Number(skip) || 0)), layout.perSheet - 1) : 0;
  const sheetCount = layout && result ? sheetsOf(result.labels, layout.perSheet, skipCount).length : 0;

  return (
    <div className="label-print">
      <div className="doc-no-print">
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>Labels</h1>
          <span className="spacer" />
          {hasPermission(user, "print.settings") ? (
            <Link href="/labels/templates" className="btn btn-small">
              Label templates
            </Link>
          ) : null}
        </div>
        <p className="muted">Price and barcode stickers for the shelf or the goods. Pick what to print, check the preview, then print.</p>

        {/* Not a form: the item search box inside is a form of its own. */}
        <div className="card">
          <fieldset>
            <legend>What to print labels for</legend>
            <div className="check-row">
              <RadioInput id="src-items" name="label-source" label="Items I choose" checked={source === "items"} onChange={() => changed(setSource)("items")} />
              {canSeeReceipts || startReceipt ? <RadioInput id="src-receipt" name="label-source" label="Everything on a goods receipt" description="One label for each piece received" checked={source === "receipt"} onChange={() => changed(setSource)("receipt")} /> : null}
              {markdownsOn && (startMarkdown || (markdowns.data ?? []).length) ? <RadioInput id="src-markdown" name="label-source" label="A markdown" description="The old price struck through and the new price" checked={source === "markdown"} onChange={() => changed(setSource)("markdown")} /> : null}
              <RadioInput id="src-changed" name="label-source" label="Items whose price changed" description="Since a date, to re-label the shelf" checked={source === "changed"} onChange={() => changed(setSource)("changed")} />
            </div>
          </fieldset>

          {source === "items" ? (
            <>
              <ItemSearchBox onScanned={onScanned} onSearch={(text) => setSearch(text)} label="Scan or search for an item" />
              {search.trim() ? (
                <div className="picker-results picker-results-static label-matches">
                  {matches.loading ? <p className="muted">Searching…</p> : null}
                  {matches.data && matches.data.length === 0 ? <p className="muted">No items match “{search.trim()}”.</p> : null}
                  {(matches.data ?? []).map((m) => (
                    <button key={m.id} type="button" className="picker-result" onClick={() => add(m)}>
                      <span className="mono">{m.code}</span> {m.name} <span className="muted">· add</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <DataTable columns={chosenColumns} rows={chosen} rowKey={(c) => `${c.item.id}-${c.unitId}`} empty="No items yet. Scan a barcode or search above." />
            </>
          ) : null}

          {source === "receipt" ? (
            <SelectInput id="label-receipt" label="Goods receipt" value={receiptId} onChange={(e) => changed(setReceiptId)(e.target.value)} hint="Batch, packed and expiry dates print from the receipt.">
              <option value="">Choose…</option>
              {startReceipt && !(receipts.data ?? []).some((r) => r.id === startReceipt) ? <option value={startReceipt}>The receipt you came from</option> : null}
              {(receipts.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} · {formatDate(r.postingDate)} · {r.supplier.name}
                </option>
              ))}
            </SelectInput>
          ) : null}

          {source === "markdown" ? (
            <SelectInput id="label-markdown" label="Markdown" value={markdownId} onChange={(e) => changed(setMarkdownId)(e.target.value)} hint="One label per item, with the price list of the markdown.">
              <option value="">Choose…</option>
              {startMarkdown && !(markdowns.data ?? []).some((m) => m.id === startMarkdown) ? <option value={startMarkdown}>The markdown you came from</option> : null}
              {(markdowns.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.rule === "percent" ? `${m.value}% off` : rupees(m.value)} from {formatDate(m.startDate)} · {m.itemCount} items{m.remark ? ` · ${m.remark}` : ""}
                </option>
              ))}
            </SelectInput>
          ) : null}

          {source === "changed" ? <TextInput id="label-since" label="Price changed on or after" type="date" value={sinceDate} max={today || undefined} onChange={(e) => changed(setSince)(e.target.value)} hint="Prices in the chosen price list that start on or after this date and have already started." /> : null}

          <div className="form-grid">
            <SelectInput id="label-template" label="Template" value={template?.id ?? ""} onChange={(e) => changed(setTemplateId)(e.target.value)} hint={template ? sizeText(template, templates.data?.sizes ?? []) : undefined}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput id="label-pricelist" label="Price list" value={priceListId} onChange={(e) => changed(setPriceListId)(e.target.value)}>
              <option value="">The usual selling price list</option>
              {(priceLists.data ?? [])
                .filter((l) => l.forSelling && l.active)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </SelectInput>
            <SelectInput id="label-store" label="Store" value={storeId} onChange={(e) => changed(setStoreId)(e.target.value)} hint="Its name prints when the template shows the store name.">
              <option value="">No store name</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </SelectInput>
          </div>
          <Alert kind="error">{templates.error ?? problem}</Alert>
          <div className="actions">
            <Button variant="primary" busy={busy} disabled={!template} onClick={() => void show()}>
              Show the labels
            </Button>
          </div>
        </div>

        {result ? (
          <div className="card">
            {result.labels.length === 0 ? (
              <Alert kind="info">There is nothing to print: no labels came out of that choice.</Alert>
            ) : (
              <>
                <div className="toolbar" style={{ marginTop: 0 }}>
                  <strong>
                    {result.labels.length} label{result.labels.length === 1 ? "" : "s"}
                    {layout ? ` on ${sheetCount} sheet${sheetCount === 1 ? "" : "s"}` : " on the label roll"}
                  </strong>
                  <span className="muted">· {result.template.name}</span>
                  <span className="spacer" />
                  {layout ? (
                    <TextInput id="label-skip" label="Spaces already used on the first sheet" type="number" min={0} max={layout.perSheet - 1} step={1} value={skip} onChange={(e) => setSkip(e.target.value)} />
                  ) : null}
                  <Button variant="primary" onClick={() => window.print()}>
                    Print labels
                  </Button>
                </div>
                <p className="field-hint">
                  In the print window choose {layout ? "A4 paper" : "the label printer"}, set the margins to <strong>None</strong> and the scale to <strong>100%</strong> (actual size), so every label lands on its sticker.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {result && result.labels.length ? (
        <>
          <LabelPageStyle template={result.template} />
          <div className="label-preview" aria-label="Labels as they will print">
            <LabelSheets data={result} skip={skipCount} />
          </div>
        </>
      ) : null}
    </div>
  );
}
