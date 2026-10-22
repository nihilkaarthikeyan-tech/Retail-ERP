// Copyright (c) 2026, Rademics. All rights reserved.
// The Retail ERP mark ("Tiles", chosen by the owner on 22 October 2026): four
// tiles, one of them round and marigold. The three square tiles take the page's
// primary colour, so the mark works in light and dark mode. The same shape is
// the browser-tab icon (app/icon.svg).

/** The logo mark, drawn at `size` px. Decorative next to the name; the name is the text. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <rect x="6" y="6" width="23" height="23" rx="6" fill="currentColor" />
      <rect x="35" y="6" width="23" height="23" rx="6" fill="currentColor" />
      <rect x="6" y="35" width="23" height="23" rx="6" fill="currentColor" />
      <rect x="35" y="35" width="23" height="23" rx="11.5" fill="#f2b705" />
    </svg>
  );
}
