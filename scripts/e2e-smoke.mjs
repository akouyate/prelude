#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");

const prisma = new PrismaClient();

/**
 * Everything that reads argv, touches the database, or sets an exit code lives
 * in here, and `main()` runs ONLY when this file is executed as a CLI.
 *
 * That guard is load-bearing: apps/console imports this module to drift-check
 * its copy of the stopword heuristic against the original, and an import must
 * never seed a database. Module scope is therefore side-effect free apart from
 * constructing the (lazy, unconnected) Prisma client.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = sanitizeRunId(
    args.runId ?? process.env.E2E_SMOKE_RUN_ID ?? timestampRunId(),
  );
  const reset = Boolean(args.reset ?? process.env.E2E_SMOKE_RESET === "1");
  const allowLiveLlm = Boolean(
    args.liveLlm ?? process.env.E2E_SMOKE_LIVE_LLM === "1",
  );
  // Which language this run's workspace works in (plan 2026-08-18). It seeds the
  // org's two language settings AND the content, so a `fr` run is a coherent
  // French workspace end to end rather than French stamps over English prose.
  const language = normalizeSmokeLanguage(
    args.language ?? process.env.E2E_SMOKE_LANGUAGE ?? "en",
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

    const report = await runSmoke({
      allowLiveLlm,
      baseUrl,
      language,
      reset,
      runId,
    });
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
}

function isMainModule() {
  const entry = process.argv[1];

  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

async function runSmoke({ allowLiveLlm, baseUrl, language, reset, runId }) {
  if (reset) {
    await deleteSmokeData(runId);
  }

  const now = new Date();
  const ids = idsFor(runId);
  const recruiterEmail =
    process.env.MOCK_CLERK_USER_EMAIL || "recruiter@hirecall.ai";
  const content = smokeContent(language);
  const draft = interviewDraft(content);
  const publicToken = `iv_e2e_${runId}`;
  const candidateInvitationToken = `ci_e2e_${runId}`;
  const resumeToken = `resume_e2e_${runId}`;
  // Same source of truth the reset path deletes from.
  const { candidateSessionId, realtimeSessionId } = ids;

  await prisma.$transaction(async (tx) => {
    // SHARED ROW. `user_demo` is the local dev identity, not a run fixture, so
    // its name and email are seeded once and never overwritten — a smoke run
    // must not rename the person sitting in front of the console.
    const user = await tx.user.upsert({
      create: {
        clerkUserId: ids.clerkUserId,
        email: recruiterEmail,
        name: "HireCall E2E Recruiter",
      },
      update: {},
      where: { clerkUserId: ids.clerkUserId },
    });

    // SHARED ROW — see deleteSmokeData(). The workspace belongs to whoever uses
    // the local console, so its identity (name), its onboarding profile and its
    // onboarding progress are seeded on CREATE only. A run that renamed an
    // existing workspace to "HireCall E2E <runId>" is exactly the surprise this
    // avoids. The ONLY field refreshed on update is `settings`, because the
    // run's Pass decision asserts the workspace language matches the run's
    // language — and it is merged, so unrelated settings keys survive.
    const existingOrganization = await tx.organization.findUnique({
      select: { settings: true },
      where: { clerkOrganizationId: ids.clerkOrganizationId },
    });
    const organization = await tx.organization.upsert({
      create: {
        clerkOrganizationId: ids.clerkOrganizationId,
        companySize: "11-50",
        defaultInterviewMode: "audio",
        hiringFocus: "recruiting",
        name: `HireCall E2E ${runId}`,
        onboardingCompletedAt: now,
        onboardingState: {
          companyName: `HireCall E2E ${runId}`,
          companySize: "11-50",
          hiringFocus: "recruiting",
          interviewMode: "audio",
          jobSource: "manual",
          onboardingRole: "owner",
        },
        onboardingStep: "done",
        settings: organizationLanguageSettings(language),
      },
      update: {
        settings: organizationLanguageSettings(
          language,
          existingOrganization?.settings,
        ),
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
      // SHARED ROW. If the membership already exists, its role and status are
      // the dev's own — a smoke run must not silently promote or reactivate it.
      update: {},
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
      // SHARED ROW: keyed by (organization, provider), not by run. Its label is
      // seeded once and left alone afterwards.
      update: {},
      where: {
        organizationId_provider: {
          organizationId: organization.id,
          provider: "manual",
        },
      },
    });

    const job = await tx.job.upsert({
      create: {
        description: content.roleBrief,
        id: ids.jobId,
        location: "Paris, remote-friendly",
        organizationId: organization.id,
        sourceExternalId: `manual:e2e-smoke:${runId}`,
        sourceProvider: "manual",
        status: "published",
        title: content.roleTitle,
      },
      update: {
        description: content.roleBrief,
        location: "Paris, remote-friendly",
        organizationId: organization.id,
        status: "published",
        title: content.roleTitle,
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
        // The draft's own stamp: the language the candidate-facing questions,
        // criteria and guardrails above are actually written in.
        language,
        organizationId: organization.id,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: content.roleBrief,
        roleTitle: content.roleTitle,
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
        language,
        organizationId: organization.id,
        jobId: job.id,
        responseModes: ["audio", "text"],
        roleBrief: content.roleBrief,
        roleTitle: content.roleTitle,
        seniority: "mid",
        status: "published",
      },
      where: { id: ids.draftId },
    });

    const interview = await tx.interview.upsert({
      create: {
        criteria: draft.criteria,
        draftId: interviewDraftRecord.id,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["communication", "role_skills", "motivation"],
        guardrails: draft.guardrails,
        id: ids.interviewId,
        jobId: job.id,
        // Copied from the draft at publish time — the Go realtime store reads
        // this column to decide what the live agent speaks.
        language,
        organizationId: organization.id,
        publicToken,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: content.roleBrief,
        roleTitle: content.roleTitle,
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
        language,
        organizationId: organization.id,
        publicToken,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"],
        roleBrief: content.roleBrief,
        roleTitle: content.roleTitle,
        seniority: "mid",
        status: "published",
      },
      where: { id: ids.interviewId },
    });

    await tx.candidateInvitation.upsert({
      create: {
        candidateEmail: `candidate+${runId}@example.com`,
        candidateName: "Ada Martin",
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: addSeconds(now, 10),
        expiresAt: addDays(now, 30),
        id: ids.candidateInvitationId,
        interviewId: interview.id,
        jobId: job.id,
        openedAt: now,
        organizationId: organization.id,
        status: "completed",
        token: candidateInvitationToken,
      },
      update: {
        candidateEmail: `candidate+${runId}@example.com`,
        candidateName: "Ada Martin",
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: addSeconds(now, 10),
        expiresAt: addDays(now, 30),
        interviewId: interview.id,
        jobId: job.id,
        openedAt: now,
        organizationId: organization.id,
        status: "completed",
        token: candidateInvitationToken,
      },
      where: { id: ids.candidateInvitationId },
    });

    await tx.candidateSession.upsert({
      create: {
        candidateInvitationId: ids.candidateInvitationId,
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
        candidateInvitationId: ids.candidateInvitationId,
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
        content,
        questions: draft.questions,
        realtimeSessionId,
        startedAt: addSeconds(now, 10),
      }),
    });

    const brief = buildBrief({
      candidateSessionId,
      content,
      criteria: draft.criteria,
      runId,
    });
    await tx.candidateBrief.upsert({
      create: {
        candidateSessionId,
        evidence: brief.evidenceRefs,
        generatedAt: addSeconds(now, 190),
        // Recruiter-bound shared analysis follows the WORKSPACE language, which
        // this run seeds to the same value as the interview language.
        language,
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
        language,
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

  const [
    candidateSession,
    interviewDraftRow,
    runtimeSession,
    brief,
    eventCount,
    transcriptTurns,
  ] = await Promise.all([
    prisma.candidateSession.findUniqueOrThrow({
      include: {
        candidateInvitation: true,
        interview: true,
        job: true,
        organization: true,
      },
      where: { id: candidateSessionId },
    }),
    prisma.interviewDraft.findUniqueOrThrow({
      where: { id: ids.draftId },
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
  const candidateUrl = `${baseUrl}/interview/${
    candidateSession.candidateInvitation?.token ??
    candidateSession.interview.publicToken
  }`;
  const summaryJson = isRecord(brief.summaryJson) ? brief.summaryJson : {};
  const evaluationMatrix = isRecord(summaryJson.evaluationMatrix)
    ? summaryJson.evaluationMatrix
    : null;
  const matrixRecommendation =
    evaluationMatrix && typeof evaluationMatrix.recommendationLabel === "string"
      ? evaluationMatrix.recommendationLabel
      : null;
  // The language chain (plan 2026-08-18). Two independent facts are checked:
  // every artifact carries the run's language STAMP, and the prose those
  // artifacts contain actually READS as that language. A stamp over prose in the
  // other language is precisely the incoherence this variant exists to catch.
  const settings = isRecord(candidateSession.organization.settings)
    ? candidateSession.organization.settings
    : {};
  const interviewSettings = isRecord(settings.interview)
    ? settings.interview
    : {};
  const languageChecks = {
    workspaceSetting: settings.workspaceLanguage === language,
    interviewDefaultSetting: interviewSettings.defaultLanguage === language,
    draftStamp: interviewDraftRow.language === language,
    interviewStamp: candidateSession.interview.language === language,
    briefStamp: brief.language === language,
    // Candidate-bound prose: the published questions the agent will speak.
    questionProse:
      dominantStopwordLanguage(
        readQuestionPrompts(candidateSession.interview.questions),
      ) === language,
    // Recruiter-bound prose: the shared brief the whole team reads.
    briefProse:
      dominantStopwordLanguage(
        [
          typeof summaryJson.summary === "string" ? summaryJson.summary : "",
          ...toStringArray(summaryJson.strengths),
          ...toStringArray(summaryJson.pointsToClarify),
        ].join(" "),
      ) === language,
  };
  const languageCoherent = Object.values(languageChecks).every(Boolean);

  const decision =
    candidateSession.status === "completed" &&
    runtimeSession.status === "completed" &&
    brief.status === "completed" &&
    evaluationMatrix !== null &&
    eventCount > 0 &&
    languageCoherent
      ? "Pass"
      : "Blocker";

  return {
    generatedAt: new Date().toISOString(),
    runId,
    mode: allowLiveLlm ? "live-llm-explicit" : "mock-llm-default",
    decision,
    language: {
      requested: language,
      checks: languageChecks,
      coherent: languageCoherent,
      draft: interviewDraftRow.language,
      interview: candidateSession.interview.language,
      brief: brief.language,
    },
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
      candidateInvitationToken:
        candidateSession.candidateInvitation?.token ?? null,
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
  content,
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
          text: candidateAnswerFor(question.id, content),
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
      closing: content.closingLine,
      completedQuestions: questions.length,
      totalQuestions: questions.length,
      transcriptTurn: {
        endedAt: addSeconds(startedAt, 176).toISOString(),
        questionId: questions.at(-1)?.id,
        sessionId: realtimeSessionId,
        speaker: "interviewer",
        startedAt: addSeconds(startedAt, 170).toISOString(),
        text: content.closingLine,
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

function buildBrief({ candidateSessionId, content, criteria, runId }) {
  const assessments = criteria.map((criterion) =>
    smokeCriterionAssessment(criterion, content),
  );
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
      facts: content.brief.facts,
      inferredSignals: content.brief.inferredSignals.map((label, index) => ({
        confidence: "medium",
        evidence: [
          smokeEvidence(index === 0 ? "role-skills" : "communication", content),
        ],
        label,
      })),
      missingInfo: content.brief.missingInfo,
      recommendationConfidence: "medium",
      recommendationLabel: "targeted_follow_up",
      recommendationRationale: content.brief.recommendationRationale,
      recommendedNextStep: "to_review",
      risks: content.brief.matrixRisks,
    },
    limitations: [
      ...content.brief.limitations,
      content.brief.smokeLimitation(runId),
    ],
    pointsToClarify: content.brief.pointsToClarify,
    risks: content.brief.risks,
    status: "completed",
    strengths: content.brief.strengths,
    suggestedNextStep: "to_review",
    summary: content.brief.summary,
  };

  return { evidenceRefs, summary };
}

function smokeCriterionAssessment(criterion, content) {
  const questionId = smokeQuestionForCriterion(criterion.id);
  const evidence = smokeEvidence(questionId, content);
  const assessment = content.assessments[criterion.id];

  return {
    ...assessment,
    criterion,
    evidence,
    questionId,
    transcriptTurnId: evidence.transcriptTurnId,
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

function smokeEvidence(questionId, content) {
  return {
    questionId,
    text: candidateAnswerFor(questionId, content),
    transcriptTurnId: `turn_${questionId}_candidate`,
  };
}

function interviewDraft(content) {
  return {
    criteria: content.criteria,
    estimatedMinutes: 4,
    guardrails: content.guardrails,
    questions: content.questions,
    rationale: content.rationale,
  };
}

function candidateAnswerFor(questionId, content) {
  return content.answers[questionId] ?? content.answers["role-skills"];
}

/**
 * The seeded prose for one workspace language.
 *
 * Everything a recruiter or candidate READS is in here, so a run is coherent in
 * exactly one language: the candidate-facing chain (role brief, questions,
 * criteria, guardrails) and the recruiter-bound chain (the brief) are seeded
 * from the same entry. That is what makes the language stamps assertable — a
 * stamp over prose in the other language would be the bug this smoke exists to
 * catch, not a passing run.
 *
 * Candidate answers are deliberately in the interview language too: they stand
 * in for what a candidate actually said, and the brief quotes them verbatim.
 */
function smokeContent(language) {
  return language === "fr" ? frenchSmokeContent() : englishSmokeContent();
}

/**
 * The two language keys the run asserts, merged over whatever the workspace
 * already had. Replacing the settings blob wholesale would drop unrelated keys
 * a developer set by hand — the shared org is not the run's to overwrite.
 */
function organizationLanguageSettings(language, existingSettings) {
  const base = isRecord(existingSettings) ? existingSettings : {};
  const interview = isRecord(base.interview) ? base.interview : {};
  return {
    ...base,
    interview: { ...interview, defaultLanguage: language },
    workspaceLanguage: language,
  };
}

function normalizeSmokeLanguage(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized !== "en" && normalized !== "fr") {
    fail(
      `Unsupported smoke language "${value}". The catalogue pair is en | fr.`,
    );
  }

  return normalized;
}

function englishSmokeContent() {
  return {
    answers: {
      communication:
        "I would first acknowledge the implementation issues, confirm the business impact with the customer, and set a short recovery plan with product and support. I would keep the customer updated with clear owners and dates.",
      motivation:
        "I am interested because the role combines customer onboarding, retention, and cross-functional problem solving. I like roles where I can improve the customer journey and make handoffs clearer.",
      "role-skills":
        "In my last role I led onboarding for enterprise customers and coordinated support, product, and customer success. We reduced activation delays by creating clearer kickoff checklists and weekly risk reviews.",
    },
    assessments: {
      communication: {
        category: "communication",
        followUps: [
          "How would you explain the recovery timeline if the customer is already frustrated?",
        ],
        matrixRationale:
          "The answer is clear and recruiter-readable, but it does not yet show how the candidate adapts communication to senior stakeholders.",
        missingInfo: ["Stakeholder communication depth."],
        rationale:
          "Candidate communicated in a structured way, with enough clarity for first-screening review.",
      },
      "practical-judgment": {
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
      },
      "relevant-evidence": {
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
      },
    },
    brief: {
      facts: [
        "Candidate described involvement in enterprise customer onboarding.",
        "Candidate described cross-functional work with support, product, and customer success.",
        "Candidate proposed customer recovery steps with owners, dates, and communication cadence.",
      ],
      inferredSignals: [
        "Enterprise onboarding coordination",
        "Structured at-risk customer response",
      ],
      limitations: [
        "This brief supports human review only and is not an automated hiring decision.",
        "Do not assess protected attributes, appearance, accent, tone, emotion, personality, or biometrics.",
      ],
      missingInfo: [
        "Exact activation, churn, or adoption metric movement.",
        "Candidate's direct ownership versus team contribution.",
        "Commercial impact and stakeholder seniority.",
      ],
      pointsToClarify: [
        "What activation, churn, or adoption metric changed after the onboarding work?",
        "What was Ada directly responsible for versus owned by the broader team?",
        "How senior were the customer stakeholders involved in the recovery plan?",
      ],
      recommendationRationale:
        "The transcript contains useful first-screen signal for a CSM role, but the recruiter should validate measurable customer impact and ownership before advancing.",
      risks: [
        "The smoke candidate data is synthetic and should only validate workflow plumbing.",
        "Metrics and ownership need recruiter validation before moving forward.",
      ],
      matrixRisks: [
        "The smoke candidate data is synthetic and should only validate workflow plumbing.",
        "Metrics and exact ownership remain unverified.",
      ],
      strengths: [
        "Relevant evidence: candidate described onboarding projects and cross-functional coordination.",
        "Practical judgment: candidate proposed a short recovery plan with owners and dates.",
        "Communication: answers were concise enough for first-screening review.",
      ],
      summary:
        "Ada Martin completed the Customer Success Manager smoke interview with persisted transcript evidence, answer evaluations, and a matrix-backed recruiter brief for human review.",
      smokeLimitation: (runId) => `Generated by local E2E smoke run ${runId}.`,
    },
    closingLine:
      "Thank you, Ada. The recruiter will review your answers and follow up with the next step.",
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
          "What made you want to join this Customer Success Manager position?",
        signal: "Role motivation and clarity of expectations",
        source: "agent",
      },
      {
        durationSeconds: 90,
        id: "role-skills",
        prompt:
          "Tell me about a recent customer onboarding project and the impact you had.",
        signal: "Relevant experience connected to customer success work",
        source: "job_description",
      },
      {
        durationSeconds: 90,
        id: "communication",
        prompt:
          "Explain how you would handle an at-risk customer after a difficult implementation.",
        signal: "Communication, prioritization, and customer judgment",
        source: "agent",
      },
    ],
    rationale:
      "Three focused first-screening questions cover motivation, role evidence, and customer communication.",
    roleBrief:
      "Own customer onboarding, spot early retention risks, coordinate with support and product, and communicate clearly with customers during implementation.",
    roleTitle: "Customer Success Manager",
  };
}

function frenchSmokeContent() {
  return {
    answers: {
      communication:
        "Je commencerais par reconnaitre les difficultes de la mise en place, puis je confirmerais l'impact business avec le client et je poserais un plan de redressement court avec le produit et le support. Je tiendrais le client informe avec des responsables et des dates claires.",
      motivation:
        "Ce poste m'interesse parce qu'il combine l'onboarding client, la retention et la resolution de problemes avec plusieurs equipes. J'aime les roles ou je peux ameliorer le parcours client et rendre les passages de relais plus nets.",
      "role-skills":
        "Dans mon dernier poste, j'ai pilote l'onboarding des clients grands comptes et coordonne le support, le produit et le customer success. Nous avons reduit les delais d'activation grace a des checklists de lancement plus claires et des revues de risque hebdomadaires.",
    },
    assessments: {
      communication: {
        category: "communication",
        followUps: [
          "Comment expliqueriez-vous le calendrier de redressement a un client deja mecontent ?",
        ],
        matrixRationale:
          "La reponse est claire et lisible pour le recruteur, mais elle ne montre pas encore comment la candidate adapte sa communication a des interlocuteurs seniors.",
        missingInfo: [
          "Profondeur de la communication avec les parties prenantes.",
        ],
        rationale:
          "La candidate a communique de maniere structuree, avec assez de clarte pour une preselection.",
      },
      "practical-judgment": {
        category: "role_specific",
        followUps: [
          "Que feriez-vous en premier si le produit ne peut pas s'engager sur le correctif demande par le client ?",
          "Comment decideriez-vous d'escalader sur le plan commercial ?",
        ],
        matrixRationale:
          "La reponse montre une approche structuree du redressement client, mais les arbitrages et les seuils d'escalade ne sont pas encore explicites.",
        missingInfo: [
          "Seuil d'escalade.",
          "Evaluation du risque commercial ou de renouvellement.",
        ],
        rationale:
          "La candidate a decrit un plan de redressement concret, mais le recruteur doit creuser les arbitrages et le jugement sur l'escalade.",
      },
      "relevant-evidence": {
        category: "experience",
        followUps: [
          "Quel indicateur d'activation ou de churn a bouge apres ces changements d'onboarding ?",
          "Combien de clients grands comptes etaient concernes ?",
        ],
        matrixRationale:
          "La reponse est pertinente pour l'onboarding grands comptes et le travail transverse d'un CSM, mais l'impact mesurable n'est pas chiffre.",
        missingInfo: [
          "Evolution de l'indicateur d'activation ou de churn.",
          "Taille du portefeuille client concerne.",
        ],
        rationale:
          "La candidate a donne des elements d'onboarding lies au poste, mais l'impact client exact reste a valider.",
      },
    },
    brief: {
      facts: [
        "La candidate a decrit sa participation a l'onboarding de clients grands comptes.",
        "La candidate a decrit un travail transverse avec le support, le produit et le customer success.",
        "La candidate a propose des etapes de redressement client avec des responsables, des dates et un rythme de communication.",
      ],
      inferredSignals: [
        "Coordination d'onboarding grands comptes",
        "Reponse structuree face a un client a risque",
      ],
      limitations: [
        "Ce brief sert uniquement a la revue humaine et ne constitue pas une decision de recrutement automatisee.",
        "Ne pas evaluer les attributs proteges, l'apparence, l'accent, le ton, l'emotion, la personnalite ou la biometrie.",
      ],
      missingInfo: [
        "Evolution precise de l'indicateur d'activation, de churn ou d'adoption.",
        "Perimetre porte directement par la candidate par rapport a l'equipe.",
        "Impact commercial et seniorite des interlocuteurs.",
      ],
      pointsToClarify: [
        "Quel indicateur d'activation, de churn ou d'adoption a change apres ce travail d'onboarding ?",
        "De quoi Ada etait-elle directement responsable par rapport au reste de l'equipe ?",
        "Quelle etait la seniorite des interlocuteurs impliques dans le plan de redressement ?",
      ],
      recommendationRationale:
        "Le verbatim contient des signaux utiles pour une preselection sur un poste de CSM, mais le recruteur doit valider l'impact client mesurable et le perimetre porte avant d'avancer.",
      risks: [
        "Les donnees candidat de ce smoke sont synthetiques et ne servent qu'a valider la tuyauterie du parcours.",
        "Les indicateurs et le perimetre doivent etre valides par le recruteur avant d'aller plus loin.",
      ],
      matrixRisks: [
        "Les donnees candidat de ce smoke sont synthetiques et ne servent qu'a valider la tuyauterie du parcours.",
        "Les indicateurs et le perimetre exact restent non verifies.",
      ],
      strengths: [
        "Elements pertinents : la candidate a decrit des projets d'onboarding et une coordination transverse.",
        "Jugement pratique : la candidate a propose un plan de redressement court avec des responsables et des dates.",
        "Communication : les reponses sont assez concises pour une revue de preselection.",
      ],
      summary:
        "Ada Martin a termine l'entretien de smoke pour le poste de Customer Success Manager avec un verbatim persiste, des evaluations de reponses et un brief recruteur adosse a la matrice, destine a une revue humaine.",
      smokeLimitation: (runId) => `Genere par le smoke E2E local ${runId}.`,
    },
    closingLine:
      "Merci Ada. Le recruteur va relire vos reponses et revenir vers vous pour la suite.",
    criteria: [
      {
        description:
          "Les exemples sont lies a l'onboarding client et au travail de retention.",
        id: "relevant-evidence",
        label: "Elements pertinents",
      },
      {
        description:
          "La candidate explique clairement les arbitrages et les premieres actions.",
        id: "practical-judgment",
        label: "Jugement pratique",
      },
      {
        description:
          "Les reponses sont structurees, precises et faciles a relire.",
        id: "communication",
        label: "Communication",
      },
    ],
    guardrails: [
      "Poser a chaque candidat les memes questions dans le meme ordre.",
      "Evaluer les reponses uniquement sur des criteres lies au poste.",
      "Ne pas analyser le visage, l'accent, le ton, l'emotion ou les attributs proteges.",
      "Laisser la decision finale au recruteur.",
    ],
    questions: [
      {
        durationSeconds: 75,
        id: "motivation",
        prompt:
          "Qu'est-ce qui vous a donne envie de rejoindre ce poste de Customer Success Manager ?",
        signal: "Motivation pour le poste et clarte des attentes",
        source: "agent",
      },
      {
        durationSeconds: 90,
        id: "role-skills",
        prompt:
          "Parlez-moi d'un projet d'onboarding client recent et de l'impact que vous avez eu.",
        signal: "Experience pertinente liee au customer success",
        source: "job_description",
      },
      {
        durationSeconds: 90,
        id: "communication",
        prompt:
          "Expliquez comment vous gereriez un client a risque apres une implementation difficile.",
        signal: "Communication, priorisation et jugement client",
        source: "agent",
      },
    ],
    rationale:
      "Trois questions de preselection ciblees couvrent la motivation, les elements lies au poste et la communication client.",
    roleBrief:
      "Piloter l'onboarding des clients, reperer tot les risques de retention, coordonner le support et le produit, et communiquer clairement avec les clients pendant la mise en place.",
    roleTitle: "Customer Success Manager",
  };
}

/**
 * Undo exactly one run's fixtures — and nothing else.
 *
 * The organization (`org_demo` by default) and the recruiter user (`user_demo`)
 * are SHARED with local development, by design: the smoke seeds into them so
 * its data appears under the mock identity the console signs you in as. Every
 * run upserts them; no run owns them. Deleting the org would take the entire
 * local workspace with it, because Prisma cascades an Organization delete into
 * CandidateBrief, CandidateSessionReviewEvent, CandidateExperiencePreview,
 * CandidateScheduledCall, ConnectedAccount, RoleIntake, NotificationDelivery,
 * OrganizationInvitation and OrganizationBillingState — hand-made dev data no
 * smoke run created. The billing tables (CreditWallet/-Lot/-LedgerEntry/
 * -Reservation) are `onDelete: Restrict`, which is the only reason that
 * deletion has been failing loudly instead of silently destroying the rest.
 *
 * So --reset removes run-scoped rows by their `*_e2e_<runId>` ids and leaves
 * the workspace, its members and its billing state untouched. This is also what
 * the Makefile documents: "resets only that run's data".
 *
 * Deletion order is FK-safe on purpose: children first, the job last.
 */
async function deleteSmokeData(runId) {
  const ids = idsFor(runId);

  try {
    await prisma.$transaction(async (tx) => {
      // Runtime evidence. Events and recordings cascade from the session, but
      // the session itself is tied to the candidate session by a plain id
      // column (no FK), so nothing deletes it for us.
      await tx.liveInterviewEvent.deleteMany({
        where: { sessionId: ids.realtimeSessionId },
      });
      await tx.liveInterviewSession.deleteMany({
        where: { id: ids.realtimeSessionId },
      });

      // Everything hanging off this run's candidate session.
      await tx.candidateBrief.deleteMany({
        where: { candidateSessionId: ids.candidateSessionId },
      });
      await tx.candidateSessionReviewEvent.deleteMany({
        where: { candidateSessionId: ids.candidateSessionId },
      });
      await tx.candidateScheduledCall.deleteMany({
        where: { candidateSessionId: ids.candidateSessionId },
      });
      await tx.notificationDelivery.deleteMany({
        where: { candidateSessionId: ids.candidateSessionId },
      });
      await tx.candidateSession.deleteMany({
        where: { id: ids.candidateSessionId },
      });
      await tx.candidateInvitation.deleteMany({
        where: { id: ids.candidateInvitationId },
      });

      // The published snapshot, then the draft it was published from.
      await tx.candidateExperiencePreview.deleteMany({
        where: { draftId: ids.draftId },
      });
      await tx.interview.deleteMany({ where: { id: ids.interviewId } });
      await tx.interviewDraft.deleteMany({ where: { id: ids.draftId } });

      // The job is the last parent standing.
      await tx.job.deleteMany({ where: { id: ids.jobId } });
    });
  } catch (error) {
    if (!isForeignKeyViolation(error)) {
      throw error;
    }
    // A model was added that points at one of the rows above, and the list was
    // never extended. Name the table that is actually holding the row, so the
    // next schema addition fails with something you can act on rather than a
    // bare constraint name.
    const blocking = await describeBlockingReferences(ids);
    if (blocking.length === 0) {
      throw error;
    }
    throw new Error(
      `e2e-smoke --reset could not remove run "${runId}": rows still reference it in ` +
        `${blocking.join(", ")}. Add those table(s) to deleteSmokeData() in scripts/e2e-smoke.mjs.`,
      { cause: error },
    );
  }
}

/**
 * The run-scoped rows --reset owns, keyed by their PHYSICAL table name (three
 * live-interview models are @@map-ed, so the Prisma model name is not the table
 * name the Postgres catalog knows).
 */
function resetTargets(ids) {
  return [
    { ids: [ids.candidateInvitationId], table: "CandidateInvitation" },
    { ids: [ids.candidateSessionId], table: "CandidateSession" },
    { ids: [ids.interviewId], table: "Interview" },
    { ids: [ids.draftId], table: "InterviewDraft" },
    { ids: [ids.jobId], table: "Job" },
    { ids: [ids.realtimeSessionId], table: "live_interview_sessions" },
  ];
}

function isForeignKeyViolation(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  // P2003 is Prisma's foreign-key error; 23503 is the Postgres SQLSTATE that
  // reaches us when a raw query is what tripped.
  return error.code === "P2003" || error.code === "23503";
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Ask the database — not a hand-maintained list — which tables still hold rows
 * that BLOCK deleting this run's rows. Reads pg_constraint, so a model added
 * tomorrow is discovered without touching this function.
 */
async function describeBlockingReferences(ids) {
  const targets = resetTargets(ids);
  const parentList = targets
    .map((target) => quoteSqlLiteral(target.table))
    .join(", ");
  const references = await prisma.$queryRawUnsafe(`
    SELECT child.relname::text AS child_table,
           attribute.attname::text AS child_column,
           parent.relname::text AS parent_table
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN LATERAL unnest(constraint_row.conkey) AS key(attnum) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = child.oid AND attribute.attnum = key.attnum
    WHERE constraint_row.contype = 'f'
      AND parent.relname IN (${parentList})
      -- Only constraints that can actually BLOCK a delete. 'c' (cascade), 'n'
      -- (set null) and 'd' (set default) resolve themselves, so listing them
      -- would bury the one table that is really in the way.
      AND constraint_row.confdeltype IN ('a', 'r')
  `);

  const idsByTable = new Map(
    targets.map((target) => [target.table, target.ids]),
  );
  const blocking = [];
  for (const reference of references) {
    const parentIds = idsByTable.get(reference.parent_table);
    if (!parentIds || parentIds.length === 0) {
      continue;
    }
    const valueList = parentIds.map(quoteSqlLiteral).join(", ");
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM "${reference.child_table}" ` +
        `WHERE "${reference.child_column}" IN (${valueList})`,
    );
    const count = Number(row?.count ?? 0);
    if (count > 0) {
      blocking.push(
        `${reference.child_table}.${reference.child_column} (${count} row${
          count === 1 ? "" : "s"
        } referencing ${reference.parent_table})`,
      );
    }
  }

  return [...new Set(blocking)].sort();
}

function idsFor(runId) {
  return {
    // The workspace identity is SHARED with local development on purpose: the
    // smoke seeds into the org the mock recruiter signs in as, so the seeded
    // data is visible in the console. It is therefore never run-owned, and
    // never deleted by --reset. See deleteSmokeData().
    clerkOrganizationId: process.env.MOCK_CLERK_ORG_ID || "org_demo",
    clerkUserId: process.env.MOCK_CLERK_USER_ID || "user_demo",
    // Everything below is scoped to THIS run, and is exactly what --reset
    // removes. Keep this list and deleteSmokeData() in sync.
    candidateInvitationId: `cinv_e2e_${runId}`,
    candidateSessionId: `cs_e2e_${runId}`,
    draftId: `idraft_e2e_${runId}`,
    interviewId: `interview_e2e_${runId}`,
    jobId: `job_e2e_${runId}`,
    realtimeSessionId: `is_e2e_${runId}`,
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
    } else if (value === "--language") {
      parsed.language = values[index + 1];
      index += 1;
    } else if (value?.startsWith("--language=")) {
      parsed.language = value.slice("--language=".length);
    } else if (value?.startsWith("--run-id=")) {
      parsed.runId = value.slice("--run-id=".length);
    } else if (value?.startsWith("--console-url=")) {
      parsed.consoleUrl = value.slice("--console-url=".length);
    }
  }
  return parsed;
}

function formatMarkdown(report) {
  return `# HireCall V1 E2E Smoke

- Generated: ${report.generatedAt}
- Decision: **${report.decision}**
- Run: \`${report.runId}\`
- Mode: \`${report.mode}\`
- Language: \`${report.language.requested}\` (${report.language.coherent ? "**coherent**" : "**INCOHERENT**"})

## Records

- Organization: \`${report.organization.id}\` (${report.organization.name})
- Job: \`${report.job.id}\` (${report.job.title})
- Interview: \`${report.interview.id}\`
- Candidate invitation: \`${report.interview.candidateInvitationToken ?? "n/a"}\`
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

## Language

- Stamps: draft \`${report.language.draft ?? "null"}\` · interview \`${report.language.interview ?? "null"}\` · brief \`${report.language.brief ?? "null"}\`
${Object.entries(report.language.checks)
  .map(([check, ok]) => `- ${check}: ${ok ? "pass" : "**FAIL**"}`)
  .join("\n")}

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
  --language <l>     Workspace language for the run: en | fr. Default: en.
                     Seeds the org language settings, the artifact stamps, and
                     the seeded prose, so the whole run is one language.
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

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function readQuestionPrompts(value) {
  return Array.isArray(value)
    ? value
        .map((question) =>
          isRecord(question) && typeof question.prompt === "string"
            ? question.prompt
            : "",
        )
        .join(" ")
    : "";
}

function toStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

/**
 * Which catalogue language a piece of prose reads as, by counting function
 * words. Mirrors `dominantStopwordLanguage` in
 * apps/console/src/server/interviews/text-language-heuristic.ts — kept as a copy
 * because this seeding script runs as plain Node with no TypeScript build, and
 * duplicating ~40 stopwords is cheaper than compiling the console to seed a DB.
 * Returns null on a thin or mixed signal, so an assertion fails rather than
 * coin-flips.
 */
export function dominantStopwordLanguage(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

  let english = 0;
  let french = 0;
  for (const token of tokens) {
    if (SMOKE_ENGLISH_STOPWORDS.has(token)) {
      english += 1;
    }
    if (SMOKE_FRENCH_STOPWORDS.has(token)) {
      french += 1;
    }
  }

  if (
    english >= SMOKE_MINIMUM_HITS &&
    english >= french * SMOKE_DOMINANCE_RATIO
  ) {
    return "en";
  }
  if (
    french >= SMOKE_MINIMUM_HITS &&
    french >= english * SMOKE_DOMINANCE_RATIO
  ) {
    return "fr";
  }

  return null;
}

// Exported so `text-language-heuristic.drift.test.ts` in apps/console can assert
// this copy still matches the original, value for value.
export const SMOKE_MINIMUM_HITS = 3;
export const SMOKE_DOMINANCE_RATIO = 2;

// Deliberately disjoint: words shared by both languages are excluded rather
// than counted for the wrong side.
export const SMOKE_ENGLISH_STOPWORDS = new Set([
  "and",
  "are",
  "been",
  "before",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "its",
  "not",
  "of",
  "should",
  "than",
  "that",
  "the",
  "their",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "when",
  "which",
  "while",
  "with",
]);

export const SMOKE_FRENCH_STOPWORDS = new Set([
  "au",
  "aucun",
  "aux",
  "avant",
  "avec",
  "ces",
  "cet",
  "cette",
  "dans",
  "des",
  "doit",
  "du",
  "elle",
  "est",
  "etre",
  "la",
  "le",
  "les",
  "leur",
  "leurs",
  "mais",
  "notre",
  "nous",
  "pas",
  "peut",
  "pour",
  "qui",
  "sans",
  "ses",
  "sont",
  "sur",
  "tres",
  "une",
  "votre",
  "vous",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Last line on purpose: every const above is initialized by the time main()
// runs, and an `import` of this module stops right here without doing anything.
if (isMainModule()) {
  await main();
}
