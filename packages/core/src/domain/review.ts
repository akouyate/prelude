import type { CandidateAnswer, CandidateStatus } from "@prelude/types";

export function suggestReviewStatus(answers: CandidateAnswer[]): CandidateStatus {
  const answeredCount = answers.filter((answer) => {
    return Boolean(answer.text ?? answer.transcript ?? answer.mediaUrl);
  }).length;

  if (answeredCount === 0) {
    return "archived";
  }

  if (answeredCount < answers.length) {
    return "to_review";
  }

  return "to_call";
}
