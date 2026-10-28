// Copyright (c) 2026, Rademics. All rights reserved.
// Owner, 28 October 2026: the HSN box suggests the official GST portal codes and checks a complete code.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HsnInput } from "./hsn-input";

function mockApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = (() => {
        if (url.pathname === "/catalogue/hsn-codes") return [];
        if (url.pathname === "/catalogue/official-hsn") return [{ code: "610610", description: "OF COTTON", isService: false, heading: "WOMEN'S OR GIRLS' BLOUSES" }];
        if (url.pathname === "/catalogue/official-hsn/6106") return { code: "6106", description: "WOMEN'S OR GIRLS' BLOUSES", isService: false, official: true };
        if (url.pathname === "/catalogue/official-hsn/6199") return { code: "6199", description: null, isService: null, official: false };
        return {};
      })();
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

function Box() {
  const [code, setCode] = useState("");
  return <HsnInput id="hsn" value={code} onChange={setCode} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HSN box", () => {
  it("lists official codes under their own heading, with the heading they belong to", async () => {
    mockApi();
    render(<Box />);
    fireEvent.change(screen.getByLabelText("HSN / SAC code"), { target: { value: "6106" } });
    expect(await screen.findByText("Official list (GST portal)")).toBeTruthy();
    expect(screen.getByText("WOMEN'S OR GIRLS' BLOUSES", { selector: ".picker-result-note" })).toBeTruthy();
    expect(await screen.findByText("Official: WOMEN'S OR GIRLS' BLOUSES")).toBeTruthy();
  });

  it("warns when a complete code is not in the official list", async () => {
    mockApi();
    render(<Box />);
    fireEvent.change(screen.getByLabelText("HSN / SAC code"), { target: { value: "6199" } });
    expect(await screen.findByText(/6199 is not in the official HSN \/ SAC list/)).toBeTruthy();
  });
});
