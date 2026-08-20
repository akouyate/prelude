/**
 * Public demo catalogue. Adding a role is configuration-only: seed one job and
 * draft from this object, then the candidate app snapshots it at admission.
 * Keep every identifier stable so repeated deploys are idempotent.
 */
export const MARKETING_DEMO_ROLE_FIXTURES = [
  {
    id: "mdr_account_executive_v1",
    slug: "account-executive",
    enabled: true,
    displayOrder: 10,
    publicTitle: "Account Executive",
    publicSummary:
      "Practice a discovery-led commercial interview with realistic follow-ups.",
    publicBadge: "Sales",
    locale: "en",
    version: 1,
    job: {
      id: "job_marketing_demo_account_executive_v1",
      title: "Account Executive",
      description:
        "Own consultative discovery, pipeline progression, and commercial close for growing B2B customers.",
    },
    draft: {
      id: "draft_marketing_demo_account_executive_v1",
      roleTitle: "Account Executive",
      roleBrief:
        "Own consultative discovery, pipeline progression, and commercial close for growing B2B customers.",
      seniority: "mid",
      focus: ["motivation", "role_skills", "communication"],
      responseModes: ["audio"],
      estimatedMinutes: 8,
      rationale: "A concise, discovery-led commercial first screen.",
      criteria: [
        {
          id: "ae_discovery",
          label: "Discovery",
          description:
            "Uses structured questions to uncover customer needs and decision context.",
        },
        {
          id: "ae_ownership",
          label: "Commercial ownership",
          description:
            "Explains concrete actions and trade-offs across a sales cycle.",
        },
      ],
      guardrails: [
        "Do not ask about protected characteristics or personal circumstances.",
        "Keep the interview focused on role-relevant experience.",
      ],
      questions: [
        {
          id: "ae_q1",
          category: "motivation",
          prompt: "What attracts you to a consultative Account Executive role?",
          expectedSignal:
            "Connects motivation to customer discovery, ownership, and outcomes.",
          followUpPrompt: "Which part of that work gives you the most energy?",
        },
        {
          id: "ae_q2",
          category: "experience",
          prompt:
            "Tell me about a discovery conversation that changed how you approached an opportunity.",
          expectedSignal:
            "Gives a specific example with questions, learning, and changed action.",
          followUpPrompt:
            "What did you do differently after that conversation?",
        },
        {
          id: "ae_q3",
          category: "skills",
          prompt:
            "How do you keep momentum when several stakeholders disagree on the next step?",
          expectedSignal:
            "Shows stakeholder mapping, clear next steps, and respectful persistence.",
          followUpPrompt: "How do you decide who to involve first?",
        },
      ],
    },
    postInterviewQuestions: [
      {
        id: "confidence",
        type: "scale",
        prompt: "How confident did you feel during the conversation?",
        required: true,
        min: 1,
        max: 5,
        minLabel: "Not yet confident",
        maxLabel: "Very confident",
      },
      {
        id: "focus_area",
        type: "single_select",
        prompt: "Which area would you most like feedback on?",
        required: true,
        options: [
          { label: "Answer structure", value: "structure" },
          { label: "Concrete examples", value: "examples" },
          { label: "Clarity and concision", value: "clarity" },
        ],
      },
      {
        id: "reflection",
        type: "short_text",
        prompt: "What answer would you improve if you tried again?",
        required: false,
        maxLength: 400,
      },
    ],
  },
  {
    id: "mdr_product_manager_v1",
    slug: "product-manager",
    enabled: true,
    displayOrder: 20,
    publicTitle: "Product Manager",
    publicSummary:
      "Try a product interview focused on discovery, prioritization, and stakeholder judgment.",
    publicBadge: "Product",
    locale: "en",
    version: 1,
    job: {
      id: "job_marketing_demo_product_manager_v1",
      title: "Product Manager",
      description:
        "Lead discovery and prioritization for a B2B product while aligning customers, design, and engineering.",
    },
    draft: {
      id: "draft_marketing_demo_product_manager_v1",
      roleTitle: "Product Manager",
      roleBrief:
        "Lead discovery and prioritization for a B2B product while aligning customers, design, and engineering.",
      seniority: "mid",
      focus: ["role_skills", "situational_judgment", "communication"],
      responseModes: ["audio"],
      estimatedMinutes: 8,
      rationale: "A structured product judgment and communication screen.",
      criteria: [
        {
          id: "pm_discovery",
          label: "Product discovery",
          description:
            "Separates evidence from assumptions and explains how learning changes direction.",
        },
        {
          id: "pm_judgment",
          label: "Prioritization judgment",
          description:
            "Makes explicit trade-offs and communicates them to stakeholders.",
        },
      ],
      guardrails: [
        "Do not ask about protected characteristics or personal circumstances.",
        "Keep the interview focused on role-relevant experience.",
      ],
      questions: [
        {
          id: "pm_q1",
          category: "experience",
          prompt:
            "Tell me about a product assumption that customer evidence proved wrong.",
          expectedSignal:
            "Explains the initial assumption, evidence, decision, and measurable learning.",
          followUpPrompt: "What did you change as a direct result?",
        },
        {
          id: "pm_q2",
          category: "skills",
          prompt:
            "How do you choose between an urgent customer request and a strategic roadmap commitment?",
          expectedSignal:
            "Uses impact, evidence, constraints, and reversible decision framing.",
          followUpPrompt: "How would you explain that choice to the customer?",
        },
        {
          id: "pm_q3",
          category: "custom",
          prompt:
            "Describe a time engineering or design strongly disagreed with your proposed direction.",
          expectedSignal:
            "Shows listening, shared framing, decision ownership, and healthy conflict.",
          followUpPrompt: "What did you learn from the disagreement?",
        },
      ],
    },
    postInterviewQuestions: [
      {
        id: "confidence",
        type: "scale",
        prompt: "How confident did you feel during the conversation?",
        required: true,
        min: 1,
        max: 5,
        minLabel: "Not yet confident",
        maxLabel: "Very confident",
      },
      {
        id: "focus_area",
        type: "single_select",
        prompt: "Which area would you most like feedback on?",
        required: true,
        options: [
          { label: "Answer structure", value: "structure" },
          { label: "Decision trade-offs", value: "tradeoffs" },
          { label: "Clarity and concision", value: "clarity" },
        ],
      },
      {
        id: "reflection",
        type: "short_text",
        prompt: "What answer would you improve if you tried again?",
        required: false,
        maxLength: 400,
      },
    ],
  },
];
