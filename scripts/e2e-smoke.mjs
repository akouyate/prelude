#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));
const runId = sanitizeRunId(
  args.runId ?? process.env.E2E_SMOKE_RUN_ID ?? timestampRunId(),
);
const reset = Boolean(args.reset ?? process.env.E2E_SMOKE_RESET === "1");
const allowLiveLlm = Boolean(
  args.liveLlm ?? process.env.E2E_SMOKE_LIVE_LLM === "1",
);
const baseUrl = trimTrailingSlash(
  args.consoleUrl ?? process.env.CONSOLE_URL ?? "http://localhost:3000",
);

try {
  if (args.help) {
    console.log(helpText());
    process.exit(0);
  }

  if (allowLiveLlm && process.env.ALLOW_LIVE_LLM_TESTS !== "1") {
    fail(
      "Live LLM smoke is gated. Set ALLOW_LIVE_LLM_TESTS=1 to opt into paid provider calls.",
    );
  }

  const report = await runSmoke({ allowLiveLlm, baseUrl, reset, runId });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMarkdown(report));
  }

  if (args.strict && report.decision !== "Pass") {
    process.exitCode = 1;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await prisma.$disconnect();
}

async function runSmoke({ allowLiveLlm, baseUrl, reset, runId }) {
  if (reset) {
    await deleteSmokeData(runId);
  }

  const now = new Date();
  const ids = idsFor(runId);
  const recruiterEmail =
    process.env.MOCK_CLERK_USER_EMAIL || "recruiter@prelude.ai";
  const draft = interviewDraft();
  const publicToken = `iv_e2e_${runId}`;
  const resumeToken = `resume_e2e_${runId}`;
  const realtimeSessionId = `is_e2e_${runId}`;
  const candidateSessionId = `cs_e2e_${runId}`;

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      create: {
        clerkUserId: ids.clerkUserId,
        email: recruiterEmail,
        name: "Prelude E2E Recruiter",
      },
      update: {
        email: recruiterEmail,
        name: "Prelude E2E Recruiter",
      },
      where: { clerkUserId: ids.clerkUserId },
    });

    const organization = await tx.organization.upsert({
      create: {
        clerkOrganizationId: ids.clerkOrganizationId,
        companySize: "11-50",
        defaultInterviewMode: "audio",
        hiringFocus: "recruiting",
        name: `Prelude E2E ${runId}`,
        onboardingCompletedAt: now,
        onboardingState: {
          companyName: `Prelude E2E ${runId}`,
          companySize: "11-50",
          hiringFocus: "recruiting",
          interviewMode: "audio",
          jobSource: "manual",
          onboardingRole: "owner",
        },
        onboardingStep: "done",
      },
      update: {
        companySize: "11-50",
        defaultInterviewMode: "audio",
        hiringFocus: "recruiting",
        name: `Prelude E2E ${runId}`,
        onboardingCompletedAt: now,
        onboardingStep: "done",
      },
      where: { clerkOrganizationId: ids.clerkOrganizationId },
    });

    await tx.organizationMembership.upsert({
      create: {
        onboardingRole: "owner",
        organizationId: organization.id,
        role: "owner",
        status: "active",
        userId: user.id,
      },
      update: {
        onboardingRole: "owner",
        role: "owner",
        status: "active",
      },
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
    });

    await tx.jobSourceConnection.upsert({
      create: {
        externalLabel: "Manual smoke role",
        organizationId: organization.id,
        provider: "manual",
        status: "manual",
      },
      update: {
        externalLabel: "Manual smoke role",
        status: "manual",
      },
      where: {
        organizationId_provider: {
          organizationId: organization.id,
          provider: "manual",
        },
      },
    });

    const job = await tx.job.upsert({
      create: {
        description: smokeRoleBrief(),
        id: ids.jobId,
        location: "Paris, remote-friendly",
        organizationId: organization.id,
        sourceExternalId: `manual:e2e-smoke:${runId}`,
        sourceProvider: "manual",
        status: "published",
        title: "Customer Success Manager",
      },
      update: {
        description: smokeRoleBrief(),
        location: "Paris, remote-friendly",
        organizationId: organization.id,
        status: "published",
        title: "Customer Success Manager",
      },
      where: { id: ids.jobId },
    });

    const interviewDraftRecord = await tx.interviewDraft.upsert({
      create: {
        criteria: draft.criteria,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["communication", "role_skills", "motivation"],
        guardrails: draft.guardrails,
        id: ids.draftId,
        jobId: job.id,
        organizationId: organization.id,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: smokeRoleBrief(),
        roleTitle: "Customer Success Manager",
        seniority: "mid",
        status: "published",
      },
      update: {
        criteria: draft.criteria,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["communication", "role_skills", "motivation"],
        guardrails: draft.guardrails,
        questions: draft.questions,
        rationale: draft.rationale,
        organizationId: organization.id,
        jobId: job.id,
        responseModes: ["audio", "text"],
        roleBrief: smokeRoleBrief(),
        roleTitle: "Customer Success Manager",
        seniority: "mid",
        status: "published",
      },
      where: { id: ids.draftId },
    });

    await tx.interview.upsert({
      create: {
        criteria: draft.criteria,
        draftId: interviewDraftRecord.id,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["communication", "role_skills", "motivation"],
        guardrails: draft.guardrails,
        id: ids.interviewId,
        jobId: job.id,
        organizationId: organization.id,
        publicToken,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: smokeRoleBrief(),
        roleTitle: "Customer Success Manager",
        seniority: "mid",
        status: "published",
      },
      update: {
        criteria: draft.criteria,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["communication", "role_skills", "motivation"],
        guardrails: draft.guardrails,
        draftId: interviewDraftRecord.id,
        jobId: job.id,
        organizationId: organization.id,
        publicToken,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: smokeRoleBrief(),
        roleTitle: "Customer Success Manager",
        seniority: "mid",
        status: "published",
      },
      where: { id: ids.interviewId },
    });

    await tx.candidateSession.upsert({
      create: {
        candidateEmail: `candidate+${runId}@example.com`,
        candidateName: "Ada Martin",
        completedAt: addSeconds(now, 180),
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: addSeconds(now, 10),
        id: candidateSessionId,
        interviewId: ids.interviewId,
        jobId: job.id,
        organizationId: organization.id,
        realtimeSessionId,
        resumeToken,
        reviewStatus: "to_review",
        startedAt: addSeconds(now, 10),
        status: "completed",
      },
      update: {
        candidateEmail: `candidate+${runId}@example.com`,
        candidateName: "Ada Martin",
        completedAt: addSeconds(now, 180),
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: addSeconds(now, 10),
        interviewId: ids.interviewId,
        jobId: job.id,
        organizationId: organization.id,
        realtimeSessionId,
        resumeToken,
        reviewStatus: "to_review",
        startedAt: addSeconds(now, 10),
        status: "completed",
      },
      where: { id: candidateSessionId },
    });

    await tx.liveInterviewEvent.deleteMany({
      where: { sessionId: realtimeSessionId },
    });
    await tx.liveInterviewSession.upsert({
      create: {
        allowedModalities: ["audio", "text"],
        candidateId: candidateSessionId,
        createdAt: addSeconds(now, 10),
        id: realtimeSessionId,
        interviewPlanId: ids.interviewId,
        livekitRoomName: `prelude-${realtimeSessionId}`,
        status: "completed",
        updatedAt: addSeconds(now, 180),
      },
      update: {
        allowedModalities: ["audio", "text"],
        candidateId: candidateSessionId,
        interviewPlanId: ids.interviewId,
        livekitRoomName: `prelude-${realtimeSessionId}`,
        status: "completed",
        updatedAt: addSeconds(now, 180),
      },
      where: { id: realtimeSessionId },
    });

    await tx.liveInterviewEvent.createMany({
      data: buildEvents({
        candidateSessionId,
        questions: draft.questions,
        realtimeSessionId,
        startedAt: addSeconds(now, 10),
      }),
    });

    const brief = buildBrief({
      candidateSessionId,
      criteria: draft.criteria,
      runId,
    });
    await tx.candidateBrief.upsert({
      create: {
        candidateSessionId,
        evidence: brief.evidenceRefs,
        generatedAt: addSeconds(now, 190),
        limitations: brief.summary.limitations,
        modelName: allowLiveLlm
          ? "openai-live-smoke-requested"
          : "candidate-brief-v1",
        modelProvider: allowLiveLlm ? "openai_guarded_smoke" : "mock_e2e_smoke",
        organizationId: organization.id,
        recommendation: brief.summary.suggestedNextStep,
        schemaVersion: 1,
        status: "completed",
        summaryJson: brief.summary,
      },
      update: {
        evidence: brief.evidenceRefs,
        failedReason: null,
        generatedAt: addSeconds(now, 190),
        limitations: brief.summary.limitations,
        modelName: allowLiveLlm
          ? "openai-live-smoke-requested"
          : "candidate-brief-v1",
        modelProvider: allowLiveLlm ? "openai_guarded_smoke" : "mock_e2e_smoke",
        organizationId: organization.id,
        recommendation: brief.summary.suggestedNextStep,
        schemaVersion: 1,
        status: "completed",
        summaryJson: brief.summary,
      },
      where: { candidateSessionId },
    });
  });

  const [candidateSession, runtimeSession, brief, eventCount, transcriptTurns] =
    await Promise.all([
      prisma.candidateSession.findUniqueOrThrow({
        include: { interview: true, job: true, organization: true },
        where: { id: candidateSessionId },
      }),
      prisma.liveInterviewSession.findUniqueOrThrow({
        where: { id: realtimeSessionId },
      }),
      prisma.candidateBrief.findUniqueOrThrow({
        where: { candidateSessionId },
      }),
      prisma.liveInterviewEvent.count({
        where: { sessionId: realtimeSessionId },
      }),
      prisma.liveInterviewEvent.count({
        where: {
          sessionId: realtimeSessionId,
          type: { in: ["candidate_turn_finalized", "question_asked"] },
        },
      }),
    ]);

  const dashboardUrl = `${baseUrl}/`;
  const interviewDetailUrl = `${baseUrl}/interviews/${candidateSession.interviewId}`;
  const candidateDetailUrl = `${baseUrl}/interviews/${candidateSession.realtimeSessionId}`;
  const candidateUrl = `${baseUrl}/interview/${candidateSession.interview.publicToken}`;
  const summaryJson = isRecord(brief.summaryJson) ? brief.summaryJson : {};
  const evaluationMatrix = isRecord(summaryJson.evaluationMatrix)
    ? summaryJson.evaluationMatrix
    : null;
  const matrixRecommendation =
    evaluationMatrix &&
    typeof evaluationMatrix.recommendationLabel === "string"
      ? evaluationMatrix.recommendationLabel
      : null;
  const decision =
    candidateSession.status === "completed" &&
    runtimeSession.status === "completed" &&
    brief.status === "completed" &&
    evaluationMatrix !== null &&
    eventCount > 0
      ? "Pass"
      : "Blocker";

  return {
    generatedAt: new Date().toISOString(),
    runId,
    mode: allowLiveLlm ? "live-llm-explicit" : "mock-llm-default",
    decision,
    organization: {
      id: candidateSession.organizationId,
      name: candidateSession.organization.name,
    },
    job: {
      id: candidateSession.jobId,
      title: candidateSession.job.title,
    },
    interview: {
      id: candidateSession.interviewId,
      publicToken: candidateSession.interview.publicToken,
    },
    candidateSession: {
      id: candidateSession.id,
      realtimeSessionId: candidateSession.realtimeSessionId,
      status: candidateSession.status,
      reviewStatus: candidateSession.reviewStatus,
    },
    runtime: {
      sessionId: runtimeSession.id,
      status: runtimeSession.status,
      eventCount,
      transcriptTurnCount: transcriptTurns,
    },
    brief: {
      id: brief.id,
      status: brief.status,
      modelProvider: brief.modelProvider,
      generatedAt: brief.generatedAt?.toISOString() ?? null,
      hasEvaluationMatrix: evaluationMatrix !== null,
      matrixRecommendation,
    },
    urls: {
      dashboard: dashboardUrl,
      interviewDetail: interviewDetailUrl,
      candidateDetail: candidateDetailUrl,
      candidate: candidateUrl,
    },
  };
}

function buildEvents({
  candidateSessionId,
  questions,
  realtimeSessionId,
  startedAt,
}) {
  const events = [];
  const push = ({ actor, offset, payload, type }) => {
    const sequenceNumber = events.length + 1;
    events.push({
      actor,
      candidateId: candidateSessionId,
      id: `evt_${realtimeSessionId}_${sequenceNumber}_${type}`,
      idempotencyKey: `${realtimeSessionId}:${sequenceNumber}:${type}`,
      occurredAt: addSeconds(startedAt, offset),
      payload,
      providerMetadata: { smoke: true },
      sequenceNumber,
      sessionId: realtimeSessionId,
      type,
    });
  };

  push({
    actor: "system",
    offset: 0,
    payload: {
      agentParticipantId: `agent-${realtimeSessionId}`,
      provider: "mock",
    },
    type: "session_started",
  });
  push({
    actor: "candidate",
    offset: 2,
    payload: {
      candidateParticipantId: `candidate-${candidateSessionId}`,
      modes: ["audio", "form"],
      roomName: `prelude-${realtimeSessionId}`,
    },
    type: "candidate_joined",
  });
  push({
    actor: "candidate",
    offset: 5,
    payload: {
      audio: true,
      candidateParticipantId: `candidate-${candidateSessionId}`,
      publishedTracks: ["microphone"],
      roomName: `prelude-${realtimeSessionId}`,
      video: false,
    },
    type: "candidate_media_ready",
  });

  questions.forEach((question, index) => {
    const baseOffset = 15 + index * 45;
    const interviewerTurnId = `turn_${question.id}_interviewer`;
    const candidateTurnId = `turn_${question.id}_candidate`;
    push({
      actor: "agent",
      offset: baseOffset,
      payload: {
        prompt: question.prompt,
        questionId: question.id,
        questionIndex: index,
        transcriptTurn: {
          endedAt: addSeconds(startedAt, baseOffset + 4).toISOString(),
          questionId: question.id,
          sessionId: realtimeSessionId,
          speaker: "interviewer",
          startedAt: addSeconds(startedAt, baseOffset).toISOString(),
          text: question.prompt,
          turnId: interviewerTurnId,
        },
      },
      type: "question_asked",
    });
    push({
      actor: "candidate",
      offset: baseOffset + 16,
      payload: {
        completionReason: "answered",
        questionId: question.id,
        transcriptTurn: {
          endedAt: addSeconds(startedAt, baseOffset + 30).toISOString(),
          questionId: question.id,
          sessionId: realtimeSessionId,
          speaker: "candidate",
          startedAt: addSeconds(startedAt, baseOffset + 17).toISOString(),
          text: candidateAnswerFor(question.id),
          turnId: candidateTurnId,
        },
      },
      type: "candidate_turn_finalized",
    });
    push({
      actor: "agent",
      offset: baseOffset + 31,
      payload: {
        attemptIndex: 1,
        classification: "complete",
        confidence: 0.86,
        evaluationMatrix: {
          challenge: { needed: false, prompt: null, reason: null },
          dimensions: [
            {
              name: "concreteness",
              rationale: "Answer included concrete scope and actions.",
              score: 3,
            },
            {
              name: "relevance",
              rationale: "Answer mapped to customer success responsibilities.",
              score: 3,
            },
            {
              name: "coherence",
              rationale: "Answer was easy to follow for first screening.",
              score: 3,
            },
          ],
          evaluatorMode: "heuristic_v1",
          maxScore: 15,
          overallScore: 9,
        },
        evaluatorVersion: "e2e-smoke-v1",
        policyAction: "complete_question",
        questionId: question.id,
        questionIndex: index,
        reasonCodes: ["e2e_smoke", "sufficient_answer"],
        turnIds: [candidateTurnId],
      },
      type: "answer_evaluated",
    });
    push({
      actor: "agent",
      offset: baseOffset + 32,
      payload: {
        completionReason: "answered",
        questionId: question.id,
      },
      type: "question_completed",
    });
  });

  push({
    actor: "agent",
    offset: 170,
    payload: {
      closing:
        "Thank you, Ada. The recruiter will review your answers and follow up with the next step.",
      completedQuestions: questions.length,
      totalQuestions: questions.length,
      transcriptTurn: {
        endedAt: addSeconds(startedAt, 176).toISOString(),
        questionId: questions.at(-1)?.id,
        sessionId: realtimeSessionId,
        speaker: "interviewer",
        startedAt: addSeconds(startedAt, 170).toISOString(),
        text: "Thank you, Ada. The recruiter will review your answers and follow up with the next step.",
        turnId: "turn_session_closing",
      },
    },
    type: "session_closing",
  });
  push({
    actor: "system",
    offset: 180,
    payload: {
      completedQuestions: questions.length,
      completedReason: "all_questions_completed",
      totalQuestions: questions.length,
    },
    type: "session_completed",
  });

  return events;
}

function buildBrief({ candidateSessionId, criteria, runId }) {
  const assessments = criteria.map((criterion) => smokeCriterionAssessment(criterion));
  const evidenceRefs = assessments.map((assessment) => ({
    criterionId: assessment.criterion.id,
    eventId: null,
    questionId: assessment.questionId,
    transcriptTurnId: assessment.transcriptTurnId,
  }));
  const summary = {
    candidateSessionId,
    criteria: assessments.map((assessment) => ({
      criterionId: assessment.criterion.id,
      evidence: [assessment.evidence],
      label: assessment.criterion.label,
      rationale: assessment.rationale,
      status: "Medium",
    })),
    evaluationMatrix: {
      criteria: assessments.map((assessment) => ({
        category: assessment.category,
        confidence: "medium",
        criterionId: assessment.criterion.id,
        evidence: [assessment.evidence],
        followUps: assessment.followUps,
        label: assessment.criterion.label,
        missingInfo: assessment.missingInfo,
        rationale: assessment.matrixRationale,
        status: "partial",
      })),
      facts: [
        "Candidate described involvement in enterprise customer onboarding.",
        "Candidate described cross-functional work with support, product, and customer success.",
        "Candidate proposed customer recovery steps with owners, dates, and communication cadence.",
      ],
      inferredSignals: [
        {
          confidence: "medium",
          evidence: [smokeEvidence("role-skills")],
          label: "Enterprise onboarding coordination",
        },
        {
          confidence: "medium",
          evidence: [smokeEvidence("communication")],
          label: "Structured at-risk customer response",
        },
      ],
      missingInfo: [
        "Exact activation, churn, or adoption metric movement.",
        "Candidate's direct ownership versus team contribution.",
        "Commercial impact and stakeholder seniority.",
      ],
      recommendationConfidence: "medium",
      recommendationLabel: "targeted_follow_up",
      recommendationRationale:
        "The transcript contains useful first-screen signal for a CSM role, but the recruiter should validate measurable customer impact and ownership before advancing.",
      recommendedNextStep: "to_review",
      risks: [
        "The smoke candidate data is synthetic and should only validate workflow plumbing.",
        "Metrics and exact ownership remain unverified.",
      ],
    },
    limitations: [
      "This brief supports human review only and is not an automated hiring decision.",
      "Do not assess protected attributes, appearance, accent, tone, emotion, personality, or biometrics.",
      `Generated by local E2E smoke run ${runId}.`,
    ],
    pointsToClarify: [
      "What activation, churn, or adoption metric changed after the onboarding work?",
      "What was Ada directly responsible for versus owned by the broader team?",
      "How senior were the customer stakeholders involved in the recovery plan?",
    ],
    risks: [
      "The smoke candidate data is synthetic and should only validate workflow plumbing.",
      "Metrics and ownership need recruiter validation before moving forward.",
    ],
    status: "completed",
    strengths: [
      "Relevant evidence: candidate described onboarding projects and cross-functional coordination.",
      "Practical judgment: candidate proposed a short recovery plan with owners and dates.",
      "Communication: answers were concise enough for first-screening review.",
    ],
    suggestedNextStep: "to_review",
    summary:
      "Ada Martin completed the Customer Success Manager smoke interview with persisted transcript evidence, answer evaluations, and a matrix-backed recruiter brief for human review.",
  };

  return { evidenceRefs, summary };
}

function smokeCriterionAssessment(criterion) {
  const questionId = smokeQuestionForCriterion(criterion.id);
  const evidence = smokeEvidence(questionId);
  const shared = {
    criterion,
    evidence,
    questionId,
    transcriptTurnId: evidence.transcriptTurnId,
  };

  if (criterion.id === "relevant-evidence") {
    return {
      ...shared,
      category: "experience",
      followUps: [
        "Which activation or churn metric moved after the onboarding changes?",
        "How many enterprise customers were in scope?",
      ],
      matrixRationale:
        "The answer is relevant to enterprise onboarding and cross-functional CSM work, but the measurable impact is not quantified.",
      missingInfo: [
        "Activation or churn metric movement.",
        "Scale of the customer portfolio involved.",
      ],
      rationale:
        "Candidate gave job-related onboarding evidence, but the exact customer impact still needs validation.",
    };
  }

  if (criterion.id === "practical-judgment") {
    return {
      ...shared,
      category: "role_specific",
      followUps: [
        "What would you do first if product cannot commit to the customer's requested fix?",
        "How would you decide whether to escalate commercially?",
      ],
      matrixRationale:
        "The answer shows a structured customer recovery approach, but trade-offs and escalation thresholds are not yet clear.",
      missingInfo: [
        "Escalation threshold.",
        "Commercial or renewal risk assessment.",
      ],
      rationale:
        "Candidate described a practical recovery plan, but the recruiter should probe trade-offs and escalation judgment.",
    };
  }

  return {
    ...shared,
    category: "communication",
    followUps: [
      "How would you explain the recovery timeline if the customer is already frustrated?",
    ],
    matrixRationale:
      "The answer is clear and recruiter-readable, but it does not yet show how the candidate adapts communication to senior stakeholders.",
    missingInfo: ["Stakeholder communication depth."],
    rationale:
      "Candidate communicated in a structured way, with enough clarity for first-screening review.",
  };
}

function smokeQuestionForCriterion(criterionId) {
  if (criterionId === "relevant-evidence") {
    return "role-skills";
  }
  if (criterionId === "practical-judgment") {
    return "communication";
  }
  return "motivation";
}

function smokeEvidence(questionId) {
  return {
    questionId,
    text: candidateAnswerFor(questionId),
    transcriptTurnId: `turn_${questionId}_candidate`,
  };
}

function interviewDraft() {
  return {
    criteria: [
      {
        description:
          "Examples are tied to customer onboarding and retention work.",
        id: "relevant-evidence",
        label: "Relevant evidence",
      },
      {
        description:
          "The candidate explains trade-offs and first actions clearly.",
        id: "practical-judgment",
        label: "Practical judgment",
      },
      {
        description: "Answers are structured, specific, and easy to review.",
        id: "communication",
        label: "Communication",
      },
    ],
    estimatedMinutes: 4,
    guardrails: [
      "Ask every candidate the same questions in the same order.",
      "Evaluate answers against job-related criteria only.",
      "Do not analyze face, accent, tone, emotion, or protected attributes.",
      "Keep the final decision with the recruiter.",
    ],
    questions: [
      {
        durationSeconds: 75,
        id: "motivation",
        prompt:
          "Qu'est-ce qui vous a donné envie de rejoindre ce poste de Customer Success Manager ?",
        signal: "Role motivation and clarity of expectations",
        source: "agent",
      },
      {
        durationSeconds: 90,
        id: "role-skills",
        prompt:
          "Parlez-moi d'un projet d'onboarding client récent et de l'impact que vous avez eu.",
        signal: "Relevant experience connected to customer success work",
        source: "job_description",
      },
      {
        durationSeconds: 90,
        id: "communication",
        prompt:
          "Expliquez comment vous géreriez un client à risque après une implémentation difficile.",
        signal: "Communication, prioritization, and customer judgment",
        source: "agent",
      },
    ],
    rationale:
      "Three focused first-screening questions cover motivation, role evidence, and customer communication.",
  };
}

function candidateAnswerFor(questionId) {
  const answers = {
    communication:
      "I would first acknowledge the implementation issues, confirm the business impact with the customer, and set a short recovery plan with product and support. I would keep the customer updated with clear owners and dates.",
    motivation:
      "I am interested because the role combines customer onboarding, retention, and cross-functional problem solving. I like roles where I can improve the customer journey and make handoffs clearer.",
    "role-skills":
      "In my last role I led onboarding for enterprise customers and coordinated support, product, and customer success. We reduced activation delays by creating clearer kickoff checklists and weekly risk reviews.",
  };

  return answers[questionId] ?? answers["role-skills"];
}

function smokeRoleBrief() {
  return "Own customer onboarding, spot early retention risks, coordinate with support and product, and communicate clearly with customers during implementation.";
}

async function deleteSmokeData(runId) {
  const ids = idsFor(runId);
  const organization = await prisma.organization.findUnique({
    select: { id: true },
    where: { clerkOrganizationId: ids.clerkOrganizationId },
  });
  const user = await prisma.user.findUnique({
    select: { id: true },
    where: { clerkUserId: ids.clerkUserId },
  });

  if (!organization && !user) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (organization) {
      const runtimeIds = await tx.candidateSession.findMany({
        select: { realtimeSessionId: true },
        where: { organizationId: organization.id },
      });
      const sessionIds = runtimeIds
        .map((session) => session.realtimeSessionId)
        .filter(Boolean);

      await tx.candidateBrief.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.liveInterviewEvent.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
      await tx.liveInterviewSession.deleteMany({
        where: { id: { in: sessionIds } },
      });
      await tx.candidateSession.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.interview.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.interviewDraft.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.jobSourceConnection.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.job.deleteMany({ where: { organizationId: organization.id } });
      await tx.organizationMembership.deleteMany({
        where: { organizationId: organization.id },
      });
      await tx.organization.delete({ where: { id: organization.id } });
    }

    if (user) {
      await tx.organizationMembership.deleteMany({
        where: { userId: user.id },
      });
      await tx.user.delete({ where: { id: user.id } });
    }
  });
}

function idsFor(runId) {
  return {
    clerkOrganizationId: process.env.MOCK_CLERK_ORG_ID || "org_demo",
    clerkUserId: process.env.MOCK_CLERK_USER_ID || "user_demo",
    draftId: `idraft_e2e_${runId}`,
    interviewId: `interview_e2e_${runId}`,
    jobId: `job_e2e_${runId}`,
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--json") {
      parsed.json = true;
    } else if (value === "--strict") {
      parsed.strict = true;
    } else if (value === "--reset") {
      parsed.reset = true;
    } else if (value === "--live-llm") {
      parsed.liveLlm = true;
    } else if (value === "--run-id") {
      parsed.runId = values[index + 1];
      index += 1;
    } else if (value === "--console-url") {
      parsed.consoleUrl = values[index + 1];
      index += 1;
    } else if (value?.startsWith("--run-id=")) {
      parsed.runId = value.slice("--run-id=".length);
    } else if (value?.startsWith("--console-url=")) {
      parsed.consoleUrl = value.slice("--console-url=".length);
    }
  }
  return parsed;
}

function formatMarkdown(report) {
  return `# Prelude V1 E2E Smoke

- Generated: ${report.generatedAt}
- Decision: **${report.decision}**
- Run: \`${report.runId}\`
- Mode: \`${report.mode}\`

## Records

- Organization: \`${report.organization.id}\` (${report.organization.name})
- Job: \`${report.job.id}\` (${report.job.title})
- Interview: \`${report.interview.id}\`
- Candidate session: \`${report.candidateSession.id}\`
- Runtime session: \`${report.runtime.sessionId}\`
- Candidate brief: \`${report.brief.id}\` (${report.brief.status})

## Evidence

- Runtime status: \`${report.runtime.status}\`
- Event count: ${report.runtime.eventCount}
- Transcript-related turns: ${report.runtime.transcriptTurnCount}
- Review status: \`${report.candidateSession.reviewStatus}\`
- Brief provider: \`${report.brief.modelProvider}\`
- Brief evaluation matrix: ${report.brief.hasEvaluationMatrix ? "**present**" : "**missing**"}
- Matrix recommendation: \`${report.brief.matrixRecommendation ?? "n/a"}\`

## URLs

- Dashboard: ${report.urls.dashboard}
- Interview detail: ${report.urls.interviewDetail}
- Candidate detail: ${report.urls.candidateDetail}
- Candidate link: ${report.urls.candidate}
`;
}

function helpText() {
  return `Usage: node scripts/e2e-smoke.mjs [options]

Creates a repeatable local V1 E2E smoke dataset in the configured Postgres DB.

Options:
  --run-id <id>       Stable run id. Defaults to a timestamp.
  --reset            Delete existing smoke data for the run id first.
  --json             Print JSON instead of Markdown.
  --strict           Exit non-zero unless the smoke decision is Pass.
  --console-url <u>  Base console URL for printed links. Default: http://localhost:3000.
  --live-llm         Mark the run as explicit live LLM mode; requires ALLOW_LIVE_LLM_TESTS=1.
`;
}

function sanitizeRunId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function timestampRunId() {
  return `${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
