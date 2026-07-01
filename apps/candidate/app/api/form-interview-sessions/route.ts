import { NextResponse } from "next/server";

import { submitCandidateFormInterview } from "../../../src/server/public-interviews";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    answers?: Array<{ questionId?: unknown; text?: unknown }>;
    candidateEmail?: string;
    candidateName?: string;
    candidateToken?: string;
    consentAccepted?: boolean;
    resumeToken?: string | null;
  } | null;

  const candidateToken = body?.candidateToken?.trim();
  if (!candidateToken || candidateToken.length < 4) {
    return NextResponse.json(
      { error: { code: "invalid_candidate_token" } },
      { status: 400 },
    );
  }

  const answers = Array.isArray(body?.answers)
    ? body.answers.map((answer) => ({
        questionId:
          typeof answer.questionId === "string" ? answer.questionId : "",
        text: typeof answer.text === "string" ? answer.text : "",
      }))
    : [];

  const result = await submitCandidateFormInterview({
    answers,
    candidateEmail: body?.candidateEmail,
    candidateName: body?.candidateName,
    candidateToken,
    consentAccepted: Boolean(body?.consentAccepted),
    resumeToken: body?.resumeToken,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error } },
      { status: result.status },
    );
  }

  return NextResponse.json({
    completed: true,
    productSessionId: result.productSessionId,
    resumeToken: result.resumeToken,
    sessionId: result.sessionId,
  });
}
