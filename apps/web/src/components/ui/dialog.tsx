// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FORM_PROBLEM_EVENT } from "@/lib/validation";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** The first box to type in: one marked data-autofocus or autoFocus, else the first field of the body. */
function firstField(el: HTMLElement): HTMLElement | null {
  return (
    el.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ??
    el.querySelector<HTMLElement>(".dialog-body input:not([type=hidden]):not([disabled]), .dialog-body select:not([disabled]), .dialog-body textarea:not([disabled])")
  );
}

/**
 * Modal built on the native <dialog>; closes on Escape and the close button. Audit 9: it opens with
 * the cursor in its first box (it was on the close button, so a typed PIN went nowhere and Enter
 * closed the dialog), and the cursor goes back where it was when it closes (the till's scan box).
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A form problem not tied to one field ("End date cannot be before start date"): shown here,
  // because a modal hides the corner notes. Cleared when the person changes something.
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onProblem = (e: Event) => setProblem((e as CustomEvent<string>).detail);
    window.addEventListener(FORM_PROBLEM_EVENT, onProblem);
    return () => {
      window.removeEventListener(FORM_PROBLEM_EVENT, onProblem);
      setProblem(null);
    };
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    // React's autoFocus runs before the dialog is shown, so the first box is focused here.
    (firstField(el) ?? el).focus();
    return () => {
      // Back to where the person was, once the dialog has gone.
      setTimeout(() => {
        if (opener && opener.isConnected && !document.querySelector("dialog[open]")) opener.focus();
      }, 0);
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(e) => {
        // A dialog opened from inside another one closes on its own (the event would reach the outer one).
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
      onClose={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onInput={() => setProblem(null)}
      onChange={() => setProblem(null)}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <Button variant="link" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="dialog-body">
        {problem ? (
          <div className="alert alert-error" role="alert">
            {problem}
          </div>
        ) : null}
        {children}
      </div>
    </dialog>
  );
}
