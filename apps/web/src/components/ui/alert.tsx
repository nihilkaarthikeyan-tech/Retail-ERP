// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { type ReactNode, useEffect } from "react";
import { useToast } from "./toast";

interface AlertProps {
  kind?: "error" | "success" | "info";
  children: ReactNode;
}

/** A plain "… saved." confirmation: shown as a short note that fades, not a box that stays. */
function isSavedNote(children: ReactNode): children is string {
  return typeof children === "string" && /\bsaved\.$/i.test(children.trim());
}

/** A short "saved" note, pushed once per message while the page shows it. */
function SavedToast({ text, show }: { text: string; show: (t: ReactNode) => void }) {
  useEffect(() => {
    show(text);
  }, [text, show]);
  return null;
}

/**
 * A short message box. Errors are announced to screen readers. Inside the app
 * (where a ToastProvider exists) a plain "… saved." success message becomes a
 * fading note in the corner; other messages stay in place.
 */
export function Alert({ kind = "info", children }: AlertProps) {
  const toast = useToast();
  if (children === null || children === undefined || children === "") return null;
  if (kind === "success" && toast && isSavedNote(children)) return <SavedToast text={children} show={toast.show} />;
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
