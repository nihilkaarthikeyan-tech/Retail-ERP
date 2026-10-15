// Copyright (c) 2026, Rademics. All rights reserved.
// Light/dark choice, kept in this browser only (see ThemeToggle).

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs before the page paints (inlined in the root layout) so a saved choice
 * never flashes the other theme. Without a saved choice the system setting wins.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
