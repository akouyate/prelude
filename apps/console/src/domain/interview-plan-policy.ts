import type {
  InterviewCriterionDraft,
  InterviewQuestionDraft,
} from "@prelude/core";
import { aiGuardrails, textViolatesPolicy } from "@prelude/core";

export const interviewPlanPolicy = {
  maxCriteria: 5,
  maxQuestions: 5,
  minCriteriaToPublish: 3,
  minQuestionsToPublish: 3,
} as const;

export type PolicyInterviewResponseMode = "audio" | "text";

const allowedModes = new Set<PolicyInterviewResponseMode>(["audio", "text"]);
const requiredGuardrails = [
  "same questions",
  ...aiGuardrails.map((guardrail) => guardrail.toLowerCase()),
] as const;

export type PublishableInterviewPlanInput = {
  criteria: InterviewCriterionDraft[];
  guardrails: string[];
  questions: InterviewQuestionDraft[];
  responseModes: PolicyInterviewResponseMode[];
  roleBrief: string;
  roleTitle: string;
};

export type InterviewDraftPublicationMode =
  | "create_initial_snapshot"
  | "create_republished_snapshot"
  | "return_existing_snapshot";

export function planReferencesDisallowedTopic(input: {
  criteria: Pick<InterviewCriterionDraft, "description" | "label">[];
  questions: Pick<InterviewQuestionDraft, "prompt" | "expectedSignal">[];
}): boolean {
  return (
    input.questions.some((question) =>
      textViolatesPolicy(`${question.prompt} ${question.expectedSignal ?? ""}`),
    ) ||
    input.criteria.some((criterion) =>
      textViolatesPolicy(`${criterion.label} ${criterion.description}`),
    )
  );
}

export function getInterviewPlanPublicationIssues(
  input: PublishableInterviewPlanInput,
) {
  const issues: string[] = [];
  const questions = input.questions.filter(
    (question) => question.prompt.trim().length >= 8,
  );
  const criteria = input.criteria.filter(
    (criterion) =>
      criterion.label.trim().length >= 2 &&
      criterion.description.trim().length >= 8,
  );
  const modes = input.responseModes.filter((mode) => allowedModes.has(mode));
  const guardrailText = input.guardrails.join(" ").toLowerCase();

  if (input.roleTitle.trim().length < 2) {
    issues.push("Add a role title.");
  }

  if (input.roleBrief.trim().length < 40) {
    issues.push("Add enough job context for a fair first-screen interview.");
  }

  if (questions.length < interviewPlanPolicy.minQuestionsToPublish) {
    issues.push("Approve at least 3 job-related questions.");
  }

  if (questions.length > interviewPlanPolicy.maxQuestions) {
    issues.push("Keep the interview to 5 questions or fewer.");
  }

  if (criteria.length < interviewPlanPolicy.minCriteriaToPublish) {
    issues.push("Approve at least 3 evaluation criteria.");
  }

  if (criteria.length > interviewPlanPolicy.maxCriteria) {
    issues.push("Keep the evaluation matrix to 5 criteria or fewer.");
  }

  if (modes.length === 0) {
    issues.push("Choose at least one candidate response mode.");
  }

  for (const required of requiredGuardrails) {
    if (!guardrailText.includes(required.toLowerCase())) {
      issues.push("Keep the required compliance guardrails before publishing.");
      break;
    }
  }

  if (planReferencesDisallowedTopic(input)) {
    issues.push(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  }

  return issues;
}

export function isInterviewPlanPublishable(
  input: PublishableInterviewPlanInput,
) {
  return getInterviewPlanPublicationIssues(input).length === 0;
}

export function resolveInterviewDraftPublicationMode({
  draftStatus,
  hasPublishedSnapshot,
}: {
  draftStatus: string;
  hasPublishedSnapshot: boolean;
}): InterviewDraftPublicationMode {
  if (!hasPublishedSnapshot) {
    return "create_initial_snapshot";
  }

  if (draftStatus === "published") {
    return "return_existing_snapshot";
  }

  return "create_republished_snapshot";
}
