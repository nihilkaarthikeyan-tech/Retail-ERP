// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import type { CurrentUser, ModuleKey } from "shared";
import { Icon } from "@/components/icons";
import { areaOf, isActive, type MenuEntry, visibleMenu } from "@/lib/menu";
import { useModules } from "@/lib/modules";

interface AppMenuProps {
  user: CurrentUser | null;
  pathname: string;
  /** The company's modules (plan 12); defaults to the loaded map, where every module is on until known. */
  modules?: Partial<Record<ModuleKey, boolean>>;
}

/** Entries grouped under their section heading, keeping the menu's order. */
function groupBySection(entries: MenuEntry[]): { section: string | undefined; entries: MenuEntry[] }[] {
  const groups: { section: string | undefined; entries: MenuEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.section === entry.section) last.entries.push(entry);
    else groups.push({ section: entry.section, entries: [entry] });
  }
  return groups;
}

/** Left-hand menu: only the pages the user has rights for (and whose module is on), coloured by area of the shop. */
export function AppMenu({ user, pathname, modules }: AppMenuProps) {
  const loaded = useModules().modules;
  const groups = groupBySection(visibleMenu(user, modules ?? loaded));
  return (
    <nav className="shell-nav" aria-label="Main menu">
      {groups.map((group, i) => {
        const area = areaOf(group.section);
        const classes = ["shell-nav-group", `area-${area}`, area === "admin" ? "shell-nav-group-admin" : ""];
        return (
          <div key={group.section ?? `top-${i}`} className={classes.filter(Boolean).join(" ")}>
            {group.section ? <div className="shell-nav-heading">{group.section}</div> : null}
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.href}>
                  <Link href={entry.href} aria-current={isActive(entry, pathname) ? "page" : undefined}>
                    <Icon name={entry.icon} />
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
