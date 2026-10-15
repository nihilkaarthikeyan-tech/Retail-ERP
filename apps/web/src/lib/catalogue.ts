// Copyright (c) 2026, Rademics. All rights reserved.
// Small helpers shared by the catalogue screens.
import type { ItemDto, ItemGroupNode } from "./types";

/** Any group tree node (item, customer or supplier groups). */
export interface TreeNode {
  id: string;
  name: string;
  active: boolean;
  isLeaf: boolean;
  children: TreeNode[];
}

export interface GroupOption<N extends TreeNode = ItemGroupNode> {
  id: string;
  /** Name indented by depth, for a <select>. */
  label: string;
  depth: number;
  isLeaf: boolean;
  active: boolean;
  node: N;
}

/** The tree flattened in display order (parents before children). */
export function flattenGroups<N extends TreeNode>(roots: N[]): GroupOption<N>[] {
  const out: GroupOption<N>[] = [];
  const walk = (nodes: N[], depth: number) => {
    for (const node of nodes) {
      out.push({ id: node.id, label: `${"   ".repeat(depth)}${node.name}`, depth, isLeaf: node.isLeaf, active: node.active, node });
      walk(node.children as N[], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

export function findGroup(roots: ItemGroupNode[], id: string): ItemGroupNode | null {
  for (const node of roots) {
    if (node.id === id) return node;
    const inner = findGroup(node.children, id);
    if (inner) return inner;
  }
  return null;
}

/** "Stock item", "Service" or "Style" for the items list. */
export function itemKindLabel(item: Pick<ItemDto, "isStockItem" | "isParentStyle">): string {
  if (item.isParentStyle) return "Style";
  return item.isStockItem ? "Stock item" : "Service";
}

/** Money shown as it is stored (a decimal string), or a dash. Never converted to a float. */
export function showMoney(value: string | null | undefined): string {
  return value == null || value === "" ? "—" : value;
}

/** A scanner or a typed code: no spaces, at least 3 characters, no wildcard-like words. */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  return t.length >= 3 && !/\s/.test(t);
}
