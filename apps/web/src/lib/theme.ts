// Copyright (c) 2026, Rademics. All rights reserved.
// Light, dark or "follow the system", kept in this browser only (see ThemeToggle).
// A first-time visitor sees light mode (owner, 23 October 2026).

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs before the page paints (inlined in the root layout) so a saved choice
 * never flashes the other theme. "dark" sets dark; "system" removes the
 * attribute so the operating system's setting wins; anything else is light.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var h=document.documentElement;if(t==="dark")h.dataset.theme="dark";else if(t==="system")delete h.dataset.theme;else h.dataset.theme="light"}catch(e){}`;
