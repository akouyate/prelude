import {
  getInterviewPlanGuardrails,
  type GeneratedContentLanguage,
} from "../policies/ai";

export type InterviewSeniority = "junior" | "mid" | "senior";

export type InterviewFocus =
  | "motivation"
  | "role_skills"
  | "situational_judgment"
  | "communication";

export type InterviewQuestionCategory =
  | "motivation"
  | "experience"
  | "skills"
  | "logistics"
  | "availability"
  | "compensation"
  | "custom";

export type InterviewDraftInput = {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  attachmentName?: string;
  /**
   * The INTERVIEW language (plan 2026-08-18, rule 1): questions, criteria, and
   * guardrails are candidate-bound and follow it. Defaults to English, which is
   * what every pre-stamping caller gets.
   */
  language?: GeneratedContentLanguage;
  /**
   * The WORKSPACE language: the rationale is builder copy addressed to the
   * recruiter, not to the candidate. Defaults to `language` so a caller that
   * only knows one language still gets a coherent draft.
   */
  rationaleLanguage?: GeneratedContentLanguage;
};

export type InterviewQuestionDraft = {
  id: string;
  prompt: string;
  expectedSignal: string;
  // Recruiter-authored, signal-aware follow-up the live agent speaks verbatim
  // when it needs one bounded probe. Optional at the type level; the generator
  // fills it (authored-or-derived) for every published question.
  followUpPrompt?: string;
  category: InterviewQuestionCategory;
  required: boolean;
  maxFollowups: number;
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
    expectedSignal: "Role motivation and clarity of expectations",
    category: "motivation",
    required: true,
    maxFollowups: 1,
    source: "agent",
    durationSeconds: 75,
  },
  role_skills: {
    id: "role-skills",
    prompt:
      "Tell us about a recent project or situation that shows you can handle the core responsibilities of this role.",
    expectedSignal: "Relevant experience connected to the job description",
    category: "skills",
    required: true,
    maxFollowups: 1,
    source: "job_description",
    durationSeconds: 90,
  },
  situational_judgment: {
    id: "situational-judgment",
    prompt:
      "Imagine you join the team and discover a priority is unclear but the deadline is close. What would you do first?",
    expectedSignal:
      "Judgment, prioritization, and communication under ambiguity",
    category: "experience",
    required: true,
    maxFollowups: 1,
    source: "job_description",
    durationSeconds: 90,
  },
  communication: {
    id: "communication",
    prompt:
      "Explain a complex topic from your work to someone who does not share your background.",
    expectedSignal: "Clarity, structure, and audience awareness",
    category: "custom",
    required: true,
    maxFollowups: 1,
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

  if (
    roleComplexityKeywords.some((keyword) => normalizedText.includes(keyword))
  ) {
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
  const language = input.language ?? "en";
  const rationaleLanguage = input.rationaleLanguage ?? language;
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
    // Localization is a final pass over the finished structure: ids, categories,
    // durations, and the selection logic above stay single-sourced, and only the
    // recruiter/candidate-visible strings vary by language.
    questions: questions.map((question) =>
      localizeQuestion(question, language, input.attachmentName),
    ),
    criteria: criteria.map((criterion) => localizeCriterion(criterion, language)),
    estimatedMinutes,
    rationale: buildDeterministicRationale({
      jobTitle: input.jobTitle,
      language: rationaleLanguage,
      questionCount: questions.length,
    }),
    guardrails: getInterviewPlanGuardrails(language),
  };
}

function buildDeterministicRationale({
  jobTitle,
  language,
  questionCount,
}: {
  jobTitle: string;
  language: GeneratedContentLanguage;
  questionCount: number;
}) {
  if (language === "fr") {
    return `HireCall a préparé ${questionCount} questions ciblées pour couvrir les éléments probants du poste, le discernement, la motivation et la communication pour ${jobTitle || "ce poste"}.`;
  }

  return `HireCall generated ${questionCount} focused questions to cover role evidence, judgment, motivation, and communication for ${jobTitle || "the role"}.`;
}

function resolveRoleDomain(input: InterviewDraftInput): RoleDomain {
  const normalizedText =
    `${input.jobTitle} ${input.jobDescription}`.toLowerCase();

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
      expectedSignal:
        "AI workflow design, orchestration judgment, and validation discipline",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    executive_marketing: {
      id: "marketing-strategy-role-skills",
      prompt:
        "Tell us about a marketing strategy you owned that changed pipeline, revenue, brand position, or customer acquisition.",
      expectedSignal:
        "Marketing strategy ownership and measurable business impact",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    hospitality: {
      id: "hospitality-operations-role-skills",
      prompt:
        "Tell us about a shift, service period, or guest situation you managed where operations needed to stay smooth under pressure.",
      expectedSignal:
        "Service operations, team coordination, and guest-facing execution",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    hr: {
      id: "hr-screening-role-skills",
      prompt:
        "Tell us about a hiring process you improved, from intake with the hiring manager through candidate follow-up.",
      expectedSignal:
        "Structured recruiting process, stakeholder intake, and candidate experience",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    logistics: {
      id: "logistics-coordination-role-skills",
      prompt:
        "Tell us about a shipment, carrier, warehouse, or delivery issue you coordinated from problem detection to resolution.",
      expectedSignal:
        "Logistics coordination, exception handling, and operational follow-through",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    procurement: {
      id: "procurement-role-skills",
      prompt:
        "Tell us about a supplier, category, or purchasing decision where you balanced cost, quality, risk, and delivery constraints.",
      expectedSignal:
        "Procurement judgment, supplier management, and tradeoff clarity",
      category: "skills",
      required: true,
      maxFollowups: 1,
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
      expectedSignal:
        "Failure handling, human-in-the-loop judgment, and production caution",
      category: "experience",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    executive_marketing: {
      id: "marketing-judgment",
      prompt:
        "Imagine growth is slowing but budget is constrained. How would you decide what to protect, cut, or test first?",
      expectedSignal:
        "Marketing prioritization, budget tradeoffs, and executive judgment",
      category: "experience",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    hospitality: {
      id: "hospitality-judgment",
      prompt:
        "A guest issue escalates during a busy service period while the team is short-staffed. What would you do first?",
      expectedSignal:
        "Guest recovery, prioritization, and team judgment under pressure",
      category: "experience",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    hr: {
      id: "hr-judgment",
      prompt:
        "A hiring manager asks to screen candidates using a criterion that is not job-related. How would you handle it?",
      expectedSignal:
        "Recruiting fairness, stakeholder coaching, and structured process judgment",
      category: "experience",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    logistics: {
      id: "logistics-judgment",
      prompt:
        "A critical delivery is delayed and several teams need updates. What would you verify and communicate first?",
      expectedSignal:
        "Exception handling, prioritization, and operational communication",
      category: "experience",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 90,
    },
    procurement: {
      id: "procurement-judgment",
      prompt:
        "A low-cost supplier creates delivery or compliance risk. How would you decide whether to proceed, renegotiate, or escalate?",
      expectedSignal:
        "Supplier risk judgment, negotiation discipline, and escalation clarity",
      category: "experience",
      required: true,
      maxFollowups: 1,
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

  const questions: Record<
    Exclude<RoleDomain, "general">,
    InterviewQuestionDraft
  > = {
    ai_orchestration: {
      id: "ai-orchestration-communication",
      prompt:
        "Tell us about how you explained AI workflow limitations, risks, or tradeoffs to non-technical stakeholders.",
      expectedSignal: "AI risk communication and cross-functional translation",
      category: "custom",
      required: true,
      maxFollowups: 1,
      source: "agent",
      durationSeconds: 75,
    },
    executive_marketing: {
      id: "marketing-communication",
      prompt:
        "Tell us about a time you aligned sales, product, and marketing around a market, brand, or pipeline priority.",
      expectedSignal:
        "Executive alignment and marketing communication across functions",
      category: "custom",
      required: true,
      maxFollowups: 1,
      source: "agent",
      durationSeconds: 75,
    },
    hospitality: {
      id: "hospitality-communication",
      prompt:
        "Tell us about how you coached a team member or aligned the team during a difficult service period.",
      expectedSignal:
        "Team coaching, service communication, and pressure management",
      category: "custom",
      required: true,
      maxFollowups: 1,
      source: "agent",
      durationSeconds: 75,
    },
    hr: {
      id: "hr-communication",
      prompt:
        "Tell us about a time you helped interviewers use a more structured or fair evaluation process.",
      expectedSignal:
        "Structured hiring communication and stakeholder coaching",
      category: "custom",
      required: true,
      maxFollowups: 1,
      source: "agent",
      durationSeconds: 75,
    },
    logistics: {
      id: "logistics-communication",
      prompt:
        "Tell us about how you kept stakeholders aligned during a shipment exception, delay, or schedule change.",
      expectedSignal: "Logistics communication during operational exceptions",
      category: "custom",
      required: true,
      maxFollowups: 1,
      source: "agent",
      durationSeconds: 75,
    },
    procurement: {
      id: "procurement-communication",
      prompt:
        "Tell us about a negotiation where you improved terms without damaging supplier reliability or trust.",
      expectedSignal:
        "Supplier communication, negotiation judgment, and relationship management",
      category: "custom",
      required: true,
      maxFollowups: 1,
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
  const normalizedText =
    `${input.jobTitle} ${input.jobDescription}`.toLowerCase();
  const domain = resolveRoleDomain(input);
  const questions: InterviewQuestionDraft[] = [];

  if (domain === "executive_marketing") {
    questions.push({
      id: "executive-marketing-ownership",
      prompt:
        "Tell us about a cross-functional revenue, brand, or market outcome you led. What changed because of your decisions?",
      expectedSignal:
        "Executive marketing ownership, cross-functional leadership, and measurable impact",
      category: "experience",
      required: true,
      maxFollowups: 1,
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
      expectedSignal: "Ownership, measurable impact, and seniority alignment",
      category: "experience",
      required: true,
      maxFollowups: 1,
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
      expectedSignal:
        "Customer-facing judgment and communication under pressure",
      category: "experience",
      required: true,
      maxFollowups: 1,
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
      expectedSignal: "Job-related logistics alignment for the hiring process",
      category: "logistics",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 60,
    });
  }

  if (includesAny(normalizedText, ["salary", "compensation", "range"])) {
    questions.push({
      id: "compensation-alignment",
      prompt:
        "If the role's compensation range has been shared, does it align with your expectations for a next step?",
      expectedSignal:
        "Compensation alignment only when the range is part of the hiring process",
      category: "compensation",
      required: true,
      maxFollowups: 1,
      source: "job_description",
      durationSeconds: 60,
    });
  }

  questions.push({
    id: "recruiter-context",
    prompt:
      "What should the recruiter understand about your fit for this role that may not be obvious from your resume?",
    expectedSignal: "Additional recruiter-facing context grounded in the role",
    category: "custom",
    required: true,
    maxFollowups: 1,
    source: "agent",
    durationSeconds: 75,
  });

  if (input.attachmentName) {
    questions.push({
      id: "attachment-context",
      prompt: `Based on ${input.attachmentName}, which part of the role context feels most familiar to you, and where would you need more information?`,
      expectedSignal:
        "Ability to connect attached context to role expectations",
      category: "skills",
      required: true,
      maxFollowups: 1,
      source: "attachment",
      durationSeconds: 90,
    });
  }

  return questions;
}

function getSupplementalCriteria(
  input: InterviewDraftInput,
): InterviewCriterionDraft[] {
  const normalizedText =
    `${input.jobTitle} ${input.jobDescription}`.toLowerCase();
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

/*
 * French templates (plan 2026-08-18, rule 5).
 *
 * Keyed by the template's stable `id`, which is what the selection logic above
 * already produces, so the two catalogues can never drift structurally — only a
 * missing id can drift, and the compliance sweep in the tests walks every role,
 * focus, seniority, and language to catch that.
 *
 * These are written as French recruiter copy, not as a word-for-word rendering
 * of the English: "Parlez-nous d'une fois où…" is what a French recruiter
 * actually says, and the expected signals use the vocabulary a French hiring
 * report is written in. Every string must also clear `textViolatesPolicy`,
 * including the French proxy-phrase list.
 *
 * `{attachment}` is the only placeholder, substituted with the uploaded file
 * name exactly as the English template interpolates it.
 */
const frenchQuestionCopy: Record<
  string,
  { prompt: string; expectedSignal: string }
> = {
  motivation: {
    prompt:
      "Qu'est-ce qui vous a donné envie de postuler à ce poste, et qu'est-ce qui en ferait une bonne suite pour votre parcours ?",
    expectedSignal: "Motivation pour le poste et clarté des attentes",
  },
  "role-skills": {
    prompt:
      "Parlez-nous d'un projet ou d'une situation récente qui montre que vous savez tenir les responsabilités clés de ce poste.",
    expectedSignal: "Expérience pertinente au regard de la fiche de poste",
  },
  "situational-judgment": {
    prompt:
      "Imaginons : vous arrivez dans l'équipe et une priorité n'est pas claire alors que l'échéance approche. Que faites-vous en premier ?",
    expectedSignal:
      "Discernement, priorisation et communication face à l'incertitude",
  },
  communication: {
    prompt:
      "Expliquez un sujet complexe de votre travail à quelqu'un qui ne connaît pas votre métier.",
    expectedSignal: "Clarté, structure et prise en compte de l'interlocuteur",
  },
  "ai-orchestration-role-skills": {
    prompt:
      "Parlez-nous d'un enchaînement de tâches que vous avez automatisé ou orchestré avec des outils d'IA. Quel problème résolvait-il, et comment avez-vous vérifié qu'il fonctionnait ?",
    expectedSignal:
      "Conception de workflows IA, discernement d'orchestration et rigueur de validation",
  },
  "marketing-strategy-role-skills": {
    prompt:
      "Parlez-nous d'une stratégie marketing que vous avez pilotée et qui a fait bouger le pipeline, le chiffre d'affaires, la position de marque ou l'acquisition client.",
    expectedSignal:
      "Pilotage de la stratégie marketing et impact mesurable sur l'activité",
  },
  "hospitality-operations-role-skills": {
    prompt:
      "Parlez-nous d'un service ou d'une situation client que vous avez gérée alors qu'il fallait tenir l'exploitation sous pression.",
    expectedSignal:
      "Exploitation du service, coordination d'équipe et exécution face au client",
  },
  "hr-screening-role-skills": {
    prompt:
      "Parlez-nous d'un processus de recrutement que vous avez amélioré, du brief avec le manager jusqu'au suivi des candidats.",
    expectedSignal:
      "Processus de recrutement structuré, cadrage avec le manager et expérience candidat",
  },
  "logistics-coordination-role-skills": {
    prompt:
      "Parlez-nous d'un incident d'expédition, de transporteur, d'entrepôt ou de livraison que vous avez piloté, de la détection du problème jusqu'à sa résolution.",
    expectedSignal:
      "Coordination logistique, gestion des aléas et suivi opérationnel",
  },
  "procurement-role-skills": {
    prompt:
      "Parlez-nous d'une décision fournisseur, catégorie ou achat où vous avez arbitré entre coût, qualité, risque et délais.",
    expectedSignal:
      "Discernement achats, gestion fournisseurs et clarté des arbitrages",
  },
  "ai-orchestration-judgment": {
    prompt:
      "Si un workflow IA produit des résultats incohérents en production, que vérifiez-vous en premier avant d'en élargir l'usage ?",
    expectedSignal:
      "Traitement des défaillances, place de la validation humaine et prudence en production",
  },
  "marketing-judgment": {
    prompt:
      "Imaginons : la croissance ralentit alors que le budget est contraint. Comment décidez-vous quoi protéger, couper ou tester en premier ?",
    expectedSignal:
      "Priorisation marketing, arbitrages budgétaires et hauteur de vue",
  },
  "hospitality-judgment": {
    prompt:
      "Une réclamation s'envenime en plein coup de feu, avec une équipe en sous-effectif. Que faites-vous en premier ?",
    expectedSignal:
      "Rattrapage client, priorisation et discernement en équipe sous pression",
  },
  "hr-judgment": {
    prompt:
      "Un manager vous demande de présélectionner des candidats sur un critère sans lien avec le poste. Comment traitez-vous sa demande ?",
    expectedSignal:
      "Équité de recrutement, accompagnement du manager et rigueur du processus",
  },
  "logistics-judgment": {
    prompt:
      "Une livraison critique prend du retard et plusieurs équipes attendent des informations. Que vérifiez-vous et que communiquez-vous en premier ?",
    expectedSignal:
      "Gestion des aléas, priorisation et communication opérationnelle",
  },
  "procurement-judgment": {
    prompt:
      "Un fournisseur peu cher fait peser un risque de délai ou de conformité. Comment décidez-vous de poursuivre, de renégocier ou d'escalader ?",
    expectedSignal:
      "Appréciation du risque fournisseur, rigueur de négociation et clarté de l'escalade",
  },
  "ai-orchestration-communication": {
    prompt:
      "Racontez-nous comment vous avez expliqué les limites, les risques ou les arbitrages d'un workflow IA à des interlocuteurs non techniques.",
    expectedSignal:
      "Communication des risques liés à l'IA et traduction entre métiers",
  },
  "marketing-communication": {
    prompt:
      "Racontez-nous une fois où vous avez aligné les ventes, le produit et le marketing sur une priorité de marché, de marque ou de pipeline.",
    expectedSignal:
      "Alignement des directions et communication marketing entre les fonctions",
  },
  "hospitality-communication": {
    prompt:
      "Racontez-nous comment vous avez accompagné un équipier ou remobilisé le collectif pendant un service difficile.",
    expectedSignal:
      "Accompagnement d'équipe, communication de service et gestion de la pression",
  },
  "hr-communication": {
    prompt:
      "Racontez-nous une fois où vous avez aidé des évaluateurs à adopter un processus d'évaluation plus structuré et plus équitable.",
    expectedSignal:
      "Communication sur le recrutement structuré et accompagnement des parties prenantes",
  },
  "logistics-communication": {
    prompt:
      "Racontez-nous comment vous avez tenu les parties prenantes informées pendant un aléa d'expédition, un retard ou un changement de planning.",
    expectedSignal: "Communication logistique en situation d'aléa",
  },
  "procurement-communication": {
    prompt:
      "Racontez-nous une négociation où vous avez amélioré les conditions sans dégrader la fiabilité ni la confiance du fournisseur.",
    expectedSignal:
      "Communication fournisseur, discernement en négociation et gestion de la relation",
  },
  "executive-marketing-ownership": {
    prompt:
      "Parlez-nous d'un résultat transverse — chiffre d'affaires, marque ou marché — que vous avez porté. Qu'est-ce qui a changé grâce à vos décisions ?",
    expectedSignal:
      "Responsabilité marketing de direction, pilotage transverse et impact mesurable",
  },
  "ownership-impact": {
    prompt:
      "Parlez-nous d'une fois où vous avez porté un résultat important de bout en bout. Qu'est-ce qui a changé grâce à votre travail ?",
    expectedSignal:
      "Prise de responsabilité, impact mesurable et cohérence avec le niveau attendu",
  },
  "customer-facing-judgment": {
    prompt:
      "Décrivez une situation où vous avez dû mener une conversation difficile avec un client ou un interlocuteur interne. Qu'avez-vous fait ?",
    expectedSignal: "Discernement face au client et communication sous pression",
  },
  "logistics-alignment": {
    prompt:
      "Quelles contraintes d'organisation du travail, de lieu, de déplacements ou de disponibilité le recruteur doit-il connaître avant d'aller plus loin ?",
    expectedSignal:
      "Éléments pratiques utiles au processus de recrutement, liés au poste",
  },
  "compensation-alignment": {
    prompt:
      "Si la fourchette de rémunération du poste vous a été communiquée, correspond-elle à vos attentes pour aller plus loin ?",
    expectedSignal:
      "Cohérence de rémunération, uniquement lorsque la fourchette fait partie du processus",
  },
  "recruiter-context": {
    prompt:
      "Qu'est-ce que le recruteur devrait comprendre de votre adéquation avec ce poste et qui n'apparaît pas dans votre CV ?",
    expectedSignal:
      "Éléments de contexte supplémentaires pour le recruteur, ancrés dans le poste",
  },
  "attachment-context": {
    prompt:
      "À partir de {attachment}, quelle partie du contexte du poste vous parle le plus, et sur quoi auriez-vous besoin de précisions ?",
    expectedSignal:
      "Capacité à relier le document joint aux attentes du poste",
  },
};

const frenchCriterionCopy: Record<
  string,
  { label: string; description: string }
> = {
  "job-fit": {
    label: "Éléments probants",
    description:
      "Les exemples donnés sont reliés aux responsabilités décrites dans la fiche de poste.",
  },
  judgment: {
    label: "Discernement pratique",
    description:
      "Les premiers réflexes proposés dans des situations réelles sont raisonnables et argumentés.",
  },
  communication: {
    label: "Clarté",
    description:
      "Les réponses sont structurées, précises et faciles à relire rapidement.",
  },
  motivation: {
    label: "Motivation",
    description: "L'intérêt pour le poste est concret plutôt que générique.",
  },
  "ai-orchestration": {
    label: "Orchestration IA",
    description:
      "Les éléments montrent une capacité à concevoir, valider et surveiller des workflows outillés par l'IA, avec une revue humaine là où elle s'impose.",
  },
  "marketing-strategy": {
    label: "Stratégie marketing",
    description:
      "Les exemples relient stratégie, arbitrages budgétaires, lecture du marché et résultats mesurables de croissance ou de marque.",
  },
  "service-operations": {
    label: "Exploitation du service",
    description:
      "Les éléments montrent une capacité à coordonner les équipes, les standards de service et le rattrapage client sous pression.",
  },
  "structured-hiring": {
    label: "Recrutement structuré",
    description:
      "Les éléments montrent des pratiques de présélection équitables et liées au poste, ainsi qu'un cadrage productif avec les managers.",
  },
  "logistics-execution": {
    label: "Exécution logistique",
    description:
      "Les éléments montrent une gestion claire des aléas, une coordination transporteurs ou entrepôt, et une communication opérationnelle.",
  },
  "supplier-judgment": {
    label: "Discernement fournisseurs",
    description:
      "Les éléments montrent des arbitrages équilibrés entre coût, qualité, conformité, délais et risque fournisseur.",
  },
  ownership: {
    label: "Prise de responsabilité",
    description:
      "Les éléments montrent une capacité à porter des résultats et à expliquer l'impact de son travail.",
  },
  "logistics-alignment": {
    label: "Alignement logistique",
    description:
      "Les contraintes de disponibilité, de lieu, de déplacements ou d'organisation sont assez claires pour un suivi par le recruteur.",
  },
};

function localizeQuestion(
  question: InterviewQuestionDraft,
  language: GeneratedContentLanguage,
  attachmentName?: string,
): InterviewQuestionDraft {
  const copy = language === "fr" ? frenchQuestionCopy[question.id] : undefined;

  if (!copy) {
    return question;
  }

  return {
    ...question,
    prompt: copy.prompt.replace("{attachment}", attachmentName ?? ""),
    expectedSignal: copy.expectedSignal,
  };
}

function localizeCriterion(
  criterion: InterviewCriterionDraft,
  language: GeneratedContentLanguage,
): InterviewCriterionDraft {
  const copy = language === "fr" ? frenchCriterionCopy[criterion.id] : undefined;

  return copy ? { ...criterion, ...copy } : criterion;
}
