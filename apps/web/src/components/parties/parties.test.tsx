// Copyright (c) 2026, Rademics. All rights reserved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GstinStateFields, type GstinStateValues } from "./gstin-state-fields";
import { QuickAddDialog } from "./quick-add-dialog";
import { newPart, TermsPartsEditor, type PartValues } from "./terms-parts-editor";

beforeAll(() => {
  // jsdom has no <dialog>.showModal.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QuickAddDialog", () => {
  it("shows the customers with the same mobile on 409 and resends with confirmDuplicate", async () => {
    const created = { id: "c9", code: "CUS-000009", name: "Lakshmi R" };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (!body.confirmDuplicate) {
        return new Response(
          JSON.stringify({
            statusCode: 409,
            message: "Mobile 9876543210 already belongs to Lakshmi (CUS-000001)",
            code: "DUPLICATE_MOBILE",
            matches: [{ id: "c1", code: "CUS-000001", name: "Lakshmi", mobile: "9876543210" }],
          }),
          { status: 409 },
        );
      }
      return new Response(JSON.stringify(created), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<QuickAddDialog open onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Lakshmi R" } });
    fireEvent.change(screen.getByLabelText(/^Mobile/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));

    const link = await screen.findByRole("link", { name: /CUS-000001/ });
    expect(link.getAttribute("href")).toBe("/customers/c1");
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /different person — add anyway/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/customers\/quick-add$/);
    expect(JSON.parse(String(init.body))).toEqual({ name: "Lakshmi R", mobile: "9876543210", email: null, confirmDuplicate: true });
  });
});

function GstinHarness() {
  const [values, setValues] = useState<GstinStateValues>({ gstin: "", stateCode: "" });
  return <GstinStateFields idPrefix="t" values={values} onChange={setValues} />;
}

describe("GstinStateFields", () => {
  it("fills the state from the GSTIN's first two digits and locks it", () => {
    render(<GstinHarness />);
    const state = screen.getByLabelText(/^State/) as HTMLSelectElement;
    expect(state.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "29aaacr1234a1zz" } });

    expect((screen.getByLabelText(/^GSTIN/) as HTMLInputElement).value).toBe("29AAACR1234A1ZZ");
    expect(state.value).toBe("29");
    expect(state.disabled).toBe(true);
  });
});

function PartsHarness({ start }: { start: PartValues[] }) {
  const [parts, setParts] = useState(start);
  return <TermsPartsEditor parts={parts} onChange={setParts} />;
}

describe("TermsPartsEditor", () => {
  it("shows the shares-total error until the parts add up to 100%", () => {
    render(<PartsHarness start={[newPart("50"), newPart("30")]} />);
    expect(screen.getByRole("alert").textContent).toBe("Shares add up to 80%, not 100%");

    fireEvent.change(screen.getByLabelText(/^Share %/, { selector: "#part-1-share" }), { target: { value: "50" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Shares add up to 100%.")).toBeTruthy();
  });
});
