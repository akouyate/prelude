import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ __brand: "prisma" }));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const billingMock = vi.hoisted(() => ({
  createCreditCheckoutSession: vi.fn(),
  isCreditBillingEnabled: vi.fn(),
  isStripePurchaseConfigured: vi.fn(),
}));

const headersMock = vi.hoisted(() => ({ headers: vi.fn() }));

const userLocaleMock = vi.hoisted(() => ({ getAuthenticatedUserLocale: vi.fn() }));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/billing", () => billingMock);
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("../users/user-locale", () => userLocaleMock);
vi.mock("next/headers", () => headersMock);

import { startCreditPackCheckout } from "./credit-checkout-action";

function requestHeaders(entries: Record<string, string>) {
  return new Headers(entries);
}

beforeEach(() => {
  scopeMock.getCompletedOrganizationScope.mockReset();
  scopeMock.getCompletedOrganizationScope.mockResolvedValue({
    organizationId: "org_session",
    organizationName: "Acme Talent",
    clerkOrganizationId: null,
    role: "owner",
    userId: "user_1",
  });
  billingMock.createCreditCheckoutSession.mockReset();
  billingMock.createCreditCheckoutSession.mockResolvedValue({
    ok: true,
    url: "https://checkout.stripe.test/cs_1",
  });
  billingMock.isCreditBillingEnabled.mockReturnValue(true);
  billingMock.isStripePurchaseConfigured.mockReturnValue(true);
  userLocaleMock.getAuthenticatedUserLocale.mockReset();
  userLocaleMock.getAuthenticatedUserLocale.mockResolvedValue("en");
  headersMock.headers.mockReset();
  headersMock.headers.mockResolvedValue(
    requestHeaders({ host: "app.hirecall.test", "x-forwarded-proto": "https" }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startCreditPackCheckout", () => {
  it("bills the organization from the SESSION, never from anything the client sent", async () => {
    const result = await startCreditPackCheckout("hiring_100");

    expect(result).toEqual({ url: "https://checkout.stripe.test/cs_1" });
    // The action's whole signature is a pack id: the organization, its name and
    // the origin are all server-resolved. A recruiter cannot buy for — or bill —
    // another workspace by editing a form field, because there is no field.
    expect(billingMock.createCreditCheckoutSession).toHaveBeenCalledWith(prismaMock, {
      organizationId: "org_session",
      organizationName: "Acme Talent",
      packId: "hiring_100",
      origin: "https://app.hirecall.test",
      now: expect.any(Date),
      locale: "en",
    });
  });

  /**
   * T7 — Checkout speaks the buyer's language. `getAuthenticatedUserLocale` is
   * the same canonical server-side locale read the rest of the console already
   * trusts (dashboard, interview drafts); this proves it is threaded by the
   * acting user's id, not left to Stripe's browser/IP auto-detect.
   */
  it("threads the acting user's coerced console locale onto the Checkout session", async () => {
    userLocaleMock.getAuthenticatedUserLocale.mockResolvedValue("fr");

    await startCreditPackCheckout("hiring_100");

    expect(userLocaleMock.getAuthenticatedUserLocale).toHaveBeenCalledWith("user_1");
    expect(billingMock.createCreditCheckoutSession).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ locale: "fr" }),
    );
  });

  it("sells the quiet pack — the action gates nothing that only listing gates", async () => {
    await startCreditPackCheckout("volume_1000");

    expect(billingMock.createCreditCheckoutSession).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ packId: "volume_1000" }),
    );
  });

  it("refuses while the credit kill switch is off, without resolving a session or calling Stripe", async () => {
    billingMock.isCreditBillingEnabled.mockReturnValue(false);

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "not_configured",
    });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
    expect(scopeMock.getCompletedOrganizationScope).not.toHaveBeenCalled();
  });

  it("refuses when Stripe is not configured in this environment", async () => {
    billingMock.isStripePurchaseConfigured.mockReturnValue(false);

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "not_configured",
    });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  /**
   * Buying credits commits the organization's money. The gate is the same
   * owner/admin set the rest of the workspace already uses — a recruiter runs
   * interviews and a viewer reads them; neither signs for €2,790.
   */
  it("refuses a viewer, and never opens a Checkout session for them", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue({
      organizationId: "org_session",
      organizationName: "Acme Talent",
      clerkOrganizationId: null,
      role: "viewer",
      userId: "user_1",
    });

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "not_allowed",
    });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a recruiter too — running interviews is not signing for them", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue({
      organizationId: "org_session",
      organizationName: "Acme Talent",
      clerkOrganizationId: null,
      role: "recruiter",
      userId: "user_1",
    });

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "not_allowed",
    });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("lets an admin buy", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue({
      organizationId: "org_session",
      organizationName: "Acme Talent",
      clerkOrganizationId: null,
      role: "admin",
      userId: "user_1",
    });

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      url: "https://checkout.stripe.test/cs_1",
    });
  });

  it("gates the quiet volume pack on the same role, not a laxer one", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue({
      organizationId: "org_session",
      organizationName: "Acme Talent",
      clerkOrganizationId: null,
      role: "viewer",
      userId: "user_1",
    });

    expect(await startCreditPackCheckout("volume_1000")).toEqual({
      error: "not_allowed",
    });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a blank pack id before it reaches the catalogue", async () => {
    expect(await startCreditPackCheckout("   ")).toEqual({ error: "unknown_pack" });
    expect(billingMock.createCreditCheckoutSession).not.toHaveBeenCalled();
  });

  it("passes the catalogue's refusals back to the caller", async () => {
    billingMock.createCreditCheckoutSession.mockResolvedValue({
      ok: false,
      error: "pack_not_purchasable",
    });

    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "pack_not_purchasable",
    });
  });

  it("turns a Stripe failure into a plain error instead of surfacing an exception", async () => {
    billingMock.createCreditCheckoutSession.mockRejectedValue(new Error("stripe is down"));

    // A rejected server action reaches the browser as an opaque digest and shows
    // the recruiter nothing actionable; a returned error renders a real line.
    expect(await startCreditPackCheckout("hiring_100")).toEqual({
      error: "checkout_failed",
    });
  });

  it("falls back to http on a plain local host header", async () => {
    headersMock.headers.mockResolvedValue(requestHeaders({ host: "localhost:3000" }));

    await startCreditPackCheckout("hiring_100");

    expect(billingMock.createCreditCheckoutSession).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ origin: "http://localhost:3000" }),
    );
  });

  it("prefers the forwarded host a proxy rewrote over the internal one", async () => {
    headersMock.headers.mockResolvedValue(
      requestHeaders({
        host: "internal.fly.dev",
        "x-forwarded-host": "app.hirecall.test",
        "x-forwarded-proto": "https",
      }),
    );

    await startCreditPackCheckout("hiring_100");

    expect(billingMock.createCreditCheckoutSession).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ origin: "https://app.hirecall.test" }),
    );
  });
});
