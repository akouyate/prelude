import { NextResponse } from "next/server";

import { completeCandidateSession } from "../../../../../src/server/public-interviews";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    resumeToken?: string;
  } | null;

  const result = await completeCandidateSession({
    resumeToken: body?.resumeToken,
    sessionId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "candidate_session_not_found" } },
      { status: result.status },
    );
  }

  return NextResponse.json({ completed: true });
}
