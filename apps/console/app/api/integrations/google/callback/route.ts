import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { completeGoogleOAuthCallback } from "@/server/integrations/connected-account-service";

export async function GET(request: NextRequest) {
  const result = await completeGoogleOAuthCallback({
    code: request.nextUrl.searchParams.get("code"),
    error: request.nextUrl.searchParams.get("error"),
    state: request.nextUrl.searchParams.get("state"),
  });
  const status = result.ok ? "connected" : result.reason;

  redirect(
    `${result.returnTo}&provider=google_calendar&status=${encodeURIComponent(
      status,
    )}`,
  );
}
