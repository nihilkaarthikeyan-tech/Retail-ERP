// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { use, useEffect, useRef, useState } from "react";
import { PRINT_KINDS } from "shared";
import { DocumentPageStyle, PrintDocument } from "@/components/documents/print-document";
import { Alert, Button } from "@/components/ui";
import { api, API_URL } from "@/lib/api";
import type { PrintDocumentDto } from "@/lib/documents";
import { useLoad } from "@/lib/use-load";

function decoded(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Closes the print tab; when the browser will not, goes back instead. */
function closeTab() {
  window.close();
  setTimeout(() => {
    if (!window.closed && window.history.length > 1) window.history.back();
  }, 150);
}

/** Loads a document's print data (GET /print/:kind/:id) and opens the browser's print window. */
export function PrintPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const docId = decoded(id);
  const known = (PRINT_KINDS as readonly string[]).includes(kind);
  const doc = useLoad<PrintDocumentDto | null>(() => (known ? api.get<PrintDocumentDto>(`/print/${kind}/${encodeURIComponent(docId)}`) : Promise.resolve(null)), [kind, docId, known]);
  const [logoDone, setLogoDone] = useState(false);
  const printed = useRef(false);
  const d = doc.data;
  const waitForLogo = !!d?.letterhead.showLogo && !logoDone;

  useEffect(() => {
    if (d) document.title = `${d.title}${d.number ? ` ${d.number}` : ""}`;
  }, [d]);

  // A logo that never answers must not hold the print window back.
  useEffect(() => {
    if (!waitForLogo) return;
    const t = setTimeout(() => setLogoDone(true), 4000);
    return () => clearTimeout(t);
  }, [waitForLogo]);

  // Open the print window once, after the page (and its logo) has been drawn.
  useEffect(() => {
    if (!d || waitForLogo) return;
    const t = setTimeout(() => {
      if (printed.current) return;
      printed.current = true;
      window.print();
    }, 300);
    return () => clearTimeout(t);
  }, [d, waitForLogo]);

  if (!known) {
    return (
      <div className="doc-wait">
        <Alert kind="error">This kind of document cannot be printed.</Alert>
      </div>
    );
  }
  if (doc.error) {
    return (
      <div className="doc-wait">
        <Alert kind="error">{doc.error}</Alert>
        <Button onClick={closeTab}>Close</Button>
      </div>
    );
  }
  if (!d) return <p className="doc-wait">Getting the document ready…</p>;

  return (
    <>
      <DocumentPageStyle paper={d.paper} />
      <div className="doc-toolbar doc-no-print">
        <span>
          <strong>{d.title}</strong>
          {d.number ? <span className="mono"> {d.number}</span> : null}
          <span className="muted"> · {d.paper} paper</span>
        </span>
        <span className="spacer" />
        <Button variant="primary" onClick={() => window.print()}>
          Print / save as PDF
        </Button>
        <Button onClick={closeTab}>Close</Button>
      </div>
      <PrintDocument doc={d} logoUrl={d.letterhead.showLogo ? `${API_URL}/print/logo` : null} onLogoSettled={() => setLogoDone(true)} />
    </>
  );
}
