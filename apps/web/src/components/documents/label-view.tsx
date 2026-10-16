// Copyright (c) 2026, Rademics. All rights reserved.
// Price and barcode labels laid out in millimetres, the same on screen as on
// paper: A4 sticker sheets place each label by the template's margins and gaps;
// a label roll prints one label per page (the page size is the label's size).
import type { LabelField } from "shared";
import { formatDate } from "@/lib/format";
import { type LabelDataDto, type LabelDto, type LabelTemplateDto, sheetLayout, sheetsOf } from "@/lib/documents";
import { rupees } from "@/lib/purchasing";
import { Barcode } from "./barcode";

type TemplateLook = Pick<LabelTemplateDto, "width" | "height" | "fields" | "fontSize">;

/** One label: only the template's fields, at its text size. */
export function LabelView({ label, template }: { label: LabelDto; template: TemplateLook }) {
  const has = (f: LabelField) => template.fields.includes(f);
  const extras = [
    has("code") ? label.code : null,
    has("unit") && label.unit ? label.unit : null,
    has("batch") && label.batch ? `Batch ${label.batch}` : null,
    has("packed") && label.packed ? `Pkd ${formatDate(label.packed)}` : null,
    has("expiry") && label.expiry ? `Exp ${formatDate(label.expiry)}` : null,
  ].filter((x): x is string => !!x);
  const price = has("price") && label.price ? label.price : null;
  const mrp = has("mrp") && label.mrp ? label.mrp : null;
  return (
    <div className="label" style={{ width: `${template.width}mm`, height: `${template.height}mm`, fontSize: `${template.fontSize}pt` }}>
      {has("store") && label.store ? <div className="label-small label-line">{label.store}</div> : null}
      {has("name") ? <div className="label-name">{label.name}</div> : null}
      {price || mrp ? (
        <div className="label-prices">
          {price && label.wasPrice ? (
            <span className="label-small">
              Was <s>{rupees(label.wasPrice)}</s>
            </span>
          ) : null}
          {price ? <span className="label-price">{price && label.wasPrice ? `Now ${rupees(price)}` : rupees(price)}</span> : null}
          {mrp ? <span className="label-small">MRP {rupees(mrp)}</span> : null}
        </div>
      ) : null}
      {has("barcode") && label.barcode ? (
        <div className="label-barcode">
          <Barcode barcode={label.barcode} />
        </div>
      ) : null}
      {extras.length ? <div className="label-small label-line">{extras.join(" · ")}</div> : null}
    </div>
  );
}

/** Every label, on A4 sheets or a roll, ready to print. `skip` leaves spaces empty on a part-used first sheet. */
export function LabelSheets({ data, skip = 0 }: { data: LabelDataDto; skip?: number }) {
  const t = data.template;
  if (t.media === "roll") {
    return (
      <div className="label-roll">
        {data.labels.map((l, i) => (
          <div key={i} className="label-roll-page" style={{ width: `${t.width}mm`, height: `calc(${t.height}mm - 0.4mm)` }}>
            <LabelView label={l} template={t} />
          </div>
        ))}
      </div>
    );
  }
  const layout = sheetLayout(t);
  const sheets = sheetsOf(data.labels, layout.perSheet, skip);
  return (
    <div className="label-sheets">
      {sheets.map((sheet, s) => (
        <div key={s} className="label-sheet" role="group" aria-label={`Sheet ${s + 1} of ${sheets.length}`}>
          {sheet.map((l, i) => {
            const row = Math.floor(i / layout.across);
            const col = i % layout.across;
            return (
              <div
                key={i}
                className={l ? "label-slot" : "label-slot label-slot-empty"}
                style={{
                  left: `${layout.marginLeft + col * (t.width + layout.gapX)}mm`,
                  top: `${layout.marginTop + row * (t.height + layout.gapY)}mm`,
                  width: `${t.width}mm`,
                  height: `${t.height}mm`,
                }}
              >
                {l ? <LabelView label={l} template={t} /> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The paper for printing labels: A4 with no margins, or the label's own size on a roll. */
export function LabelPageStyle({ template }: { template: Pick<LabelTemplateDto, "media" | "width" | "height"> }) {
  const size = template.media === "roll" ? `${template.width}mm ${template.height}mm` : "A4 portrait";
  return <style>{`@media print { @page { size: ${size}; margin: 0; } }`}</style>;
}
