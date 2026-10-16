// Copyright (c) 2026, Rademics. All rights reserved.
// A barcode drawn as SVG from the API's modules ("1" = bar). One module is one
// unit of the drawing, so every bar keeps its exact width at any size. The
// quiet zones (blank margins scanners need) are part of the drawing; EAN-13
// and EAN-8 show their digits in the usual style, under the halves with the
// guard bars running down between them.
import { barRuns, type BarcodeDto, eanDigits, quietZones } from "@/lib/documents";

interface BarcodeProps {
  barcode: BarcodeDto;
  /** Height of the drawing as a share of its width (bars and text together). */
  ratio?: number;
  /** Print the human-readable text under the bars. */
  showText?: boolean;
  className?: string;
}

/** EAN digits are 8 modules tall; Code 128 text grows with a long code so it stays readable. */
function textSize(symbology: BarcodeDto["symbology"], width: number): number {
  return symbology === "CODE128" ? Math.min(16, Math.max(8, Math.round(width * 0.06))) : 8;
}

export function Barcode({ barcode, ratio = 0.36, showText = true, className }: BarcodeProps) {
  const quiet = quietZones(barcode.symbology);
  const runs = barRuns(barcode.modules, barcode.symbology);
  const width = quiet.left + barcode.modules.length + quiet.right;
  const textHeight = textSize(barcode.symbology, width);
  const height = Math.max(textHeight * 2.5, Math.round(width * ratio));
  const digits = showText ? eanDigits(barcode) : null;
  const barBottom = showText ? height - textHeight - 1 : height;
  // EAN guard bars run down to the middle of the digits.
  const guardBottom = digits ? height - textHeight / 2 : barBottom;
  return (
    <svg
      className={["barcode", className ?? ""].filter(Boolean).join(" ")}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Barcode ${barcode.text}`}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={width} height={height} fill="#fff" className="barcode-paper" />
      {runs.map((r) => (
        <rect key={r.x} className="barcode-bar" x={quiet.left + r.x} y={0} width={r.width} height={r.guard ? guardBottom : barBottom} fill="#000" />
      ))}
      {showText ? (
        digits ? (
          digits.map((d, i) => (
            <text key={i} x={quiet.left + d.x} y={height - 0.5} textAnchor="middle" fontSize={textHeight} fontFamily="Consolas, 'Courier New', monospace" fill="#000">
              {d.ch}
            </text>
          ))
        ) : (
          <text x={width / 2} y={height - 0.5} textAnchor="middle" fontSize={textHeight} fontFamily="Consolas, 'Courier New', monospace" fill="#000">
            {barcode.text}
          </text>
        )
      ) : null}
    </svg>
  );
}
