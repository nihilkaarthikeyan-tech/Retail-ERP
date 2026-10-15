// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import type { CurrentUser } from "shared";
import { Icon } from "@/components/icons";
import { areaOf, isActive, type MenuEntry, visibleMenu } from "@/lib/menu";

interface AppMenuProps {
  user: CurrentUser | null;
  pathname: string;
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

/** Left-hand menu: only the pages the user has rights for, coloured by area of the shop. */
export function AppMenu({ user, pathname }: AppMenuProps) {
  const groups = groupBySection(visibleMenu(user));
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
