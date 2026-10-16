// Copyright (c) 2026, Rademics. All rights reserved.
// Headline figures on the dashboards: the value, the change against the
// previous period of the same length (plan 09 §4) and an optional hint.
import { changeParts, type DashboardTile, formatFigure, tidyHint, UP_IS_BAD } from "@/lib/reports";

export function StatTile({ tile }: { tile: DashboardTile }) {
  // The API sends the comparison only for figures that have one.
  const compared = "changePercent" in tile || "previous" in tile;
  return (
    <div className="tile">
      <p className="tile-label">{tile.label}</p>
      <p className="tile-value">{formatFigure(tile.value, tile.format)}</p>
      {compared ? <Change tile={tile} /> : null}
      {tile.hint ? <p className="tile-hint">{tidyHint(tile.hint)}</p> : null}
    </div>
  );
}

function Change({ tile }: { tile: DashboardTile }) {
  const { direction, text } = changeParts(tile.changePercent);
  if (direction === "new") {
    return (
      <p className="tile-change tile-change-new">
        <span className="tile-new">new</span> <span className="muted">nothing in the previous period</span>
      </p>
    );
  }
  const good = direction === "flat" ? null : (direction === "up") !== UP_IS_BAD.has(tile.key);
  const tone = good === null ? "tile-change-flat" : good ? "tile-change-good" : "tile-change-bad";
  const previous = tile.previous != null ? ` (${formatFigure(tile.previous, tile.format)})` : "";
  return (
    <p className={`tile-change ${tone}`}>
      {direction === "up" ? <span aria-hidden="true">▲ </span> : direction === "down" ? <span aria-hidden="true">▼ </span> : null}
      <span className="sr-only">{direction === "up" ? "Up " : direction === "down" ? "Down " : "No change, "}</span>
      <strong>{text}</strong> <span className="muted">vs previous period{previous}</span>
    </p>
  );
}

export function TileGrid({ tiles }: { tiles: DashboardTile[] }) {
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <StatTile key={t.key} tile={t} />
      ))}
    </div>
  );
}
