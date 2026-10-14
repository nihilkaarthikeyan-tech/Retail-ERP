// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import type { CurrentUser } from "shared";
import { isActive, visibleMenu } from "@/lib/menu";

interface AppMenuProps {
  user: CurrentUser | null;
  pathname: string;
}

/** Left-hand menu: only the pages the user has rights for. */
export function AppMenu({ user, pathname }: AppMenuProps) {
  const entries = visibleMenu(user);
  return (
    <nav className="shell-nav" aria-label="Main menu">
      <ul>
        {entries.map((entry) => (
          <li key={entry.href}>
            <Link href={entry.href} aria-current={isActive(entry, pathname) ? "page" : undefined}>
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
