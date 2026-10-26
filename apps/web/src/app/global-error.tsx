// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

/** The last safety net, if even the page frame fails: plain HTML, no styles to depend on. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Segoe UI, Arial, sans-serif", margin: 0, padding: "80px 24px", color: "#0a0a0a", background: "#ffffff" }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <p style={{ fontWeight: 600 }}>Retail ERP</p>
          <h1 style={{ fontSize: 32, fontWeight: 500, margin: "16px 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#5c6067", lineHeight: 1.6 }}>Nothing you saved before this is lost. Please try again.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: "10px 22px", borderRadius: 999, border: "none", background: "#1f4ea3", color: "#ffffff", fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
