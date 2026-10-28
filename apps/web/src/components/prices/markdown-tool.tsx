// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C5 (owner decision of 16 October 2026): the markdown tool. Choose
// items by season, groups, brands or by hand; a percentage off or a new price;
// from a date (and to a date). The preview shows every item's old price, new
// price and the MRP check; applying adds dated prices to the selling list and
// keeps the old ones. The labels page then prints "was ₹X, now ₹Y".
"use client";

import Link from "next/link";
import { useState } from "react";
import { hasPermission, type MarkdownInput, markdownSchema } from "shared";
import { ItemPicker } from "@/components/prices/item-picker";
import { OrdersReasonDialog } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, CheckInput, DataTable, Field, RadioInput, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups } from "@/lib/catalogue";
import { formatDate } from "@/lib/format";
import { forPicking, pickLabel } from "@/lib/pick";
import { rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import type { MarkdownDto, MarkdownLineDto, MarkdownPreviewDto, SeasonDto } from "@/lib/styles-seasons";
import type { BrandDto, ItemDto, ItemGroupNode, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

interface Choice {
  priceListId: string;
  seasonId: string;
  itemGroupIds: string[];
  brandIds: string[];
  items: ItemDto[];
  rule: "percent" | "price";
  value: string;
  startDate: string;
  endDate: string;
  remark: string;
}

const STATUS_WORDS: Record<MarkdownDto["status"], string> = { running: "Running", upcoming: "Not started", ended: "Ended", withdrawn: "Withdrawn" };

const toggled = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

export function MarkdownTool() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "prices.manage");
  const today = useBusinessToday();
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const seasons = useLoad(() => api.get<SeasonDto[]>("/seasons").catch(() => [] as SeasonDto[]));
  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups").catch(() => [] as ItemGroupNode[]));
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands").catch(() => [] as BrandDto[]));
  const history = useLoad(() => api.get<MarkdownDto[]>("/markdowns"));
  const [c, setC] = useState<Choice>({ priceListId: "", seasonId: "", itemGroupIds: [], brandIds: [], items: [], rule: "percent", value: "", startDate: "", endDate: "", remark: "" });
  const [preview, setPreview] = useState<MarkdownPreviewDto | null>(null);
  const [done, setDone] = useState<MarkdownDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState<MarkdownDto | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);

  // Anything changed makes the preview out of date.
  const change = (patch: Partial<Choice>) => {
    setC((x) => ({ ...x, ...patch }));
    setPreview(null);
    setDone(null);
  };

  function input(): MarkdownInput | null {
    const parsed = markdownSchema.safeParse({
      priceListId: c.priceListId || null,
      seasonId: c.seasonId || null,
      itemGroupIds: c.itemGroupIds,
      brandIds: c.brandIds,
      itemIds: c.items.map((i) => i.id),
      rule: c.rule,
      value: c.value.trim(),
      startDate: c.startDate || today,
      endDate: c.endDate || null,
      remark: c.remark.trim() || null,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Check the markdown");
      return null;
    }
    return parsed.data;
  }

  async function run(apply: boolean) {
    setProblem(null);
    const body = input();
    if (!body) return;
    setBusy(true);
    try {
      if (apply) {
        setDone(await api.post<MarkdownDto>("/markdowns", body));
        setPreview(null);
        await history.reload();
      } else {
        setPreview(await api.post<MarkdownPreviewDto>("/markdowns/preview", body));
      }
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const lineColumns: Column<MarkdownLineDto>[] = [
    { key: "code", header: "Code", render: (l) => <span className="mono">{l.code}</span> },
    { key: "name", header: "Item", render: (l) => l.name },
    { key: "mrp", header: "MRP", align: "right", render: (l) => (l.mrp ? rupees(l.mrp) : "—") },
    { key: "old", header: "Old price", align: "right", render: (l) => (l.oldPrice ? rupees(l.oldPrice) : "—") },
    { key: "new", header: "New price", align: "right", render: (l) => (l.newPrice ? <strong>{rupees(l.newPrice)}</strong> : "—") },
    {
      key: "note",
      header: "",
      render: (l) => (l.skipped ? <Badge kind="off">Left out: {l.skipped}</Badge> : l.cappedAtMrp ? <Badge kind="warn">Brought down to the MRP</Badge> : null),
    },
  ];

  const historyColumns: Column<MarkdownDto>[] = [
    { key: "rule", header: "Markdown", render: (m) => (m.rule === "percent" ? `${m.value}% off` : `New price ${rupees(m.value)}`) },
    { key: "dates", header: "From – to", render: (m) => `${formatDate(m.startDate)} – ${m.endDate ? formatDate(m.endDate) : "no end"}` },
    { key: "list", header: "Price list", render: (m) => m.priceList?.name ?? "—" },
    { key: "items", header: "Items", align: "right", render: (m) => m.itemCount },
    {
      key: "status",
      header: "Status",
      render: (m) => (
        <>
          <Badge kind={m.status === "running" ? "ok" : m.status === "upcoming" ? "warn" : "off"}>{STATUS_WORDS[m.status]}</Badge>
          {m.stoppedOn ? <span className="muted"> {m.status === "withdrawn" ? "on" : "early, on"} {formatDate(m.stoppedOn)}{m.stoppedReason ? `: ${m.stoppedReason}` : ""}</span> : null}
        </>
      ),
    },
    { key: "by", header: "By", render: (m) => `${m.createdBy ?? "—"}${m.remark ? ` · ${m.remark}` : ""}` },
    {
      key: "labels",
      header: "",
      render: (m) => (
        <span className="row-actions">
          {m.status !== "withdrawn" ? (
            <Link href={`/labels?markdownId=${m.id}`} className="btn btn-small">
              Print labels
            </Link>
          ) : null}
          {canManage && (m.status === "upcoming" || m.status === "running") ? (
            <Button size="small" onClick={() => setStopping(m)}>
              {m.status === "upcoming" ? "Withdraw" : "End now"}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const groupOptions = flattenGroups(groups.data ?? []).filter((g) => g.active);
  const sellingLists = (lists.data ?? []).filter((l) => l.forSelling && l.active);

  return (
    <>
      <h1>Markdowns</h1>
      <p className="muted">Lower the selling price of a season, groups, brands or chosen items from a date. The new prices are added to the price list with their dates; the old prices stay, so before the start date (and after the end date) the old price applies. Prices are rounded to the rupee and never go above the MRP.</p>
      <Alert kind="error">{lists.error ?? history.error}</Alert>

      {canManage ? (
        <div className="card">
          <fieldset>
            <legend>Which items</legend>
            <p className="muted">Items matching every choice below, plus any items added by hand. A style stands for all its sizes and colours.</p>
            <div className="form-grid">
              <SelectInput id="md-season" label="Season" value={c.seasonId} onChange={(e) => change({ seasonId: e.target.value })}>
                <option value="">Any season</option>
                {(seasons.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
              {/* Launch check, 27 October 2026: tick boxes, not "Hold Ctrl", which most people do not know and a phone cannot do. */}
              <Field id="md-groups" label="Groups" hint="Tick any number; a group includes its sub-groups. None ticked: any group.">
                <div id="md-groups" className="check-list check-list-short">
                  {groupOptions.map((g) => (
                    <CheckInput key={g.id} id={`md-group-${g.id}`} label={g.label} checked={c.itemGroupIds.includes(g.id)} onChange={(e) => change({ itemGroupIds: toggled(c.itemGroupIds, g.id, e.target.checked) })} />
                  ))}
                </div>
              </Field>
              <Field id="md-brands" label="Brands" hint="Tick any number. None ticked: any brand.">
                <div id="md-brands" className="check-list check-list-short">
                  {forPicking(brands.data ?? [], c.brandIds).map((b) => (
                    <CheckInput key={b.id} id={`md-brand-${b.id}`} label={pickLabel(b.name, b)} checked={c.brandIds.includes(b.id)} onChange={(e) => change({ brandIds: toggled(c.brandIds, b.id, e.target.checked) })} />
                  ))}
                </div>
              </Field>
              <div>
                <ItemPicker id="md-item" label="Add an item or style" value={null} excludeStyles={false} onChange={(i) => i && !c.items.some((x) => x.id === i.id) && change({ items: [...c.items, i] })} />
                {c.items.length ? (
                  <ul className="plain-list" aria-label="Items added by hand">
                    {c.items.map((i) => (
                      <li key={i.id}>
                        <span className="mono">{i.code}</span> {i.name}{" "}
                        <Button size="small" variant="link" aria-label={`Remove ${i.name}`} onClick={() => change({ items: c.items.filter((x) => x.id !== i.id) })}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>New price</legend>
            <div className="check-row">
              <RadioInput id="md-rule-percent" name="md-rule" label="Percentage off" checked={c.rule === "percent"} onChange={() => change({ rule: "percent" })} />
              <RadioInput id="md-rule-price" name="md-rule" label="A fixed new price" checked={c.rule === "price"} onChange={() => change({ rule: "price" })} />
            </div>
            <div className="form-grid">
              <TextInput id="md-value" label={c.rule === "percent" ? "Percentage off" : "New price (₹, per basic unit)"} value={c.value} onChange={(e) => change({ value: e.target.value })} inputMode="decimal" className="mono" required />
              <TextInput id="md-start" label="From" type="date" value={c.startDate || today} onChange={(e) => change({ startDate: e.target.value })} required />
              <TextInput id="md-end" label="To (optional)" type="date" value={c.endDate} onChange={(e) => change({ endDate: e.target.value })} hint="Leave empty for no end date." />
              <SelectInput id="md-list" label="Price list" value={c.priceListId} onChange={(e) => change({ priceListId: e.target.value })}>
                <option value="">The usual selling price list</option>
                {sellingLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectInput>
              <TextInput id="md-remark" label="Remark" value={c.remark} onChange={(e) => change({ remark: e.target.value })} hint="e.g. End of season sale" />
            </div>
          </fieldset>
          <Alert kind="error">{problem}</Alert>
          {done ? (
            <Alert kind="success">
              New prices added for {done.itemCount} item{done.itemCount === 1 ? "" : "s"} from {formatDate(done.startDate)}.{" "}
              <Link href={`/labels?markdownId=${done.id}`}>Print the labels</Link>
            </Alert>
          ) : null}
          <div className="actions">
            <Button busy={busy && !preview} onClick={() => void run(false)}>
              Preview
            </Button>
            <Button variant="primary" busy={busy && !!preview} disabled={!preview || preview.toChange === 0} onClick={() => void run(true)}>
              Apply the new prices
            </Button>
          </div>
        </div>
      ) : (
        <Alert kind="info">You can see past markdowns but not make new ones; that needs the right to change prices.</Alert>
      )}

      {preview ? (
        <div className="card">
          <p>
            <strong>
              {preview.toChange} of {preview.items} item{preview.items === 1 ? "" : "s"} will get a new price
            </strong>{" "}
            in {preview.priceList.name}
            {preview.cappedAtMrp ? `; ${preview.cappedAtMrp} brought down to the MRP` : ""}
            {preview.skipped ? `; ${preview.skipped} left out` : ""}.
          </p>
          <DataTable columns={lineColumns} rows={preview.lines} rowKey={(l) => l.itemId} />
        </div>
      ) : null}

      <h2>Past markdowns</h2>
      {stopped ? <Alert kind="success">{stopped}</Alert> : null}
      <DataTable columns={historyColumns} rows={history.data} rowKey={(m) => m.id} loading={history.loading} empty="No markdowns yet." />
      <OrdersReasonDialog
        open={stopping !== null}
        title={stopping?.status === "upcoming" ? "Withdraw this markdown?" : "End this markdown now?"}
        explain={
          stopping?.status === "upcoming"
            ? `Its ${stopping.itemCount} new prices will never apply; the items keep their present prices.`
            : `From today the ${stopping?.itemCount ?? ""} items go back to the price they had before the markdown. Bills already made keep their prices.`
        }
        confirmLabel={stopping?.status === "upcoming" ? "Withdraw" : "End now"}
        danger
        onClose={() => setStopping(null)}
        onConfirm={async (reason) => {
          const m = stopping!;
          await api.post<MarkdownDto>(`/markdowns/${m.id}/stop`, { reason });
          if (done?.id === m.id) setDone(null);
          setStopped(m.status === "upcoming" ? "The markdown was withdrawn." : "The markdown has ended; the old prices apply from today.");
          await history.reload();
        }}
      />
    </>
  );
}
