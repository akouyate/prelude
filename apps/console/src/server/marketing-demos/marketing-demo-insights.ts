type HandoffPayload = {
  answers: Array<{ questionId: string; value: number | string }>;
  roleSlug: string;
  roleTitle: string;
  transcript: Array<{ speaker: "candidate" | "interviewer"; text: string }>;
};

export function buildMarketingDemoInsights(payload: HandoffPayload) {
  const candidateTurns = payload.transcript.filter(
    (turn) => turn.speaker === "candidate",
  );
  const words = candidateTurns.reduce(
    (count, turn) =>
      count + turn.text.trim().split(/\s+/u).filter(Boolean).length,
    0,
  );
  const focusArea = payload.answers.find(
    (answer) => answer.questionId === "focus_area",
  )?.value;
  const confidence = payload.answers.find(
    (answer) => answer.questionId === "confidence",
  )?.value;

  const insights = [
    candidateTurns.length >= 3 && words >= 90
      ? "You sustained detailed answers across the conversation. Keep the detail, but lead each answer with the decision or outcome so the listener knows where you are going."
      : "Your answers were concise. On a real interview, add one specific situation, the action you personally took, and the result to make your evidence easier to assess.",
    focusInsight(focusArea),
    typeof confidence === "number" && confidence <= 2
      ? "Your self-rating suggests the format still felt unfamiliar. A short pause before answering and a simple Situation–Action–Result frame can make the next attempt feel much more controlled."
      : "Your self-rating suggests you settled into the voice format. Preserve that conversational tone while making ownership words—“I decided”, “I changed”, “I measured”—more explicit.",
  ];

  return {
    insights,
    roleSlug: payload.roleSlug,
    roleTitle: payload.roleTitle,
    turnCount: candidateTurns.length,
  };
}

function focusInsight(value: number | string | undefined) {
  switch (value) {
    case "examples":
      return "For stronger examples, choose one moment rather than a broad pattern. Name the constraint, your action, and what changed afterward.";
    case "tradeoffs":
      return "When explaining trade-offs, name the options you rejected and the evidence that made your chosen path better at that moment.";
    case "clarity":
      return "For greater clarity, start with a one-sentence answer, then add the evidence. This keeps a voice response easy to follow without making it feel scripted.";
    case "structure":
    default:
      return "A reliable voice-answer structure is: one-sentence context, your decision, two concrete actions, and the measurable or observable result.";
  }
}
