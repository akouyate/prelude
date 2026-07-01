import { NextResponse } from "next/server";

import { markCandidateSessionLifecycle } from "../../../../../src/server/public-interviews";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: "abandon" | "fail";
    resumeToken?: string;
  } | null;

  if (body?.action !== "abandon" && body?.action !== "fail") {
    return NextResponse.json(
      { error: { code: "unsupported_lifecycle_action" } },
      { status: 400 },
    );
  }

  const result = await markCandidateSessionLifecycle({
    action: body.action,
    resumeToken: body.resumeToken,
    sessionId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error } },
      { status: result.status },
    );
  }

  return NextResponse.json({ status: result.status });
}
