import type { LiveInterviewRecruiterSummary } from "@prelude/contracts";

export const mockRecruiterSummary: LiveInterviewRecruiterSummary = {
  summaryId: "summary-demo-product-manager",
  sessionId: "is_demo_recruiter_recap",
  candidateId: "candidate-demo-alex",
  planId: "plan-demo-product-manager",
  roleTitle: "Product Manager, Growth",
  status: "complete",
  generatedAt: "2026-06-19T09:30:00.000Z",
  summaryVersion: "mock_v1",
  generator: "llm_assisted",
  disclaimer:
    "This recap supports recruiter review and should not replace the final hiring decision.",
  overview:
    "The candidate gave usable first-screening signals on product discovery and prioritization, but the examples stayed high level on impact measurement. The next recruiter step should validate ownership depth and data fluency.",
  recommendation: {
    value: "needs_recruiter_review",
    label: "Review with targeted follow-ups",
    rationale:
      "There is enough signal to continue, but the recruiter should clarify business impact, analytics ownership, and availability before moving the candidate forward.",
  },
  criteria: [
    {
      criterionId: "criteria_product_discovery",
      label: "Discovery judgment",
      category: "role_fit",
      status: "satisfied",
      note: "Explained a structured discovery approach with user interviews, support tickets, and funnel review.",
      evidence: [
        {
          eventId: "evt_answer_01",
          turnId: "turn_candidate_03",
          questionId: "question_discovery",
          speaker: "candidate",
          quote:
            "I usually start by mapping the funnel, then I interview recent users and customer-facing teams.",
        },
      ],
    },
    {
      criterionId: "criteria_impact",
      label: "Impact evidence",
      category: "experience",
      status: "unclear",
      note: "Mentioned conversion wins, but did not give a precise baseline, metric owner, or measurement window.",
      evidence: [
        {
          eventId: "evt_answer_02",
          turnId: "turn_candidate_07",
          questionId: "question_impact",
          speaker: "candidate",
          quote:
            "We improved activation after changing onboarding, but I do not remember the exact percentage.",
        },
      ],
    },
    {
      criterionId: "criteria_collaboration",
      label: "Cross-functional collaboration",
      category: "communication",
      status: "satisfied",
      note: "Described working with design, engineering, and sales without escalating into process-heavy answers.",
      evidence: [
        {
          eventId: "evt_answer_03",
          turnId: "turn_candidate_10",
          questionId: "question_collaboration",
          speaker: "candidate",
          quote:
            "I align engineering on the constraint, design on the promise, and sales on what we can safely commit.",
        },
      ],
    },
    {
      criterionId: "criteria_logistics",
      label: "Logistics fit",
      category: "availability",
      status: "unclear",
      note: "Availability is plausible, but compensation and start-date constraints were not fully covered.",
      evidence: [],
    },
  ],
  strengths: [
    {
      title: "Structured product thinking",
      explanation:
        "The candidate naturally framed answers around user evidence, funnel context, and prioritization tradeoffs.",
      confidence: "medium",
      evidence: [
        {
          eventId: "evt_answer_01",
          turnId: "turn_candidate_03",
          questionId: "question_discovery",
          speaker: "candidate",
          quote:
            "I try to separate what users say from what the funnel shows before defining the opportunity.",
        },
      ],
    },
    {
      title: "Clear collaboration style",
      explanation:
        "Communication was concise and oriented around alignment with design, engineering, and commercial teams.",
      confidence: "medium",
      evidence: [
        {
          eventId: "evt_answer_03",
          turnId: "turn_candidate_10",
          questionId: "question_collaboration",
          speaker: "candidate",
          quote:
            "The weekly product review was where I made tradeoffs explicit before sprint planning.",
        },
      ],
    },
  ],
  risks: [
    {
      title: "Impact numbers need validation",
      explanation:
        "The candidate gave the shape of the impact but not enough quantitative detail to assess seniority.",
      confidence: "high",
      evidence: [
        {
          eventId: "evt_answer_02",
          turnId: "turn_candidate_07",
          questionId: "question_impact",
          speaker: "candidate",
          quote:
            "I do not remember the exact percentage, but it was visible in the dashboard.",
        },
      ],
    },
  ],
  questionNotes: [
    {
      questionId: "question_discovery",
      prompt:
        "Tell me about a recent product problem you had to understand before deciding what to build.",
      category: "role_fit",
      answerStatus: "satisfied",
      answerSummary:
        "Strong first-pass answer. The candidate described discovery sources and moved from evidence to opportunity definition.",
      evidence: [
        {
          eventId: "evt_answer_01",
          turnId: "turn_candidate_03",
          questionId: "question_discovery",
          speaker: "candidate",
          quote:
            "I usually start by mapping the funnel, then I interview recent users and customer-facing teams.",
        },
      ],
    },
    {
      questionId: "question_impact",
      prompt:
        "What measurable outcome did your work change, and how did you know it changed?",
      category: "experience",
      answerStatus: "unclear",
      answerSummary:
        "The answer had useful direction but lacked metric precision. This should be challenged in recruiter review.",
      evidence: [
        {
          eventId: "evt_answer_02",
          turnId: "turn_candidate_07",
          questionId: "question_impact",
          speaker: "candidate",
          quote:
            "We improved activation after changing onboarding, but I do not remember the exact percentage.",
        },
      ],
    },
    {
      questionId: "question_collaboration",
      prompt:
        "How do you work with engineering and design when priorities are in conflict?",
      category: "communication",
      answerStatus: "satisfied",
      answerSummary:
        "The candidate described a pragmatic collaboration pattern and showed awareness of constraints.",
      evidence: [
        {
          eventId: "evt_answer_03",
          turnId: "turn_candidate_10",
          questionId: "question_collaboration",
          speaker: "candidate",
          quote:
            "I align engineering on the constraint, design on the promise, and sales on what we can safely commit.",
        },
      ],
    },
  ],
  followUpQuestions: [
    "Which activation metric moved, and what was the baseline before the onboarding change?",
    "What part of the roadmap decision did you personally own versus influence?",
    "What start date and compensation range should we validate before the next step?",
  ],
  logisticsNotes: [
    "Candidate appears open to a hybrid setup.",
    "Start-date and compensation constraints still need confirmation.",
  ],
  missingInformation: [
    "Exact business impact and measurement window.",
    "Compensation expectations.",
    "Notice period or earliest start date.",
  ],
  excludedSensitiveSignals: [
    "Accent, age, appearance, or any protected personal characteristic.",
  ],
  audit: {
    sourceEventIds: [
      "evt_answer_01",
      "evt_answer_02",
      "evt_answer_03",
      "evt_summary_01",
    ],
    transcriptTurnIds: [
      "turn_candidate_03",
      "turn_candidate_07",
      "turn_candidate_10",
    ],
    templateVersion: "recruiter_summary_mock_v1",
    generatedFromCompletedSession: true,
  },
};
