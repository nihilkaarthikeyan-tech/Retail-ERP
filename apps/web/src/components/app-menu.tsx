// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { CurrentUser, ModuleKey } from "shared";
import { Icon } from "@/components/icons";
import { areaOf, isActive, type MenuEntry, visibleMenu } from "@/lib/menu";
import { getCounts, getOpened, getServerCounts, getServerOpened, mostUsed, subscribeMenuStore, toggleOpened } from "@/lib/menu-usage";
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

function Entry({ entry, pathname }: { entry: MenuEntry; pathname: string }) {
  return (
    <li>
      <Link href={entry.href} aria-current={isActive(entry, pathname) ? "page" : undefined}>
        <Icon name={entry.icon} />
        {entry.label}
      </Link>
    </li>
  );
}

/**
 * Left-hand menu: only the pages the user has rights for (and whose module is
 * on), and the five screens this person opens most at the top (owner, 23 October
 * 2026). Groups start folded to one line each, so an owner does not face 84 links
 * at once; the group of the current page is always open, and a group the person
 * opens stays open on this computer (owner, 27 October 2026, decision L11).
 */
export function AppMenu({ user, pathname, modules }: AppMenuProps) {
  const loaded = useModules().modules;
  const entries = useMemo(() => visibleMenu(user, modules ?? loaded), [user, modules, loaded]);
  const groups = groupBySection(entries);
  const opened = useSyncExternalStore(subscribeMenuStore, getOpened, getServerOpened);
  const counts = useSyncExternalStore(subscribeMenuStore, getCounts, getServerCounts);
  const favourites = useMemo(() => {
    const top = mostUsed(
      counts,
      entries.map((e) => e.href),
    );
    return top.map((h) => entries.find((e) => e.href === h)).filter((e): e is MenuEntry => !!e);
  }, [counts, entries]);

  return (
    <nav className="shell-nav" aria-label="Main menu">
      {favourites.length > 0 ? (
        <div className="shell-nav-group shell-nav-favourites">
          <div className="shell-nav-heading">Most used</div>
          <ul>
            {favourites.map((entry) => (
              <Entry key={`fav-${entry.href}`} entry={entry} pathname={pathname} />
            ))}
          </ul>
        </div>
      ) : null}
      {groups.map((group, i) => {
        const area = areaOf(group.section);
        const classes = ["shell-nav-group", `area-${area}`, area === "admin" ? "shell-nav-group-admin" : ""];
        const section = group.section;
        const holdsCurrent = group.entries.some((e) => isActive(e, pathname));
        const open = !section || holdsCurrent || opened.includes(section);
        const id = `menu-group-${i}`;
        return (
          <div key={section ?? `top-${i}`} className={classes.filter(Boolean).join(" ")}>
            {section ? (
              <button
                type="button"
                className="shell-nav-heading"
                aria-expanded={open}
                aria-controls={id}
                disabled={holdsCurrent}
                title={holdsCurrent ? "The screen you are on is in this group" : undefined}
                onClick={() => toggleOpened(section)}
              >
                {section}
                {open ? null : (
                  <span className="shell-nav-count">
                    {group.entries.length}
                    <span className="sr-only"> screens</span>
                  </span>
                )}
                <span className="shell-nav-chevron" aria-hidden="true" />
              </button>
            ) : null}
            {open ? (
              <ul id={id}>
                {group.entries.map((entry) => (
                  <Entry key={entry.href} entry={entry} pathname={pathname} />
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
