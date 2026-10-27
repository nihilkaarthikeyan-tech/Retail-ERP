// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaticModulesProvider } from "@/lib/modules";
import type { ItemGroupNode, UnitDto } from "@/lib/types";
import { ItemForm } from "./item-form";

const groups: ItemGroupNode[] = [{ id: "6b9a4f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b", code: "KURTI", name: "Women kurtis", parentId: null, hsnCode: null, active: true, isLeaf: true, children: [] }];
const units: UnitDto[] = [{ id: "7c8d9e0f-2a3b-4c5d-9e8f-1a2b3c4d5e6f", code: "PCS", name: "Piece", kind: "count", allowsFractions: false, active: true }];

function mockCreate() {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ id: "i1", ...(init?.body ? JSON.parse(String(init.body)) : {}) }), { status: 201 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const sent = (fn: ReturnType<typeof mockCreate>) => JSON.parse(String((fn.mock.calls.find(([, init]) => init?.method === "POST")?.[1] as RequestInit).body));

function fill() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Cotton kurta" } });
  fireEvent.change(screen.getByLabelText(/^Group/), { target: { value: groups[0].id } });
  fireEvent.change(screen.getByLabelText(/^Basic unit/), { target: { value: units[0].id } });
  fireEvent.click(screen.getByRole("button", { name: "Create item" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ItemForm, a new item", () => {
  // Found in the walkthrough of 27 October 2026: every new item without batch tracking was refused
  // ("Automatic batch numbers need batch tracking") because the form always sent automatic numbering.
  it("an item without batch tracking is sent without automatic batch numbers (batches module off)", async () => {
    const fetchMock = mockCreate();
    const onSaved = vi.fn();
    render(
      <StaticModulesProvider modules={{ batches: false }}>
        <ItemForm item={null} groups={groups} brands={[]} units={units} attributes={[]} settings={null} onSaved={onSaved} />
      </StaticModulesProvider>,
    );
    fill();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent(fetchMock)).toMatchObject({ name: "Cotton kurta", trackBatches: false, autoNumberBatches: false });
  });

  it("with batches on, automatic numbering is sent only once batch tracking is ticked", async () => {
    const fetchMock = mockCreate();
    const onSaved = vi.fn();
    render(
      <StaticModulesProvider modules={{ batches: true }}>
        <ItemForm item={null} groups={groups} brands={[]} units={units} attributes={[]} settings={null} onSaved={onSaved} />
      </StaticModulesProvider>,
    );
    fireEvent.click(screen.getByLabelText(/Track batches/));
    fill();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent(fetchMock)).toMatchObject({ trackBatches: true, autoNumberBatches: true });
  });
});
