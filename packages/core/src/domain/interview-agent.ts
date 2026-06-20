import { aiGuardrails } from "../policies/ai";

export type InterviewSeniority = "junior" | "mid" | "senior";

export type InterviewFocus =
  | "motivation"
  | "role_skills"
  | "situational_judgment"
  | "communication";

export type InterviewDraftInput = {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  attachmentName?: string;
};

export type InterviewQuestionDraft = {
  id: string;
  prompt: string;
  signal: string;
  source: "job_description" | "attachment" | "agent";
  durationSeconds: number;
};

export type InterviewCriterionDraft = {
  id: string;
  label: string;
  description: string;
};

export type InterviewAgentDraft = {
  questions: InterviewQuestionDraft[];
  criteria: InterviewCriterionDraft[];
  estimatedMinutes: number;
  rationale: string;
  guardrails: string[];
};

const questionLibrary: Record<InterviewFocus, InterviewQuestionDraft> = {
  motivation: {
    id: "motivation",
    prompt:
      "What made you interested in this role, and what would make this opportunity a strong next step for you?",
    signal: "Role motivation and clarity of expectations",
    source: "agent",
    durationSeconds: 75,
  },
  role_skills: {
    id: "role-skills",
    prompt:
      "Tell us about a recent project or situation that shows you can handle the core responsibilities of this role.",
    signal: "Relevant experience connected to the job description",
    source: "job_description",
    durationSeconds: 90,
  },
  situational_judgment: {
    id: "situational-judgment",
    prompt:
      "Imagine you join the team and discover a priority is unclear but the deadline is close. What would you do first?",
    signal: "Judgment, prioritization, and communication under ambiguity",
    source: "job_description",
    durationSeconds: 90,
  },
  communication: {
    id: "communication",
    prompt:
      "Explain a complex topic from your work to someone who does not share your background.",
    signal: "Clarity, structure, and audience awareness",
    source: "agent",
    durationSeconds: 75,
  },
};

export function generateMockInterviewDraft(
  input: InterviewDraftInput,
): InterviewAgentDraft {
  const selectedFocus =
    input.focus.length > 0
      ? input.focus
      : ([
          "role_skills",
          "situational_judgment",
          "motivation",
        ] satisfies InterviewFocus[]);
  const maxQuestions =
    input.seniority === "senior" || input.attachmentName ? 4 : 3;
  const selectedQuestions = selectedFocus
    .slice(0, maxQuestions)
    .map((focus) => questionLibrary[focus]);

  const questions =
    input.attachmentName && selectedQuestions.length < maxQuestions
      ? [
          ...selectedQuestions,
          {
            id: "attachment-context",
            prompt: `Based on ${input.attachmentName}, which part of the role context feels most familiar to you, and where would you need more information?`,
            signal: "Ability to connect attached context to role expectations",
            source: "attachment" as const,
            durationSeconds: 90,
          },
        ]
      : selectedQuestions;

  const criteria: InterviewCriterionDraft[] = [
    {
      id: "job-fit",
      label: "Relevant evidence",
      description:
        "Examples are tied to responsibilities in the job description.",
    },
    {
      id: "judgment",
      label: "Practical judgment",
      description:
        "The candidate can make reasonable first moves in realistic situations.",
    },
    {
      id: "communication",
      label: "Clarity",
      description:
        "Answers are structured, specific, and easy to review quickly.",
    },
    {
      id: "motivation",
      label: "Motivation",
      description: "Interest in the role is concrete rather than generic.",
    },
  ];

  const estimatedMinutes = Math.max(
    4,
    Math.round(
      questions.reduce((sum, question) => sum + question.durationSeconds, 0) /
        60,
    ),
  );

  return {
    questions,
    criteria,
    estimatedMinutes,
    rationale: `I kept this to ${questions.length} focused questions while still covering role evidence, judgment, and motivation for ${input.jobTitle || "the role"}.`,
    guardrails: [
      "Ask every candidate the same questions in the same order.",
      ...aiGuardrails,
    ],
  };
}
