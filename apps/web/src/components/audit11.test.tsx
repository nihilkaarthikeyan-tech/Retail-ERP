// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 11 (tests): the audit 9 changes that had no test of their own.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEAVE_QUESTION, useUnsavedChanges } from "@/lib/unsaved";
import { Dialog } from "./ui/dialog";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({})) } }));

afterEach(cleanup);

function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return <Link href="/items">Items</Link>;
}

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} title="Manager PIN" onClose={() => setOpen(false)}>
        <label htmlFor="pin">Code</label>
        <input id="pin" />
      </Dialog>
    </>
  );
}

describe("audit 11: unsaved changes (A9.3)", () => {
  function clickLink() {
    const link = screen.getByRole("link", { name: "Items" });
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  it("a link asks before leaving a form with unsaved changes; No stays on the page", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Form dirty />);
    expect(clickLink()).toBe(true);
    expect(confirm).toHaveBeenCalledWith(LEAVE_QUESTION);
    confirm.mockReturnValue(true);
    expect(clickLink()).toBe(false);
    confirm.mockRestore();
  });

  it("nothing is asked when nothing has changed, and closing the tab is only held while there are changes", () => {
    const confirm = vi.spyOn(window, "confirm");
    const { rerender } = render(<Form dirty={false} />);
    expect(clickLink()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    rerender(<Form dirty />);
    expect(unload()).toBe(true);
    confirm.mockRestore();
  });
});

describe("audit 11: dialogs give the cursor back (A9.2)", () => {
  it("closing a dialog puts the cursor back on what opened it", async () => {
    render(<Opener />);
    const open = screen.getByRole("button", { name: "Open" });
    open.focus();
    fireEvent.click(open);
    expect(document.activeElement).toBe(screen.getByLabelText("Code"));
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));
    await vi.waitFor(() => expect(document.activeElement).toBe(open));
  });
});
