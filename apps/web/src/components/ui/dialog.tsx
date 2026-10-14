// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <Button variant="link" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
