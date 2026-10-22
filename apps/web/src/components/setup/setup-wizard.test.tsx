// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 12, scenario 12.6 on screen: the guided setup checks and saves each
// step and comes back where it was left with the answers kept. Plan 14: the owner
// signed up first and is logged in, so the wizard asks neither for the owner nor a password.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { suggestedModules } from "shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "./setup-wizard";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

type Route = (body: Record<string, unknown>) => { status: number; body: unknown };

function mockApi(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ message: `No route for ${method} ${url.pathname}` }), { status: 404 });
    const { status, body } = route(init?.body ? JSON.parse(String(init.body)) : {});
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const writes = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") !== "GET").map((c) => ({ path: new URL(String(c[0])).pathname, body: JSON.parse(String((c[1] as RequestInit).body)) }));

const BUSINESS = { legalName: "Lakshmi Fancy Stores", tradeName: null, pan: "AAACR1234A", stateCode: "33", addressLine1: null, addressLine2: null, city: "Chennai", pincode: null, phone: null, email: null, financialYear: { startDate: "2026-04-01", endDate: "2027-03-31" } };
const GST = { registered: true, gstin: "33AAACR1234A1ZA", legalNameOnCertificate: null, scheme: "regular", filingFrequency: "quarterly", turnoverBand: "up_to_5cr" };
const SHOP = { name: "Anna Nagar", code: "ANNA", tills: 2 };

/** A server that keeps what it is sent, like the real one. */
function server(start: { step: number; data: Record<string, unknown> }) {
  const state = { ...start };
  const fn = mockApi({
    "GET /setup/status": () => ({ status: 200, body: { needed: true } }),
    "GET /company": () => ({ status: 200, body: { legalName: "Lakshmi Fancy" } }),
    "GET /setup/progress": () => ({ status: 200, body: state }),
    "PUT /setup/progress": (b) => {
      Object.assign(state, b);
      return { status: 200, body: state };
    },
    "POST /setup/finish": () => ({ status: 201, body: { companyId: "c1", userId: "u1" } }),
  });
  return { fn, state };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
});

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("guided setup (12.6)", () => {
  it("checks step 1 before saving, then saves it and moves on; no owner or password is asked", async () => {
    const { fn } = server({ step: 1, data: {} });
    render(<SetupWizard />);
    expect(await screen.findByText("Step 1 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your business" })).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    // The shop name typed at sign-up starts the legal name.
    expect((screen.getByLabelText(/^Legal name/) as HTMLInputElement).value).toBe("Lakshmi Fancy");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Please correct the highlighted fields.")).toBeTruthy();
    expect(writes(fn)).toEqual([]);

    type(/^Legal name/, "Lakshmi Fancy Stores");
    type(/^State/, "33");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Step 2 of 5")).toBeTruthy();
    expect(screen.getByText(/Saved\. You can close the browser/)).toBeTruthy();
    const [saved] = writes(fn);
    expect(saved.path).toBe("/setup/progress");
    expect(saved.body.step).toBe(2);
    expect(saved.body.data.business).toMatchObject({ legalName: "Lakshmi Fancy Stores", stateCode: "33" });
    expect(JSON.stringify(writes(fn))).not.toMatch(/password/i);
  });

  it("comes back at step 3 with the earlier answers kept after the browser was closed", async () => {
    server({ step: 3, data: { business: BUSINESS, gst: GST } });
    render(<SetupWizard />);
    expect(await screen.findByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByText(/Welcome back\. Your earlier answers were kept, so you carry on from step 3/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your first shop" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Step 2 of 5")).toBeTruthy();
    expect((screen.getByLabelText(/^GSTIN/) as HTMLInputElement).value).toBe("33AAACR1234A1ZA");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText(/Legal name/) as HTMLInputElement).value).toBe("Lakshmi Fancy Stores");
  });

  it("checks the GSTIN's last character, and allows 'not registered yet'", async () => {
    const { fn } = server({ step: 2, data: { business: BUSINESS } });
    render(<SetupWizard />);
    expect(await screen.findByText("Step 2 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Choose whether the business has a GSTIN.")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Yes, the business has a GSTIN"));
    type(/^GSTIN/, "33AAACR1234A1ZV");
    expect(await screen.findAllByText("The GSTIN has a typing mistake: its last character does not match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Please correct the highlighted fields.")).toBeTruthy());
    expect(writes(fn)).toEqual([]);

    fireEvent.click(screen.getByLabelText(/Not registered yet/));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Step 3 of 5")).toBeTruthy();
    expect(writes(fn)[0].body.data.gst).toEqual({ registered: false });
  });

  it("step 4: a shop type ticks its modules; a module that needs another brings it, and says so", async () => {
    const { fn } = server({ step: 4, data: { business: BUSINESS, gst: GST, shop: SHOP } });
    render(<SetupWizard />);
    expect(await screen.findByText("Step 4 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Fancy and gift/ }));
    expect((screen.getByLabelText(/^Offers and coupons/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^Sizes and colours/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/^Salesperson/) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByLabelText(/^Alterations/));
    expect((screen.getByLabelText(/^Salesperson/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Alterations needs Salesperson, so that is switched on too.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Clothing/ }));
    expect((screen.getByLabelText(/^Sizes and colours/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Home delivery/));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Step 5 of 5")).toBeTruthy();
    expect(writes(fn)[0].body.data.sell).toEqual({ shopType: "clothing", modules: { ...suggestedModules("clothing"), delivery: false } });
  });

  it("the last step shows a summary and finishes with nothing more to type", async () => {
    const sell = { shopType: "fancy", modules: suggestedModules("fancy") };
    const { fn } = server({ step: 5, data: { business: BUSINESS, gst: GST, shop: SHOP, sell } });
    render(<SetupWizard />);
    expect(await screen.findByText("Step 5 of 5")).toBeTruthy();
    expect(screen.getByText("Lakshmi Fancy Stores")).toBeTruthy();
    expect(screen.getByText("Anna Nagar (ANNA)")).toBeTruthy();
    expect(screen.getByText("Till 1, Till 2, each taking cash, card and UPI")).toBeTruthy();
    expect(screen.getByText("Fancy and gift")).toBeTruthy();
    expect(screen.getByText("Set your go-live date")).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(writes(fn)).toEqual([{ path: "/setup/finish", body: {} }]);
  });

  it("sends the owner to the dashboard once setup is done", async () => {
    mockApi({ "GET /setup/status": () => ({ status: 200, body: { needed: false } }) });
    render(<SetupWizard />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});
