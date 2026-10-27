// Copyright (c) 2026, Rademics. All rights reserved.
// For tests about who may see which screen: the menu's groups start folded (decision L11),
// so these tests open every group first, as if the person had opened them all.
import { MENU } from "./menu";
import { getOpened, toggleOpened } from "./menu-usage";

export function openEveryMenuGroup(): void {
  const sections = [...new Set(MENU.map((e) => e.section).filter((s): s is string => !!s))];
  for (const s of sections) if (!getOpened().includes(s)) toggleOpened(s);
}
