// Copyright (c) 2026, Rademics. All rights reserved.
// Registers public/till-sw.js for the till pages only (scope /till), so the
// till still opens when the server cannot be reached (pos-offline plan §1).
"use client";

import { useEffect } from "react";

export function TillServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/till-sw.js", { scope: "/till" }).catch(() => {
      // Without it the till still works while the page stays open.
    });
  }, []);
  return null;
}
