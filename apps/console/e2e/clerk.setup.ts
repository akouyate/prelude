import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

import { shouldUseClerkTesting } from "./support/clerk-testing";

setup.describe.configure({ mode: "serial" });

setup("clerk testing token", async () => {
  if (!shouldUseClerkTesting()) {
    return;
  }

  process.env.CLERK_PUBLISHABLE_KEY ??=
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  await clerkSetup();
});
