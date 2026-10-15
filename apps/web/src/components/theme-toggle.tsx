// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { type Theme, THEME_STORAGE_KEY } from "@/lib/theme";

const CHANGE_EVENT = "themechange";

function currentTheme(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Light/dark switch for the top bar. The choice is kept in this browser only. */
export function ThemeToggle() {
  // The server cannot know the theme; null renders a neutral label until the browser answers.
  const theme = useSyncExternalStore<Theme | null>(subscribe, currentTheme, () => null);

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode); the switch still works for this visit.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  const goingTo: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="btn btn-small" onClick={toggle} aria-label={`Switch to ${goingTo} mode`}>
      <Icon name={goingTo === "dark" ? "moon" : "sun"} size={15} />
      {goingTo === "dark" ? "Dark" : "Light"}
    </button>
  );
}
