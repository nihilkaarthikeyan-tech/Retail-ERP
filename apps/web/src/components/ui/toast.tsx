// Copyright (c) 2026, Rademics. All rights reserved.
// Short "Saved" messages (owner, 23 October 2026): a small note in the bottom
// corner that goes away by itself, instead of a box that stays on the page.
"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FORM_PROBLEM_EVENT } from "@/lib/validation";

export interface Toast {
  id: number;
  text: ReactNode;
  kind: "success" | "info" | "error";
}

interface ToastApi {
  show: (text: ReactNode, kind?: Toast["kind"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a note stays, in milliseconds. */
const STAY = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((all) => all.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (text: ReactNode, kind: Toast["kind"] = "success") => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, text, kind }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), STAY),
      );
    },
    [dismiss],
  );

  // A form problem not tied to one field (see issuesToFieldErrors).
  useEffect(() => {
    // An open pop-up shows the problem itself (it would hide this note).
    const onProblem = (e: Event) => {
      if (!document.querySelector("dialog[open]")) show((e as CustomEvent<string>).detail, "error");
    };
    window.addEventListener(FORM_PROBLEM_EVENT, onProblem);
    return () => window.removeEventListener(FORM_PROBLEM_EVENT, onProblem);
  }, [show]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
      all.clear();
    };
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** The toast API, or null outside a provider (public pages show messages inline instead). */
export function useToast(): ToastApi | null {
  return useContext(ToastContext);
}
