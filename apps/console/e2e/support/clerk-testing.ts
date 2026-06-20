import type { BrowserContext, Page } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

export function shouldUseClerkTesting() {
  const provider = process.env.CONSOLE_AUTH_PROVIDER ?? "mock";

  if (provider === "mock") {
    return false;
  }

  if (provider === "clerk") {
    return true;
  }

  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.CLERK_SECRET_KEY,
  );
}

export async function setupPreludeClerkTestingToken({
  context,
  page,
}: {
  context?: BrowserContext;
  page?: Page;
}) {
  if (!shouldUseClerkTesting()) {
    return;
  }

  await setupClerkTestingToken({ context, page });
}
