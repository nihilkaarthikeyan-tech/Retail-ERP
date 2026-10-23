// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import { type Theme, THEME_STORAGE_KEY } from "@/lib/theme";

const CHANGE_EVENT = "themechange";

/** What is chosen: light, dark, or follow the system. */
function currentChoice(): Theme {
  const picked = document.documentElement.dataset.theme;
  return picked === "dark" ? "dark" : picked === "light" ? "light" : "system";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

const OPTIONS: { value: Theme; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

/** Light / Dark / System, three small buttons. The choice is kept in this browser only. */
export function ThemeToggle() {
  // The server cannot know the choice; "light" matches what a first-time visitor sees.
  const choice = useSyncExternalStore<Theme>(subscribe, currentChoice, () => "light");

  function choose(next: Theme) {
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode); the switch still works for this visit.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={choice === o.value} aria-label={`${o.label} mode`} title={o.label} className={choice === o.value ? "is-on" : undefined} onClick={() => choose(o.value)}>
          <Icon name={o.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
