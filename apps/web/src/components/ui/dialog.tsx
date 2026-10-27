// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FORM_PROBLEM_EVENT } from "@/lib/validation";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Modal built on the native <dialog>; closes on Escape and the close button. */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
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
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onInput={() => setProblem(null)}
      onChange={() => setProblem(null)}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
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
