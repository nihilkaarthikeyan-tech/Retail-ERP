// Copyright (c) 2026, Rademics. All rights reserved.
// Small charts drawn with our own SVG (plan 09 §6: no chart library). Thin
// marks with a 4px rounded data end, hairline grid, one value axis, a hover
// tooltip, and a table twin of every chart: hidden for screen readers by
// default, shown on the "Show as table" switch. Colours come from the
// --chart-* tokens (validated for colour blindness in light and dark) or the
// page's area colour for a single series.
"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Decimal } from "shared";
import { compactValue, fraction, fullValue, niceScale, type ValueKind } from "@/lib/reports";

export interface Datum {
  label: string;
  value: string;
}

export interface SeriesDatum {
  label: string;
  values: Record<string, string>;
}

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, normally var(--chart-N). */
  color: string;
}

/** The colour of a single series: the page's area colour, else the first chart colour. */
export const SINGLE_COLOR = "var(--area, var(--chart-1))";
const SLOTS = 8;

/**
 * Series in a fixed order (the order given), each with its own slot colour.
 * Past eight, the smallest are folded into "Other" so no colour is reused.
 */
export function seriesFor(keys: string[], data: SeriesDatum[], labelOf: (k: string) => string = (k) => k): { series: Series[]; data: SeriesDatum[] } {
  if (keys.length <= SLOTS) return { series: keys.map((k, i) => ({ key: k, label: labelOf(k), color: `var(--chart-${i + 1})` })), data };
  const total = (k: string) => data.reduce((s, d) => s.add(toDec(d.values[k])), new Decimal(0));
  const keep = [...keys].sort((a, b) => total(b).cmp(total(a))).slice(0, SLOTS - 1);
  const kept = keys.filter((k) => keep.includes(k));
  const folded = data.map((d) => {
    const values: Record<string, string> = {};
    let other = new Decimal(0);
    for (const [k, v] of Object.entries(d.values)) {
      if (kept.includes(k)) values[k] = v;
      else other = other.add(toDec(v));
    }
    values.__other = other.toFixed(2);
    return { label: d.label, values };
  });
  return {
    series: [...kept.map((k, i) => ({ key: k, label: labelOf(k), color: `var(--chart-${i + 1})` })), { key: "__other", label: "Other", color: "var(--chart-other)" }],
    data: folded,
  };
}

function toDec(v: string | null | undefined): Decimal {
  try {
    return new Decimal(v ?? 0);
  } catch {
    return new Decimal(0);
  }
}

/** Width of the element, following resizes (a sensible width where it cannot be measured, as in tests). */
function useWidth(fallback = 520) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Tip {
  x: number;
  y: number;
  heading: string;
  lines: { label?: string; value: string; color?: string }[];
}

interface FrameProps {
  title: string;
  /** Shown under the title (for example "before GST"). */
  note?: string;
  legend?: Series[];
  /** Show the legend even for one series (when the series is a named thing, such as a store). */
  legendAlways?: boolean;
  table: { head: string[]; rows: string[][]; numeric: boolean[] };
  empty: boolean;
  emptyText: string;
  children: (width: number, tip: { show: (t: Tip) => void; hide: () => void }) => ReactNode;
}

/** Title, legend, plot, tooltip and the table twin shared by every chart. */
function ChartFrame({ title, note, legend, legendAlways, table, empty, emptyText, children }: FrameProps) {
  const id = useId();
  const [ref, width] = useWidth();
  const [asTable, setAsTable] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const api = { show: setTip, hide: () => setTip(null) };
  const tipLeft = tip ? Math.min(Math.max(tip.x, 70), width - 70) : 0;

  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <div className="chart-head">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {note ? <p className="chart-note">{note}</p> : null}
        </div>
        {!empty ? (
          <button type="button" className="btn btn-link btn-small chart-switch" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Show as chart" : "Show as table"}
          </button>
        ) : null}
      </div>
      {legend && (legend.length > 1 || legendAlways) && !asTable && !empty ? (
        <ul className="chart-legend">
          {legend.map((s) => (
            <li key={s.key}>
              <span className="chart-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={ref} className="chart-plot" hidden={asTable || empty} onPointerLeave={() => setTip(null)}>
        {!empty ? children(width, api) : null}
        {tip ? (
          <div className="chart-tip" style={{ left: tipLeft, top: tip.y }} aria-hidden="true">
            <div className="chart-tip-head">{tip.heading}</div>
            {tip.lines.map((l, i) => (
              <div key={i} className="chart-tip-line">
                {l.color ? <span className="chart-tip-key" style={{ background: l.color }} /> : null}
                <strong>{l.value}</strong>
                {l.label ? <span className="muted"> {l.label}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {empty ? <p className="chart-empty">{emptyText}</p> : null}
      <div className={asTable ? "table-wrap chart-table" : "sr-only"}>
        <table className="table">
          <caption className={asTable ? "sr-only" : undefined}>{title}</caption>
          <thead>
            <tr>
              {table.head.map((h, i) => (
                <th key={i} scope="col" className={table.numeric[i] ? "num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={table.head.length}>{emptyText}</td>
              </tr>
            ) : (
              table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={table.numeric[j] ? "num" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

// ---- Bar and column shapes: square at the baseline, 4px rounded at the data end ----

function hBarPath(x0: number, x1: number, y: number, h: number): string {
  const len = Math.abs(x1 - x0);
  if (len < 0.5) return "";
  const r = Math.min(4, h / 2, len);
  const s = x1 >= x0 ? 1 : -1;
  return `M${x0},${y}H${x1 - s * r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - s * r},${y + h}H${x0}Z`;
}

function vBarPath(x: number, w: number, y0: number, y1: number, rounded = true): string {
  const len = Math.abs(y1 - y0);
  if (len < 0.5) return "";
  if (!rounded) return `M${x},${y0}V${y1}H${x + w}V${y0}Z`;
  const r = Math.min(4, w / 2, len);
  const s = y1 <= y0 ? 1 : -1;
  return `M${x},${y0}V${y1 + s * r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + s * r}V${y0}Z`;
}

/** Cuts a label to roughly fit a width (about 6.6px a character at 12px). */
function fit(text: string, px: number): string {
  const max = Math.max(3, Math.floor(px / 6.6));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ---- Horizontal bars: ranked lists with long names ----

interface BarChartProps {
  title: string;
  note?: string;
  data: Datum[];
  kind: ValueKind;
  color?: string;
  emptyText?: string;
  /** The header of the label column in the table twin. */
  labelHeader?: string;
  valueHeader?: string;
}

export function BarChart({ title, note, data, kind, color = SINGLE_COLOR, emptyText = "Nothing to show yet.", labelHeader = "Name", valueHeader = "Value" }: BarChartProps) {
  const values = data.map((d) => toDec(d.value));
  const empty = data.length === 0 || values.every((v) => v.isZero());
  const table = { head: [labelHeader, valueHeader], rows: data.map((d) => [d.label, fullValue(d.value, kind)]), numeric: [false, true] };
  return (
    <ChartFrame title={title} note={note} table={table} empty={empty} emptyText={emptyText}>
      {(width, tip) => {
        const row = 30;
        const thick = 16;
        const labelW = Math.min(170, Math.max(80, Math.round(width * 0.34)));
        const valueW = 100;
        const plotX = labelW + 8;
        const plotW = Math.max(40, width - plotX - valueW - 8);
        const lo = Decimal.min(0, ...values);
        const hi = Decimal.max(0, ...values);
        const x = (v: Decimal) => plotX + fraction(v, lo, hi.eq(lo) ? lo.add(1) : hi) * plotW;
        const zero = x(new Decimal(0));
        const height = data.length * row + 4;
        return (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
            {lo.lt(0) ? <line x1={zero} x2={zero} y1={0} y2={height} className="chart-axis" /> : null}
            {data.map((d, i) => {
              const y = i * row + (row - thick) / 2;
              const v = values[i];
              return (
                <g key={`${d.label}-${i}`} className="chart-mark">
                  <text x={labelW} y={y + thick / 2} dy="0.35em" textAnchor="end" className="chart-label">
                    {fit(d.label, labelW)}
                  </text>
                  <path d={hBarPath(zero, x(v), y, thick)} style={{ fill: color }} />
                  <text x={width - 4} y={y + thick / 2} dy="0.35em" textAnchor="end" className="chart-value">
                    {fullValue(d.value, kind)}
                  </text>
                  <rect
                    x={0}
                    y={i * row}
                    width={width}
                    height={row}
                    className="chart-hit"
                    onPointerMove={() => tip.show({ x: Math.max(x(v), zero), y: i * row + 2, heading: d.label, lines: [{ value: fullValue(d.value, kind) }] })}
                  />
                </g>
              );
            })}
          </svg>
        );
      }}
    </ChartFrame>
  );
}

// ---- Vertical columns: one series, or several stacked or side by side ----

interface ColumnChartProps {
  title: string;
  note?: string;
  data: SeriesDatum[];
  series: Series[];
  mode?: "stacked" | "grouped";
  kind: ValueKind;
  xLabel?: (label: string) => string;
  emptyText?: string;
  labelHeader?: string;
  legendAlways?: boolean;
}

const AXIS_W = 52;
const X_AXIS_H = 24;
const PLOT_H = 170;

/** Hairline gridlines and value-axis labels. */
function ValueAxis({ ticks, y, width, kind }: { ticks: Decimal[]; y: (v: Decimal) => number; width: number; kind: ValueKind }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t.toString()}>
          <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} className={t.isZero() ? "chart-axis" : "chart-gridline"} />
          <text x={AXIS_W - 6} y={y(t)} dy="0.35em" textAnchor="end" className="chart-tick">
            {compactValue(t, kind)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function ColumnChart({ title, note, data, series, mode = "stacked", kind, xLabel = (l) => l, emptyText = "Nothing to show yet.", labelHeader = "Period", legendAlways }: ColumnChartProps) {
  const cell = (d: SeriesDatum, s: Series) => toDec(d.values[s.key]);
  const empty = data.length === 0 || data.every((d) => series.every((s) => cell(d, s).isZero()));
  const single = series.length === 1;
  const table = {
    head: [labelHeader, ...series.map((s) => s.label), ...(single ? [] : ["Total"])],
    rows: data.map((d) => [xLabel(d.label), ...series.map((s) => fullValue(d.values[s.key] ?? "0", kind)), ...(single ? [] : [fullValue(series.reduce((t, s) => t.add(cell(d, s)), new Decimal(0)).toFixed(2), kind)])]),
    numeric: [false, ...series.map(() => true), ...(single ? [] : [true])],
  };
  return (
    <ChartFrame title={title} note={note} legend={series} legendAlways={legendAlways} table={table} empty={empty} emptyText={emptyText}>
      {(width, tip) => {
        let min = new Decimal(0);
        let max = new Decimal(0);
        for (const d of data) {
          if (mode === "stacked") {
            const pos = series.reduce((t, s) => (cell(d, s).gt(0) ? t.add(cell(d, s)) : t), new Decimal(0));
            const neg = series.reduce((t, s) => (cell(d, s).lt(0) ? t.add(cell(d, s)) : t), new Decimal(0));
            max = Decimal.max(max, pos);
            min = Decimal.min(min, neg);
          } else {
            for (const s of series) {
              max = Decimal.max(max, cell(d, s));
              min = Decimal.min(min, cell(d, s));
            }
          }
        }
        const scale = niceScale(min, max, kind);
        const top = 8;
        const y = (v: Decimal) => top + (1 - fraction(v, scale.lo, scale.hi)) * PLOT_H;
        const plotW = Math.max(60, width - AXIS_W - 4);
        const slot = plotW / data.length;
        const groupW = Math.min(mode === "grouped" ? 24 * series.length + 2 * (series.length - 1) : 24, slot * 0.7);
        const barW = mode === "grouped" ? Math.max(2, (groupW - 2 * (series.length - 1)) / series.length) : groupW;
        const height = top + PLOT_H + X_AXIS_H;
        // Show every n-th period label so they never collide.
        const longest = Math.max(...data.map((d) => xLabel(d.label).length));
        const every = Math.max(1, Math.ceil((longest * 6.6 + 8) / slot));
        return (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
            <ValueAxis ticks={scale.ticks} y={y} width={width} kind={kind} />
            {data.map((d, i) => {
              const cx = AXIS_W + slot * i + slot / 2;
              const x0 = cx - groupW / 2;
              let up = new Decimal(0);
              let down = new Decimal(0);
              const lastUp = mode === "stacked" ? [...series].reverse().find((s) => cell(d, s).gt(0))?.key : undefined;
              const lastDown = mode === "stacked" ? [...series].reverse().find((s) => cell(d, s).lt(0))?.key : undefined;
              return (
                <g key={`${d.label}-${i}`} className="chart-mark">
                  {series.map((s, j) => {
                    const v = cell(d, s);
                    if (v.isZero()) return null;
                    if (mode === "grouped") {
                      return <path key={s.key} d={vBarPath(x0 + j * (barW + 2), barW, y(new Decimal(0)), y(v))} style={{ fill: s.color }} />;
                    }
                    // Stacked: positives up, negatives down, with a 2px surface gap between segments.
                    const from = v.gt(0) ? up : down;
                    const to = from.add(v);
                    if (v.gt(0)) up = to;
                    else down = to;
                    const gap = from.isZero() ? 0 : v.gt(0) ? -2 : 2;
                    const y0 = y(from) + gap;
                    const y1 = y(to);
                    // A segment thinner than the gap is left to the tooltip and the table.
                    if (v.gt(0) ? y1 >= y0 : y1 <= y0) return null;
                    const outer = s.key === (v.gt(0) ? lastUp : lastDown);
                    return <path key={s.key} d={vBarPath(x0, barW, y0, y1, outer)} style={{ fill: s.color }} />;
                  })}
                  {i % every === 0 ? (
                    <text x={cx} y={top + PLOT_H + 16} textAnchor="middle" className="chart-tick">
                      {xLabel(d.label)}
                    </text>
                  ) : null}
                  <rect
                    x={AXIS_W + slot * i}
                    y={0}
                    width={slot}
                    height={top + PLOT_H}
                    className="chart-hit"
                    onPointerMove={() =>
                      tip.show({
                        x: cx,
                        y: top + PLOT_H / 2,
                        heading: xLabel(d.label),
                        lines: single
                          ? [{ value: fullValue(d.values[series[0].key] ?? "0", kind) }]
                          : series.filter((s) => d.values[s.key] !== undefined).map((s) => ({ label: s.label, value: fullValue(d.values[s.key], kind), color: s.color })),
                      })
                    }
                  />
                </g>
              );
            })}
          </svg>
        );
      }}
    </ChartFrame>
  );
}

// ---- Line: one series over time, with a soft wash and a crosshair ----

interface LineChartProps {
  title: string;
  note?: string;
  data: Datum[];
  kind: ValueKind;
  color?: string;
  xLabel?: (label: string) => string;
  emptyText?: string;
  labelHeader?: string;
  valueHeader?: string;
}

export function LineChart({ title, note, data, kind, color = SINGLE_COLOR, xLabel = (l) => l, emptyText = "Nothing to show yet.", labelHeader = "Date", valueHeader = "Value" }: LineChartProps) {
  const values = data.map((d) => toDec(d.value));
  const empty = data.length === 0;
  const table = { head: [labelHeader, valueHeader], rows: data.map((d) => [xLabel(d.label), fullValue(d.value, kind)]), numeric: [false, true] };
  const [hover, setHover] = useState<number | null>(null);
  return (
    <ChartFrame title={title} note={note} table={table} empty={empty} emptyText={emptyText}>
      {(width, tip) => {
        const scale = niceScale(Decimal.min(0, ...values), Decimal.max(0, ...values), kind);
        const top = 14;
        const right = 12;
        const y = (v: Decimal) => top + (1 - fraction(v, scale.lo, scale.hi)) * PLOT_H;
        const plotW = Math.max(60, width - AXIS_W - right - 6);
        const x = (i: number) => AXIS_W + 6 + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
        const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        const base = y(Decimal.max(scale.lo, 0));
        const line = `M${points.join("L")}`;
        const area = `${line}L${x(data.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;
        const height = top + PLOT_H + X_AXIS_H;
        const last = data.length - 1;
        // Evenly spaced period labels that never collide, always including the last.
        const labelW = Math.max(...data.map((d) => xLabel(d.label).length)) * 6.6 + 12;
        const labelCount = Math.max(2, Math.floor(plotW / labelW) + 1);
        const step = data.length <= labelCount ? 1 : Math.ceil(last / (labelCount - 1));
        const labelled = new Set<number>();
        for (let i = 0; i <= last; i += step) labelled.add(i);
        if (!labelled.has(last)) {
          const before = Math.max(...labelled);
          if (((last - before) * plotW) / last < labelW && before !== 0) labelled.delete(before);
          labelled.add(last);
        }
        const nearest = (px: number) => Math.min(last, Math.max(0, Math.round(((px - AXIS_W - 6) / plotW) * Math.max(1, last))));
        return (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            focusable="false"
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const i = data.length === 1 ? 0 : nearest(e.clientX - box.left);
              setHover(i);
              tip.show({ x: x(i), y: Math.min(y(values[i]), top + PLOT_H - 40), heading: xLabel(data[i].label), lines: [{ value: fullValue(data[i].value, kind) }] });
            }}
            onPointerLeave={() => setHover(null)}
          >
            <ValueAxis ticks={scale.ticks} y={y} width={width - right} kind={kind} />
            <path d={area} style={{ fill: color }} className="chart-wash" />
            <path d={line} style={{ stroke: color }} className="chart-line" />
            {data.map((d, i) =>
              labelled.has(i) ? (
                <text key={`${d.label}-${i}`} x={x(i)} y={top + PLOT_H + 16} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="chart-tick">
                  {xLabel(d.label)}
                </text>
              ) : null,
            )}
            {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + PLOT_H} className="chart-cross" /> : null}
            <circle cx={x(hover ?? last)} cy={y(values[hover ?? last])} r={4} style={{ fill: color }} className="chart-dot" />
            {hover === null ? (
              <text x={x(last) - 6} y={y(values[last]) - 10} textAnchor="end" className="chart-value">
                {compactValue(values[last], kind)}
              </text>
            ) : null}
          </svg>
        );
      }}
    </ChartFrame>
  );
}
