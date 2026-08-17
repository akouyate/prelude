import { createRouteMatcher } from "@clerk/nextjs/server";
import { describe, expect, it } from "vitest";

import { publicRoutePatterns } from "./proxy";

/**
 * The only regression guard CI has for the money path's REACHABILITY.
 *
 * `proxy.ts`'s Clerk branch is never exercised by the test suite or by CI: console
 * tests run with `CONSOLE_AUTH_PROVIDER=mock`, which takes the pass-through branch,
 * so every route looks reachable there whatever this list says. That gap is not
 * hypothetical — it is how `/api/stripe/webhook` shipped missing from the list, with
 * Clerk answering `307 → sign-in` to Stripe and no test anywhere noticing.
 *
 * So this file asserts the list itself, through Clerk's REAL matcher rather than a
 * re-implementation of it: `createRouteMatcher` is a pure function over the patterns,
 * and testing anything else would be testing our idea of Clerk instead of Clerk.
 *
 * The negative cases matter as much as the positive ones. Every route in the second
 * group authenticates a HUMAN through their Clerk session; if one of them ever
 * matched, this list would have quietly turned a session-protected page into an open
 * endpoint. A `(.*)` suffix in the wrong place is all it would take.
 */
const isPublicRoute = createRouteMatcher([...publicRoutePatterns]);

/** The matcher reads the pathname; a URL-bearing request-like object is enough. */
function requestFor(pathname: string) {
  const url = new URL(pathname, "https://console.hirecall.test");
  return { nextUrl: url, url: url.toString() } as never;
}

describe("proxy public route matcher — machine callers must stay reachable", () => {
  /**
   * Authenticated by an HMAC over the raw body (`STRIPE_WEBHOOK_SECRET`), verified
   * inside the handler. Stripe has no Clerk session and cannot acquire one, so
   * `auth.protect()` does not secure this route — it makes credit purchases
   * unfulfillable.
   */
  it("treats the Stripe webhook as public", () => {
    expect(isPublicRoute(requestFor("/api/stripe/webhook"))).toBe(true);
  });

  /**
   * Authenticated by a constant-time bearer match against `BILLING_SWEEP_SECRET`,
   * and fails closed with 503 while that secret is unset. A scheduler has no session
   * either.
   */
  it("treats the billing sweep as public", () => {
    expect(isPublicRoute(requestFor("/api/internal/billing-sweep"))).toBe(true);
  });

  it("keeps the billing sweep public with a pagination query", () => {
    expect(isPublicRoute(requestFor("/api/internal/billing-sweep?limit=5&cursor=org_1"))).toBe(
      true,
    );
  });

  /** Svix-signed. The precedent this list was built on. */
  it("treats the Clerk webhook as public", () => {
    expect(isPublicRoute(requestFor("/api/clerk/webhook"))).toBe(true);
  });
});

describe("proxy public route matcher — session-authenticated routes must stay protected", () => {
  /**
   * THE most important negative case. This route takes a `cs_…` from a query string
   * and its entire defence is that fulfilment is told, from the server-resolved
   * Clerk session, which organization the caller is. Public, it becomes an
   * enumeration oracle over every organization's checkouts.
   */
  it("does NOT treat the checkout return as public", () => {
    expect(isPublicRoute(requestFor("/api/billing/checkout-return?session_id=cs_1"))).toBe(false);
  });

  /** Completes an OAuth flow and writes connected-account credentials for the session's org. */
  it("does NOT treat the Google integration callback as public", () => {
    expect(isPublicRoute(requestFor("/api/integrations/google/callback?code=abc"))).toBe(false);
  });

  it("does NOT treat the recruiter dashboard as public", () => {
    expect(isPublicRoute(requestFor("/dashboard"))).toBe(false);
  });

  /**
   * Guards against a future `/api/internal(.*)` or `/api/stripe(.*)` broadening:
   * both prefixes are deliberately pinned to one path each.
   */
  it("does NOT make the whole /api/internal or /api/stripe namespace public", () => {
    expect(isPublicRoute(requestFor("/api/internal/some-future-admin-endpoint"))).toBe(false);
    expect(isPublicRoute(requestFor("/api/stripe/refund-everything"))).toBe(false);
  });
});
