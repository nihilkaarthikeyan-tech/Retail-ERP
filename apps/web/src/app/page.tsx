// Copyright (c) 2026, Rademics. All rights reserved.
import { SystemStatus } from "@/components/system-status";

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px" }}>
      <h1>Retail ERP</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>
        Development setup. No business features yet.
      </p>
      <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>System status</h2>
      <SystemStatus />
      <style>{`
        .status { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
        .status dt { font-weight: 600; }
        .status .ok { color: var(--ok); }
        .status .error { color: var(--error); }
      `}</style>
    </main>
  );
}
