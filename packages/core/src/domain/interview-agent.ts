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

const defaultFocus = [
  "role_skills",
  "situational_judgment",
  "motivation",
] as const satisfies InterviewFocus[];

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

const roleComplexityKeywords = [
  "cross-functional",
  "stakeholder",
  "lead",
  "strategy",
  "enterprise",
  "ambiguous",
  "ownership",
  "operations",
  "logistics",
  "hospitality",
  "restaurant",
  "shift",
  "travel",
  "remote",
  "hybrid",
] as const;

type RoleDomain =
  | "ai_orchestration"
  | "executive_marketing"
  | "hospitality"
  | "hr"
  | "logistics"
  | "procurement"
  | "general";

export function resolveTargetInterviewQuestionCount({
  focus,
  jobDescription,
  jobTitle,
  seniority,
}: Pick<
  InterviewDraftInput,
  "focus" | "jobDescription" | "jobTitle" | "seniority"
>) {
  const normalizedText = `${jobTitle} ${jobDescription}`.toLowerCase();
  const selectedFocus = focus.length > 0 ? focus : defaultFocus;
  let complexityScore = 0;

  if (seniority === "senior") {
    complexityScore += 1;
  }

  if (selectedFocus.length >= 4) {
    complexityScore += 1;
  }

  if (jobDescription.length >= 520) {
    complexityScore += 1;
  }

  if (roleComplexityKeywords.some((keyword) => normalizedText.includes(keyword))) {
    complexityScore += 1;
  }

  if (complexityScore >= 3) {
    return 5;
  }

  if (complexityScore >= 1) {
    return 4;
  }

  return 3;
}

export function generateDeterministicInterviewDraft(
  input: InterviewDraftInput,
): InterviewAgentDraft {
  const selectedFocus =
    input.focus.length > 0 ? input.focus : [...defaultFocus];
  const targetQuestionCount = resolveTargetInterviewQuestionCount(input);
  const domain = resolveRoleDomain(input);
  const questions = uniqueQuestions([
    ...selectedFocus.map((focus) => buildFocusedQuestion(focus, domain)),
    ...getSupplementalQuestions(input),
  ]).slice(0, targetQuestionCount);

  const criteria = uniqueCriteria([
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
    ...getDomainCriteria(domain),
    ...getSupplementalCriteria(input),
  ]).slice(0, 5);

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
    rationale: `Prelude generated ${questions.length} focused questions to cover role evidence, judgment, motivation, and communication for ${input.jobTitle || "the role"}.`,
    guardrails: [
      "Ask every candidate the same questions in the same order.",
      ...aiGuardrails,
    ],
  };
}

function resolveRoleDomain(input: InterviewDraftInput): RoleDomain {
  const normalizedText = `${input.jobTitle} ${input.jobDescription}`.toLowerCase();

  if (
    includesAny(normalizedText, [
      "ai orchestrator",
      "agent orchestrator",
      "automation",
      "llm",
      "prompt",
      "workflow orchestration",
    ])
  ) {
    return "ai_orchestration";
  }

  if (
    includesAny(normalizedText, [
      "cmo",
      "chief marketing",
      "marketing director",
      "growth",
      "brand",
      "demand generation",
    ])
  ) {
    return "executive_marketing";
  }

  if (
    includesAny(normalizedText, [
      "buyer",
      "procurement",
      "purchasing",
      "supplier",
      "vendor",
      "category manager",
    ])
  ) {
    return "procurement";
  }

  if (
    includesAny(normalizedText, [
      "hr manager",
      "recruiter",
      "talent acquisition",
      "people operations",
      "human resources",
    ])
  ) {
    return "hr";
  }

  if (
    includesAny(normalizedText, [
      "hospitality",
      "restaurant",
      "hotel",
      "front desk",
      "guest",
      "shift manager",
    ])
  ) {
    return "hospitality";
  }

  if (
    includesAny(normalizedText, [
      "logistics",
      "supply chain",
      "shipment",
      "carrier",
      "warehouse",
      "transport",
    ])
  ) {
    return "logistics";
  }

  return "general";
}

function buildFocusedQuestion(
  focus: InterviewFocus,
  domain: RoleDomain,
): InterviewQuestionDraft {
  if (focus === "role_skills") {
    return roleSkillsQuestion(domain);
  }

  if (focus === "situational_judgment") {
    return judgmentQuestion(domain);
  }

  if (focus === "communication") {
    return communicationQuestion(domain);
  }

  return questionLibrary[focus];
}

function roleSkillsQuestion(domain: RoleDomain): InterviewQuestionDraft {
  const questions: Record<RoleDomain, InterviewQuestionDraft> = {
    ai_orchestration: {
      id: "ai-orchestration-role-skills",
      prompt:
        "Tell us about a workflow you automated or orchestrated with AI tools. What problem did it solve, and how did you validate it worked?",
      signal: "AI workflow design, orchestration judgment, and validation discipline",
      source: "job_description",
      durationSeconds: 90,
    },
    executive_marketing: {
      id: "marketing-strategy-role-skills",
      prompt:
        "Tell us about a marketing strategy you owned that changed pipeline, revenue, brand position, or customer acquisition.",
      signal: "Marketing strategy ownership and measurable business impact",
      source: "job_description",
      durationSeconds: 90,
    },
    hospitality: {
      id: "hospitality-operations-role-skills",
      prompt:
        "Tell us about a shift, service period, or guest situation you managed where operations needed to stay smooth under pressure.",
      signal: "Service operations, team coordination, and guest-facing execution",
      source: "job_description",
      durationSeconds: 90,
    },
    hr: {
      id: "hr-screening-role-skills",
      prompt:
        "Tell us about a hiring process you improved, from intake with the hiring manager through candidate follow-up.",
      signal: "Structured recruiting process, stakeholder intake, and candidate experience",
      source: "job_description",
      durationSeconds: 90,
    },
    logistics: {
      id: "logistics-coordination-role-skills",
      prompt:
        "Tell us about a shipment, carrier, warehouse, or delivery issue you coordinated from problem detection to resolution.",
      signal: "Logistics coordination, exception handling, and operational follow-through",
      source: "job_description",
      durationSeconds: 90,
    },
    procurement: {
      id: "procurement-role-skills",
      prompt:
        "Tell us about a supplier, category, or purchasing decision where you balanced cost, quality, risk, and delivery constraints.",
      signal: "Procurement judgment, supplier management, and tradeoff clarity",
      source: "job_description",
      durationSeconds: 90,
    },
    general: questionLibrary.role_skills,
  };

  return questions[domain];
}

function judgmentQuestion(domain: RoleDomain): InterviewQuestionDraft {
  const questions: Record<RoleDomain, InterviewQuestionDraft> = {
    ai_orchestration: {
      id: "ai-orchestration-judgment",
      prompt:
        "If an AI workflow gives inconsistent outputs in production, what would you check first before expanding its use?",
      signal: "Failure handling, human-in-the-loop judgment, and production caution",
      source: "job_description",
      durationSeconds: 90,
    },
    executive_marketing: {
      id: "marketing-judgment",
      prompt:
        "Imagine growth is slowing but budget is constrained. How would you decide what to protect, cut, or test first?",
      signal: "Marketing prioritization, budget tradeoffs, and executive judgment",
      source: "job_description",
      durationSeconds: 90,
    },
    hospitality: {
      id: "hospitality-judgment",
      prompt:
        "A guest issue escalates during a busy service period while the team is short-staffed. What would you do first?",
      signal: "Guest recovery, prioritization, and team judgment under pressure",
      source: "job_description",
      durationSeconds: 90,
    },
    hr: {
      id: "hr-judgment",
      prompt:
        "A hiring manager asks to screen candidates using a criterion that is not job-related. How would you handle it?",
      signal: "Recruiting fairness, stakeholder coaching, and structured process judgment",
      source: "job_description",
      durationSeconds: 90,
    },
    logistics: {
      id: "logistics-judgment",
      prompt:
        "A critical delivery is delayed and several teams need updates. What would you verify and communicate first?",
      signal: "Exception handling, prioritization, and operational communication",
      source: "job_description",
      durationSeconds: 90,
    },
    procurement: {
      id: "procurement-judgment",
      prompt:
        "A low-cost supplier creates delivery or compliance risk. How would you decide whether to proceed, renegotiate, or escalate?",
      signal: "Supplier risk judgment, negotiation discipline, and escalation clarity",
      source: "job_description",
      durationSeconds: 90,
    },
    general: questionLibrary.situational_judgment,
  };

  return questions[domain];
}

function communicationQuestion(domain: RoleDomain): InterviewQuestionDraft {
  if (domain === "general") {
    return questionLibrary.communication;
  }

  const questions: Record<Exclude<RoleDomain, "general">, InterviewQuestionDraft> = {
    ai_orchestration: {
      id: "ai-orchestration-communication",
      prompt:
        "Tell us about how you explained AI workflow limitations, risks, or tradeoffs to non-technical stakeholders.",
      signal: "AI risk communication and cross-functional translation",
      source: "agent",
      durationSeconds: 75,
    },
    executive_marketing: {
      id: "marketing-communication",
      prompt:
        "Tell us about a time you aligned sales, product, and marketing around a market, brand, or pipeline priority.",
      signal: "Executive alignment and marketing communication across functions",
      source: "agent",
      durationSeconds: 75,
    },
    hospitality: {
      id: "hospitality-communication",
      prompt:
        "Tell us about how you coached a team member or aligned the team during a difficult service period.",
      signal: "Team coaching, service communication, and pressure management",
      source: "agent",
      durationSeconds: 75,
    },
    hr: {
      id: "hr-communication",
      prompt:
        "Tell us about a time you helped interviewers use a more structured or fair evaluation process.",
      signal: "Structured hiring communication and stakeholder coaching",
      source: "agent",
      durationSeconds: 75,
    },
    logistics: {
      id: "logistics-communication",
      prompt:
        "Tell us about how you kept stakeholders aligned during a shipment exception, delay, or schedule change.",
      signal: "Logistics communication during operational exceptions",
      source: "agent",
      durationSeconds: 75,
    },
    procurement: {
      id: "procurement-communication",
      prompt:
        "Tell us about a negotiation where you improved terms without damaging supplier reliability or trust.",
      signal: "Supplier communication, negotiation judgment, and relationship management",
      source: "agent",
      durationSeconds: 75,
    },
  };

  return questions[domain];
}

function getDomainCriteria(domain: RoleDomain): InterviewCriterionDraft[] {
  const criteria: Record<RoleDomain, InterviewCriterionDraft[]> = {
    ai_orchestration: [
      {
        id: "ai-orchestration",
        label: "AI orchestration",
        description:
          "Evidence shows the candidate can design, validate, and monitor AI-enabled workflows with human review where needed.",
      },
    ],
    executive_marketing: [
      {
        id: "marketing-strategy",
        label: "Marketing strategy",
        description:
          "Examples connect strategy, budget tradeoffs, market insight, and measurable growth or brand outcomes.",
      },
    ],
    hospitality: [
      {
        id: "service-operations",
        label: "Service operations",
        description:
          "Evidence shows the candidate can coordinate people, service standards, and guest recovery during pressure.",
      },
    ],
    hr: [
      {
        id: "structured-hiring",
        label: "Structured hiring",
        description:
          "Evidence shows fair, job-related screening practices and productive hiring-manager calibration.",
      },
    ],
    logistics: [
      {
        id: "logistics-execution",
        label: "Logistics execution",
        description:
          "Evidence shows clear exception handling, carrier or warehouse coordination, and operational communication.",
      },
    ],
    procurement: [
      {
        id: "supplier-judgment",
        label: "Supplier judgment",
        description:
          "Evidence shows balanced cost, quality, compliance, delivery, and supplier-risk tradeoffs.",
      },
    ],
    general: [],
  };

  return criteria[domain];
}

function getSupplementalQuestions(
  input: InterviewDraftInput,
): InterviewQuestionDraft[] {
  const normalizedText = `${input.jobTitle} ${input.jobDescription}`.toLowerCase();
  const domain = resolveRoleDomain(input);
  const questions: InterviewQuestionDraft[] = [];

  if (domain === "executive_marketing") {
    questions.push({
      id: "executive-marketing-ownership",
      prompt:
        "Tell us about a cross-functional revenue, brand, or market outcome you led. What changed because of your decisions?",
      signal: "Executive marketing ownership, cross-functional leadership, and measurable impact",
      source: "job_description",
      durationSeconds: 90,
    });
  }

  if (
    input.seniority === "senior" ||
    includesAny(normalizedText, ["lead", "manager", "ownership"])
  ) {
    questions.push({
      id: "ownership-impact",
      prompt:
        "Tell us about a time you owned an important outcome end to end. What changed because of your work?",
      signal: "Ownership, measurable impact, and seniority alignment",
      source: "job_description",
      durationSeconds: 90,
    });
  }

  if (
    includesAny(normalizedText, [
      "customer",
      "client",
      "sales",
      "support",
      "hospitality",
      "restaurant",
    ])
  ) {
    questions.push({
      id: "customer-facing-judgment",
      prompt:
        "Describe a situation where you had to handle a difficult customer or stakeholder conversation. What did you do?",
      signal: "Customer-facing judgment and communication under pressure",
      source: "job_description",
      durationSeconds: 90,
    });
  }

  if (
    includesAny(normalizedText, [
      "remote",
      "hybrid",
      "travel",
      "shift",
      "location",
      "paris",
      "onsite",
    ])
  ) {
    questions.push({
      id: "logistics-alignment",
      prompt:
        "What work setup, location, travel, or availability constraints should the recruiter know before moving forward?",
      signal: "Job-related logistics alignment for the hiring process",
      source: "job_description",
      durationSeconds: 60,
    });
  }

  if (includesAny(normalizedText, ["salary", "compensation", "range"])) {
    questions.push({
      id: "compensation-alignment",
      prompt:
        "If the role's compensation range has been shared, does it align with your expectations for a next step?",
      signal: "Compensation alignment only when the range is part of the hiring process",
      source: "job_description",
      durationSeconds: 60,
    });
  }

  questions.push({
    id: "recruiter-context",
    prompt:
      "What should the recruiter understand about your fit for this role that may not be obvious from your resume?",
    signal: "Additional recruiter-facing context grounded in the role",
    source: "agent",
    durationSeconds: 75,
  });

  if (input.attachmentName) {
    questions.push({
      id: "attachment-context",
      prompt: `Based on ${input.attachmentName}, which part of the role context feels most familiar to you, and where would you need more information?`,
      signal: "Ability to connect attached context to role expectations",
      source: "attachment",
      durationSeconds: 90,
    });
  }

  return questions;
}

function getSupplementalCriteria(
  input: InterviewDraftInput,
): InterviewCriterionDraft[] {
  const normalizedText = `${input.jobTitle} ${input.jobDescription}`.toLowerCase();
  const criteria: InterviewCriterionDraft[] = [];

  if (
    input.seniority === "senior" ||
    includesAny(normalizedText, ["lead", "manager", "ownership"])
  ) {
    criteria.push({
      id: "ownership",
      label: "Ownership",
      description:
        "Evidence shows the candidate can own outcomes and explain the impact of their work.",
    });
  }

  if (
    includesAny(normalizedText, [
      "remote",
      "hybrid",
      "travel",
      "shift",
      "location",
    ])
  ) {
    criteria.push({
      id: "logistics-alignment",
      label: "Logistics alignment",
      description:
        "Availability, location, travel, or work setup constraints are clear enough for recruiter follow-up.",
    });
  }

  return criteria;
}

function uniqueQuestions(questions: InterviewQuestionDraft[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    if (seen.has(question.id)) {
      return false;
    }

    seen.add(question.id);
    return true;
  });
}

function uniqueCriteria(criteria: InterviewCriterionDraft[]) {
  const seen = new Set<string>();

  return criteria.filter((criterion) => {
    if (seen.has(criterion.id)) {
      return false;
    }

    seen.add(criterion.id);
    return true;
  });
}

function includesAny(value: string, keywords: readonly string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}
