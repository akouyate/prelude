import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  consoleAuthConfigurationError,
  isConsoleAuthClerkEnabled,
} from "./src/server/auth/clerk-config";

/**
 * Exported so `proxy.test.ts` can pin it. This list is the ONLY thing standing
 * between a machine caller and a 307-to-sign-in, and the Clerk branch that consumes
 * it never runs in tests or in CI (console tests default to `CONSOLE_AUTH_PROVIDER=mock`,
 * which takes the pass-through branch below). Without a test, a regression here is
 * invisible until Stripe stops fulfilling purchases in production — which is exactly
 * how `/api/stripe/webhook` came to be missing from it.
 */
export const publicRoutePatterns = [
  "/about(.*)",
  "/login(.*)",
  "/sign-up(.*)",
  // Svix-signed Clerk webhook — authenticated by signature, not a Clerk session.
  "/api/clerk/webhook(.*)",
  // Machine callers. None of these has a Clerk session and none can acquire one,
  // so `auth.protect()` does not "secure" them — it makes them unreachable, and
  // silently: it answers 307-to-sign-in or 404 depending on the request shape, both
  // of which look like an application bug rather than an auth refusal.
  //
  // Verified against this middleware, not assumed. Before this entry:
  //   POST /api/stripe/webhook          → 307 …accounts.dev/sign-in?redirect_url=…
  //   POST /api/internal/billing-sweep  → 404
  //
  // Each carries its own, stronger authentication, applied inside the handler:
  // Stripe signs its payload with an HMAC (`STRIPE_WEBHOOK_SECRET`), and the sweep
  // requires a constant-time bearer match against `BILLING_SWEEP_SECRET` and fails
  // closed with 503 while that secret is unset.
  "/api/stripe/webhook(.*)",
  "/api/internal/billing-sweep(.*)",
] as const;

// Spread into a mutable copy: `createRouteMatcher` takes a mutable array, and the
// export stays `readonly` so no caller can quietly add a route to the public list.
const isPublicRoute = createRouteMatcher([...publicRoutePatterns]);

export default isConsoleAuthClerkEnabled
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        await auth.protect();
      }
    })
  : function proxy() {
      if (consoleAuthConfigurationError) {
        return new NextResponse(consoleAuthConfigurationError, { status: 500 });
      }

      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
