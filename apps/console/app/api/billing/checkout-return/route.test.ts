import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ __brand: "prisma" }));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const billingMock = vi.hoisted(() => ({
  fulfillCreditCheckout: vi.fn(),
  isCreditBillingEnabled: vi.fn(),
  isStripePurchaseConfigured: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/billing", () => billingMock);
vi.mock("@/server/organizations/organization-scope", () => scopeMock);
vi.mock("next/navigation", () => navigationMock);

import { GET } from "./route";

/** The route only ever reads `nextUrl.searchParams`, so that is all the fake carries. */
function requestFor(query: string) {
  return { nextUrl: new URL(`https://app.hirecall.test/api/billing/checkout-return${query}`) } as never;
}

function redirectedTo() {
  expect(navigationMock.redirect).toHaveBeenCalledTimes(1);
  return navigationMock.redirect.mock.calls[0]?.[0] as string;
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
  billingMock.fulfillCreditCheckout.mockReset();
  billingMock.fulfillCreditCheckout.mockResolvedValue({ outcome: "granted", lotId: "lot_1" });
  billingMock.isCreditBillingEnabled.mockReturnValue(true);
  billingMock.isStripePurchaseConfigured.mockReturnValue(true);
  navigationMock.redirect.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/billing/checkout-return — ownership", () => {
  /**
   * THE security test for this route. `session_id` arrives in a query string a
   * recruiter can retype, so it is attacker input: the only thing standing between
   * it and another organization's checkout is that fulfilment is told, from the
   * server-resolved session and nothing else, which organization the caller is.
   */
  it("hands fulfilment the SERVER-resolved organization, never anything from the URL", async () => {
    await GET(requestFor("?session_id=cs_victim&organizationId=org_victim"));

    expect(billingMock.fulfillCreditCheckout).toHaveBeenCalledWith(prismaMock, {
      checkoutSessionId: "cs_victim",
      expectedOrganizationId: "org_session",
      now: expect.any(Date),
    });
  });

  it("refuses a session belonging to another organization and says nothing about it", async () => {
    billingMock.fulfillCreditCheckout.mockResolvedValue({ outcome: "foreign_session" });

    await GET(requestFor("?session_id=cs_someone_else"));

    // Not a success, and not a distinguishable failure either: the same generic
    // outcome a broken session gets, so the URL cannot be read as an oracle.
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
  });

  it("never reaches fulfilment without a session id", async () => {
    await GET(requestFor(""));

    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
  });

  it("never reaches fulfilment for something that is not a Checkout session id", async () => {
    await GET(requestFor("?session_id=pi_3Nq"));

    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
  });

  it("requires an authenticated console session before touching Stripe", async () => {
    scopeMock.getCompletedOrganizationScope.mockRejectedValue(
      new Error("Completed onboarding is required."),
    );

    await expect(GET(requestFor("?session_id=cs_1"))).rejects.toThrow(/onboarding/i);
    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
  });
});

describe("GET /api/billing/checkout-return — outcomes", () => {
  it("redirects a granted purchase to the settings banner and drops the session id", async () => {
    await GET(requestFor("?session_id=cs_1"));

    // The `cs_…` must not survive into the address bar: a reload would otherwise
    // re-run fulfilment, and the id would sit in browser history and referrers.
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=granted");
  });

  it("treats a purchase the webhook already fulfilled as a success, not an error", async () => {
    billingMock.fulfillCreditCheckout.mockResolvedValue({ outcome: "already_granted" });

    await GET(requestFor("?session_id=cs_1"));

    expect(redirectedTo()).toBe("/settings?view=billing&purchase=already");
  });

  it("tells a deferred payment it is still processing", async () => {
    billingMock.fulfillCreditCheckout.mockResolvedValue({ outcome: "not_paid" });

    await GET(requestFor("?session_id=cs_1"));

    expect(redirectedTo()).toBe("/settings?view=billing&purchase=processing");
  });

  it("collapses every parked outcome into one generic error, leaking no internal reason", async () => {
    for (const outcome of [
      { outcome: "unknown_pack" },
      { outcome: "amount_mismatch" },
      { outcome: "no_payment_intent" },
      { outcome: "needs_admin", reason: "missing_metadata" },
    ]) {
      navigationMock.redirect.mockReset();
      billingMock.fulfillCreditCheckout.mockResolvedValue(outcome);

      await GET(requestFor("?session_id=cs_1"));

      expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
    }
  });

  it("redirects rather than 500s when fulfilment throws, so the buyer lands somewhere real", async () => {
    billingMock.fulfillCreditCheckout.mockRejectedValue(new Error("stripe is down"));

    await GET(requestFor("?session_id=cs_1"));

    // The money is safe either way — the webhook and the sweep both fulfil this
    // same session — so a failed browser return is a banner, not a dead end.
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
  });

  it("does not fulfil at all while the credit kill switch is off", async () => {
    billingMock.isCreditBillingEnabled.mockReturnValue(false);

    await GET(requestFor("?session_id=cs_1"));

    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
    expect(redirectedTo()).toBe("/settings?view=billing&purchase=error");
  });
});
