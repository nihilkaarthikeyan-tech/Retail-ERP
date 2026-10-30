// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 9 (screens, ease of use and accessibility), 30 October 2026.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { unitRupees } from "@/lib/purchasing";
import { safeNext } from "@/lib/unsaved";
import { Changes } from "./audit-table";
import { Dialog } from "./ui/dialog";
import { DataTable, ROWS_AT_A_TIME } from "./ui/table";

afterEach(cleanup);

describe("audit 9", () => {
  it("a dialog opens with the cursor in its first box, not on the close button", () => {
    render(
      <Dialog open title="Manager PIN" onClose={() => {}}>
        <label htmlFor="pin">PIN</label>
        <input id="pin" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("PIN"));
  });

  it("the change history shows dates the Indian way and codes as words", () => {
    render(<Changes changes={{ postingDate: { old: "2026-04-01T00:00:00.000Z", new: "2026-04-02T00:00:00.000Z" }, status: { old: "draft", new: "to_receive_and_bill" } }} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("01 Apr 2026");
    expect(text).toContain("to receive and bill");
    expect(text).not.toContain("T00:00:00");
  });

  it("a long table draws 500 rows and offers the rest", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: String(i) }));
    render(<DataTable columns={[{ key: "id", header: "Id", render: (r: { id: string }) => r.id }]} rows={rows} rowKey={(r) => r.id} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(ROWS_AT_A_TIME);
    expect(screen.getByText(/Showing 500 of 1,200/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 500 more" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1000);
    fireEvent.click(screen.getByRole("button", { name: "Show 200 more" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1200);
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("prices per unit read as rupees, with paise beyond two places only when they matter", () => {
    expect(unitRupees("125000.0000")).toBe("₹1,25,000.00");
    expect(unitRupees("12.3456")).toBe("₹12.3456");
    expect(unitRupees("12.3450")).toBe("₹12.345");
  });

  it("after logging in, only a page inside the app is returned to", () => {
    expect(safeNext("/purchases/orders/1?x=1", "/dashboard")).toBe("/purchases/orders/1?x=1");
    expect(safeNext("//evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNext("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNext("/login", "/dashboard")).toBe("/dashboard");
    expect(safeNext(null, "/dashboard")).toBe("/dashboard");
  });
});
