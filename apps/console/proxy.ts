import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  consoleAuthConfigurationError,
  isConsoleAuthClerkEnabled,
} from "./src/server/auth/clerk-config";

const isPublicRoute = createRouteMatcher([
  "/about(.*)",
  "/login(.*)",
  "/sign-up(.*)",
]);

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
