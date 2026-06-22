"use server";

import { randomBytes } from "node:crypto";

import { prisma, type Prisma } from "@prelude/db";
import {
  type InterviewAgentDraft,
  type InterviewCriterionDraft,
  type InterviewFocus,
  type InterviewQuestionDraft,
  type InterviewSeniority,
} from "@prelude/core";
import {
  INTERVIEW_PLAN_SCHEMA_VERSION,
  complianceOverrideRecordSchema,
  complianceOverrideRequestSchema,
  interviewPlanSchema,
  parseStoredInterviewPlan,
  toLiveInterviewPlan,
  type ComplianceOverrideRecord,
  type ComplianceOverrideRequest,
} from "@prelude/contracts";
import { revalidatePath } from "next/cache";

import {
  getInterviewPlanPublicationIssues,
  interviewPlanPolicy,
  planReferencesDisallowedTopic,
  resolveInterviewDraftPublicationMode,
} from "../../domain/interview-plan-policy";
import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../users/user-locale";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  logInterviewGenerationEvent,
  type InterviewGenerationTelemetrySink,
  type ProtectedTopicClassificationOutcome,
} from "./interview-generation-telemetry";
import {
  createProtectedTopicClassifierFromEnv,
  isOverridableProtectedTopicCategory,
  protectedTopicClassifierPromptVersion,
  protectedTopicClassifierSchemaVersion,
  type ProtectedTopicClassification,
  type ProtectedTopicClassifier,
} from "./protected-topic-classifier";

export type InterviewResponseMode = "audio" | "text";

export type SaveInterviewDraftInput = {
  draftId?: string;
  jobId?: string;
  roleTitle: string;
  roleBrief: string;
  // N14: where the job is. A ROLE attribute surfaced/searched in RolesList, not
  // a candidate-screening field. Optional/nullable so manual briefs without a
  // location keep saving.
  location?: string | null;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  responseModes: InterviewResponseMode[];
  questions: InterviewQuestionDraft[];
  criteria: InterviewCriterionDraft[];
  guardrails: string[];
  estimatedMinutes: number;
  rationale: string;
  sourceAttachmentName?: string;
  // N9: provenance of the engine that produced this draft. Optional so manual
  // edits (no generation) and legacy callers keep working; schemaVersion is
  // always stamped on write regardless.
  generatorProvider?: string;
  generatorModel?: string;
};

export type SaveInterviewDraftResult =
  | {
      ok: true;
      draftId: string;
      jobId: string;
      updatedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

// N6b: when the second-layer LLM classifier flags an OVERRIDABLE category, the
// publish fails but carries a review affordance so the recruiter can consciously
// override it. Absent on a hard keyword block or a non-overridable category.
export type ComplianceReviewPrompt = {
  category: string;
  categoryLabel: string;
  reason: string;
  // N6b role-gate: true when the current recruiter lacks the owner/admin role
  // needed to override — the UI shows an escalation message, not the panel.
  requiresElevatedRole: boolean;
};

export type PublishInterviewDraftResult =
  | {
      ok: true;
      candidatePath: string;
      detailPath: string;
      interviewId: string;
      publicToken: string;
    }
  | {
      ok: false;
      error: string;
      review?: ComplianceReviewPrompt;
    };

const allowedSeniorities = new Set<InterviewSeniority>([
  "junior",
  "mid",
  "senior",
]);
const allowedFocus = new Set<InterviewFocus>([
  "communication",
  "motivation",
  "role_skills",
  "situational_judgment",
]);
const allowedModes = new Set<InterviewResponseMode>(["audio", "text"]);

// N6b role-gate: only an owner or admin may consciously override an LLM
// protected-topic flag. A basic recruiter/viewer must escalate to one of them.
const overrideAllowedRoles = new Set<string>(["owner", "admin"]);

// N6b rate-limit: a soft cap on APPLIED overrides per recruiter within a rolling
// window. Beyond it, overrides are denied and must be escalated to an admin —
// this bounds the "iteratively dodge the LLM via override" attack and is the
// earliest internal signal of a disparate-impact pattern.
const OVERRIDE_RATE_LIMIT_MAX = 10;
const OVERRIDE_RATE_LIMIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function saveInterviewDraft(
  input: SaveInterviewDraftInput,
): Promise<SaveInterviewDraftResult> {
  // Localized recruiter-facing reject copy follows the user's UI language.
  const t = getServerT(await getAuthenticatedUserLocale());
  const normalized = normalizeDraftInput(input, {
    disallowedTopicMessage: t("compliance.planDisallowedTopicBlock"),
  });

  if (!normalized.ok) {
    return normalized;
  }

  const scope = await getCompletedOrganizationScope();

  const result = await prisma.$transaction(async (tx) => {
    const job = input.jobId
      ? await tx.job.findFirst({
          where: {
            id: input.jobId,
            organizationId: scope.organizationId,
          },
        })
      : null;

    const persistedJob = job
      ? await tx.job.update({
          data: {
            description: normalized.data.roleBrief,
            location: normalized.data.location,
            title: normalized.data.roleTitle,
          },
          where: { id: job.id },
        })
      : await tx.job.create({
          data: {
            description: normalized.data.roleBrief,
            location: normalized.data.location,
            organizationId: scope.organizationId,
            sourceExternalId: `manual:${slugify(normalized.data.roleTitle)}`,
            sourceProvider: "manual",
            status: "draft",
            title: normalized.data.roleTitle,
          },
        });

    const draftData = toDraftPersistenceData({
      ...normalized.data,
      jobId: persistedJob.id,
      organizationId: scope.organizationId,
    });

    const existingDraft = input.draftId
      ? await tx.interviewDraft.findFirst({
          select: { id: true },
          where: {
            id: input.draftId,
            organizationId: scope.organizationId,
          },
        })
      : null;

    const draft = existingDraft
      ? await tx.interviewDraft.update({
          data: draftData,
          where: { id: existingDraft.id },
        })
      : await tx.interviewDraft.create({
          data: draftData,
        });

    return {
      draftId: draft.id,
      jobId: persistedJob.id,
      updatedAt: draft.updatedAt.toISOString(),
    };
  });

  revalidatePath("/");
  revalidatePath("/roles/new");
  revalidatePath("/interviews/new");

  return {
    ok: true,
    ...result,
  };
}

export async function publishInterviewDraft(
  draftId: string,
  classifier: ProtectedTopicClassifier = createProtectedTopicClassifierFromEnv(),
  telemetry?: InterviewGenerationTelemetrySink,
  // N6b: a recruiter-supplied conscious override of an OVERRIDABLE LLM flag. The
  // server re-reads + re-classifies the current draft, so this can never apply
  // to a stale verdict, the keyword gate, or a non-overridable category.
  override?: ComplianceOverrideRequest,
): Promise<PublishInterviewDraftResult> {
  const normalizedDraftId = draftId.trim();

  if (!normalizedDraftId) {
    return { ok: false, error: "Save the draft before publishing." };
  }

  const scope = await getCompletedOrganizationScope();
  // Recruiter-facing compliance copy follows the authenticated user's UI
  // language (User.preferredLanguage). Defaults to English. N6d: the same locale
  // is handed to the classifier so the LLM `reason` is written in that language.
  const locale = await getAuthenticatedUserLocale();
  const t = getServerT(locale);

  // Phase 1: read the draft and run the authoritative keyword gate.
  const validation = await prisma.$transaction(async (tx) => {
    const draft = await tx.interviewDraft.findFirst({
      include: {
        interview: true,
      },
      where: {
        id: normalizedDraftId,
        organizationId: scope.organizationId,
      },
    });

    if (!draft) {
      return null;
    }

    // Coerce-on-read through the canonical contract: this upgrades legacy rows
    // (signal -> expectedSignal, missing required/maxFollowups/category) and
    // never throws on a previously-valid row.
    const stored = parseStoredInterviewPlanSafe({
      criteria: draft.criteria,
      estimatedMinutes: draft.estimatedMinutes,
      focus: draft.focus,
      guardrails: draft.guardrails,
      questions: draft.questions,
      rationale: draft.rationale ?? "",
      responseModes: draft.responseModes,
      roleBrief: draft.roleBrief,
      roleTitle: draft.roleTitle,
      seniority: draft.seniority,
    });

    if (!stored) {
      return {
        error: "Interview plan is incomplete.",
        kind: "error" as const,
      };
    }

    const criteria = stored.criteria as InterviewCriterionDraft[];
    const guardrails = stored.guardrails;
    const questions = stored.questions as InterviewQuestionDraft[];
    const responseModes = stored.responseModes;

    const publicationIssues = getInterviewPlanPublicationIssues(
      {
        criteria,
        guardrails,
        questions,
        responseModes,
        roleBrief: draft.roleBrief,
        roleTitle: draft.roleTitle,
      },
      { disallowedTopicMessage: t("compliance.planDisallowedTopicBlock") },
    );

    if (publicationIssues.length > 0) {
      return {
        error: publicationIssues[0] ?? "Interview plan is incomplete.",
        kind: "error" as const,
      };
    }

    return {
      criteria,
      draft,
      guardrails,
      kind: "validated" as const,
      questions,
      responseModes,
    };
  });

  if (!validation) {
    return { ok: false, error: "Interview draft not found." };
  }

  if (validation.kind === "error") {
    return { ok: false, error: validation.error };
  }

  const { criteria, draft, guardrails, questions, responseModes } = validation;

  // Phase 2 (N6): the second-layer LLM classifier runs OUTSIDE the prisma
  // transaction, AFTER the keyword gate, to catch semantic evasions the keyword
  // layer misses. N6e: it fails CLOSED — a genuine classifier failure blocks the
  // publish with a retryable message rather than silently shipping unchecked
  // content. Config issues degrade to the deterministic provider upstream and
  // never block; only a configured-but-failing OpenAI call reaches the block.
  const segments = [
    ...questions.map(
      (question) => `${question.prompt} ${question.expectedSignal ?? ""}`,
    ),
    ...criteria.map((criterion) => `${criterion.label} ${criterion.description}`),
  ];

  // N6e: a thrown error means the classifier could not run. It is recorded below
  // as a skipped_error outcome and turned into a hard (retryable) block — never a
  // silent pass. (This supersedes the earlier N9 fail-open behavior.)
  let classifications: ProtectedTopicClassification[] = [];
  let classifierThrew = false;

  try {
    classifications = await classifier.classify(segments, { locale });
  } catch {
    classifierThrew = true;
  }

  // N6e: fail CLOSED. If the second-layer classifier could not run at all, block
  // the publish with a retryable message instead of silently shipping unchecked
  // content. Config issues (missing key, non-openai provider) degrade to the
  // deterministic provider upstream, so a throw here is a genuine runtime failure
  // of a configured LLM classifier — the keyword gate already passed, but the
  // semantic layer must not be silently skipped.
  if (classifierThrew) {
    logInterviewGenerationEvent(
      {
        event: "protected_topic_classification",
        model: classifier.modelName,
        outcome: "skipped_error",
        provider: classifier.provider,
        segmentCount: segments.length,
      },
      telemetry,
    );

    return { ok: false, error: t("compliance.classifierUnavailable") };
  }

  const flaggedSegments = classifications
    .map((classification, index) => ({
      ...classification,
      segment: segments[index] ?? "",
    }))
    .filter((classification) => classification.flagged);

  // N6b: an override only applies to a GENUINE materialized LLM flag. A thrown
  // classifier already blocked above (N6e), and a disabled classifier yields NO
  // flags here, so the override path is structurally unreachable for them — it can
  // never be laundered into an audited human decision. Only flags whose category
  // is overridable can be waived, and the publish proceeds only when EVERY flag
  // is overridable (one non-overridable flag keeps the whole publish a hard
  // block). The verdict is computed on the freshly-read draft, so it can never be
  // stale relative to the content being published.
  const everyFlagOverridable =
    flaggedSegments.length > 0 &&
    flaggedSegments.every((flag) =>
      isOverridableProtectedTopicCategory(flag.category),
    );
  // N6b role-gate: only an owner/admin may override; a basic recruiter/viewer
  // must escalate. A non-elevated role can never produce an applied override.
  const canOverrideByRole = overrideAllowedRoles.has(scope.role);
  const parsedOverride =
    override && everyFlagOverridable && canOverrideByRole
      ? complianceOverrideRequestSchema.safeParse(override)
      : null;
  // N6b rate-limit: even a valid override is denied once the recruiter exceeds
  // the rolling per-user cap. Counts only previously-APPLIED overrides (the event
  // log), so merely viewing flags never consumes the budget.
  let overrideRateLimited = false;
  if (parsedOverride?.success) {
    const windowStart = new Date(Date.now() - OVERRIDE_RATE_LIMIT_WINDOW_MS);
    const recentOverrides = await prisma.complianceOverrideEvent.count({
      where: {
        organizationId: scope.organizationId,
        overriddenByUserId: scope.userId,
        createdAt: { gte: windowStart },
      },
    });
    overrideRateLimited = recentOverrides >= OVERRIDE_RATE_LIMIT_MAX;
  }

  const overrideApplied =
    Boolean(parsedOverride?.success) && !overrideRateLimited;

  let overrideRecord: ComplianceOverrideRecord | null = null;
  if (parsedOverride?.success && !overrideRateLimited) {
    // Validate the server-constructed audit record through its contract before it
    // is persisted: defense-in-depth so a future refactor can never silently write
    // a malformed compliance record (every field here is already server-sourced
    // from the authenticated session and the live classifier verdict).
    overrideRecord = complianceOverrideRecordSchema.parse({
      justification: parsedOverride.data.justification,
      overriddenByUserId: scope.userId,
      overriddenByRole: scope.role,
      organizationId: scope.organizationId,
      overriddenAt: new Date().toISOString(),
      classifierProvider: classifier.provider,
      classifierModel: classifier.modelName,
      classifierPromptVersion: protectedTopicClassifierPromptVersion,
      classifierSchemaVersion: protectedTopicClassifierSchemaVersion,
      keywordGatePassed: true,
      flags: flaggedSegments.map((flag) => ({
        category: flag.category,
        reason: flag.reason,
        segment: flag.segment,
        ...(typeof flag.confidence === "number"
          ? { confidence: flag.confidence }
          : {}),
      })),
    });
  }

  const classificationOutcome: ProtectedTopicClassificationOutcome =
    classifier.provider === "disabled"
      ? "disabled"
      : overrideApplied
        ? "overridden"
        : flaggedSegments.length > 0
          ? "flagged"
          : "clean";

  logInterviewGenerationEvent(
    {
      event: "protected_topic_classification",
      category: flaggedSegments[0]?.category,
      model: classifier.modelName,
      outcome: classificationOutcome,
      provider: classifier.provider,
      segmentCount: segments.length,
    },
    telemetry,
  );

  const firstFlag = flaggedSegments[0];
  if (firstFlag && !overrideApplied) {
    return {
      ok: false,
      error: overrideRateLimited
        ? t("compliance.overrideRateLimited")
        : t("compliance.classifierDisallowedTopicBlock", {
            category: t(`category.${firstFlag.category}`),
            reason: firstFlag.reason,
          }),
      // Offer an override affordance ONLY when every flag is overridable and the
      // recruiter is not rate-limited. A non-overridable category (disability/
      // health, genetic, biometric, ...) is a hard block with no recourse.
      // requiresElevatedRole tells the UI to show an escalation message instead
      // of the override panel for a basic recruiter.
      review:
        !overrideRateLimited && everyFlagOverridable
          ? {
              category: firstFlag.category,
              categoryLabel: t(`category.${firstFlag.category}`),
              reason: firstFlag.reason,
              requiresElevatedRole: !canOverrideByRole,
            }
          : undefined,
    };
  }

  // Phase 2b: confirm the validated snapshot can form a valid live interview
  // plan against the authoritative live contract before we persist it. This is
  // a drift guard: if the canonical plan cannot map to the live worker shape,
  // the publish is blocked rather than producing an un-runnable interview.
  try {
    const canonicalPlan = parseStoredInterviewPlan({
      criteria,
      estimatedMinutes: draft.estimatedMinutes,
      focus: draft.focus,
      guardrails,
      questions,
      rationale: draft.rationale ?? "",
      responseModes,
      roleBrief: draft.roleBrief,
      roleTitle: draft.roleTitle,
      seniority: draft.seniority,
    });
    toLiveInterviewPlan({
      plan: canonicalPlan,
      planId: draft.id,
      jobId: draft.jobId,
    });
  } catch {
    return {
      ok: false,
      error: "Interview plan cannot be prepared for a live interview.",
    };
  }

  // Phase 3: write the published snapshot in its own transaction.
  const result = await prisma.$transaction(async (tx) => {
    const publicationMode = resolveInterviewDraftPublicationMode({
      draftStatus: draft.status,
      hasPublishedSnapshot: Boolean(draft.interview),
    });
    const publicToken =
      publicationMode === "return_existing_snapshot" && draft.interview
        ? draft.interview.publicToken
        : await createPublicToken(tx);

    const interviewData = {
      criteria: criteria as unknown as Prisma.InputJsonValue,
      estimatedMinutes: draft.estimatedMinutes,
      focus: draft.focus as Prisma.InputJsonValue,
      // N9: the published snapshot inherits the draft's generator provenance and
      // schema version so every Interview row records how its plan was produced.
      generatorModel: draft.generatorModel,
      generatorProvider: draft.generatorProvider,
      guardrails: guardrails as unknown as Prisma.InputJsonValue,
      jobId: draft.jobId,
      organizationId: scope.organizationId,
      publicToken,
      questions: questions as unknown as Prisma.InputJsonValue,
      rationale: draft.rationale,
      responseModes: responseModes as unknown as Prisma.InputJsonValue,
      roleBrief: draft.roleBrief,
      roleTitle: draft.roleTitle,
      schemaVersion: draft.schemaVersion ?? INTERVIEW_PLAN_SCHEMA_VERSION,
      seniority: draft.seniority,
      status: "published",
      // N6b: persist the immutable override audit record only when a flag was
      // actually overridden. Omitted (column stays NULL) on a clean publish.
      ...(overrideRecord
        ? {
            complianceOverride:
              overrideRecord as unknown as Prisma.InputJsonValue,
          }
        : {}),
    };

    if (publicationMode === "return_existing_snapshot" && draft.interview) {
      const interview =
        draft.interview.status === "published"
          ? draft.interview
          : await tx.interview.update({
              data: { status: "published" },
              where: { id: draft.interview.id },
            });

      return { interview, kind: "published" as const };
    }

    if (publicationMode === "create_republished_snapshot" && draft.interview) {
      await tx.interview.update({
        data: { draftId: null },
        where: { id: draft.interview.id },
      });
    }

    const interview = await tx.interview.create({
      data: {
        ...interviewData,
        draftId: draft.id,
      },
    });

    if (overrideRecord) {
      // N6b: append the queryable override event (the rate-limit + aggregation
      // index) transactionally with the published snapshot it belongs to.
      await tx.complianceOverrideEvent.create({
        data: {
          organizationId: scope.organizationId,
          interviewId: interview.id,
          overriddenByUserId: overrideRecord.overriddenByUserId,
          overriddenByRole: overrideRecord.overriddenByRole,
          // Denormalized so the event log is a self-sufficient audit/aggregation
          // record (the justification is the load-bearing oversight artifact).
          justification: overrideRecord.justification,
          category: overrideRecord.flags[0]?.category ?? "protected_topic",
          classifierProvider: overrideRecord.classifierProvider,
          classifierModel: overrideRecord.classifierModel,
        },
      });
    }

    await tx.interviewDraft.update({
      data: { status: "published" },
      where: { id: draft.id },
    });

    return { interview, kind: "published" as const };
  });

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${result.interview.id}`);
  revalidatePath(`/interviews/${result.interview.id}`);

  return {
    ok: true,
    candidatePath: `/interview/${result.interview.publicToken}`,
    detailPath: `/roles/${result.interview.id}`,
    interviewId: result.interview.id,
    publicToken: result.interview.publicToken,
  };
}

function normalizeDraftInput(
  input: SaveInterviewDraftInput,
  options: { disallowedTopicMessage: string },
):
  | {
      ok: true;
      data: SaveInterviewDraftInput;
    }
  | {
      ok: false;
      error: string;
    } {
  const roleTitle = input.roleTitle.trim();
  const roleBrief = input.roleBrief.trim();
  // N14: optional role location. Empty/whitespace collapses to null so the Job
  // column stays clean and RolesList search doesn't match on blank strings.
  const location = input.location?.trim() || null;
  const seniority = allowedSeniorities.has(input.seniority)
    ? input.seniority
    : "mid";
  const focus = input.focus.filter((item) => allowedFocus.has(item));
  const responseModes = input.responseModes.filter((mode) =>
    allowedModes.has(mode),
  );
  const questions = input.questions
    .map(coerceQuestion)
    .filter((question): question is InterviewQuestionDraft =>
      Boolean(question),
    );
  const criteria = input.criteria
    .map(normalizeCriterion)
    .filter((criterion): criterion is InterviewCriterionDraft =>
      Boolean(criterion),
    );
  const guardrails = input.guardrails
    .map((guardrail) => guardrail.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (roleTitle.length < 2) {
    return { ok: false, error: "Add a role title before saving." };
  }

  if (questions.length === 0) {
    return { ok: false, error: "Generate at least one question first." };
  }

  if (questions.length > interviewPlanPolicy.maxQuestions) {
    return { ok: false, error: "Keep the interview to 5 questions or fewer." };
  }

  if (criteria.length > interviewPlanPolicy.maxCriteria) {
    return {
      ok: false,
      error: "Keep the evaluation matrix to 5 criteria or fewer.",
    };
  }

  if (responseModes.length === 0) {
    return { ok: false, error: "Choose at least one candidate answer mode." };
  }

  if (planReferencesDisallowedTopic({ criteria, questions })) {
    return {
      ok: false,
      error: options.disallowedTopicMessage,
    };
  }

  const estimatedMinutes = Math.max(
    1,
    Math.min(45, input.estimatedMinutes || 1),
  );
  const rationale = input.rationale.trim();
  const sourceAttachmentName = input.sourceAttachmentName?.trim() || undefined;

  // Validate the whole plan through the canonical contract. This is the single
  // authoritative SAVE gate: it normalizes every question to the Hybrid shape
  // (required/maxFollowups/category/expectedSignal) and enforces the caps.
  const plan = interviewPlanSchema.safeParse({
    roleTitle,
    roleBrief,
    seniority,
    focus,
    responseModes,
    questions,
    criteria,
    guardrails,
    estimatedMinutes,
    rationale,
  });

  if (!plan.success) {
    return { ok: false, error: "Interview plan is incomplete." };
  }

  return {
    ok: true,
    data: {
      criteria: plan.data.criteria,
      draftId: input.draftId,
      estimatedMinutes,
      focus,
      generatorModel: input.generatorModel?.trim() || undefined,
      generatorProvider: input.generatorProvider?.trim() || undefined,
      guardrails,
      jobId: input.jobId,
      location,
      questions: plan.data.questions as InterviewQuestionDraft[],
      rationale,
      responseModes,
      roleBrief,
      roleTitle,
      seniority,
      sourceAttachmentName,
    },
  };
}

function coerceQuestion(
  question: InterviewQuestionDraft,
): InterviewQuestionDraft | null {
  const prompt = question.prompt.trim();

  if (prompt.length < 8) {
    return null;
  }

  return {
    category: question.category,
    durationSeconds: Math.max(
      30,
      Math.min(180, question.durationSeconds || 75),
    ),
    expectedSignal:
      question.expectedSignal?.trim() || "Job-related screening signal",
    id: question.id.trim() || slugify(prompt).slice(0, 48),
    maxFollowups:
      typeof question.maxFollowups === "number" ? question.maxFollowups : 1,
    prompt,
    required: typeof question.required === "boolean" ? question.required : true,
    source: question.source,
  };
}

function normalizeCriterion(
  criterion: InterviewCriterionDraft,
): InterviewCriterionDraft | null {
  const label = criterion.label.trim();

  if (label.length < 2) {
    return null;
  }

  return {
    description:
      criterion.description.trim() ||
      "Reviewer should look for concrete, job-related evidence.",
    id: criterion.id.trim() || slugify(label),
    label,
  };
}

function toDraftPersistenceData(
  input: SaveInterviewDraftInput & {
    jobId: string;
    organizationId: string;
  },
) {
  return {
    criteria: input.criteria as unknown as Prisma.InputJsonValue,
    estimatedMinutes: input.estimatedMinutes,
    focus: input.focus as unknown as Prisma.InputJsonValue,
    generatorModel: input.generatorModel ?? null,
    generatorProvider: input.generatorProvider ?? null,
    guardrails: input.guardrails as unknown as Prisma.InputJsonValue,
    jobId: input.jobId,
    organizationId: input.organizationId,
    questions: input.questions as unknown as Prisma.InputJsonValue,
    rationale: input.rationale,
    responseModes: input.responseModes as unknown as Prisma.InputJsonValue,
    roleBrief: input.roleBrief,
    roleTitle: input.roleTitle,
    schemaVersion: INTERVIEW_PLAN_SCHEMA_VERSION,
    seniority: input.seniority,
    sourceAttachmentName: input.sourceAttachmentName,
    status: "draft",
  };
}

function parseStoredInterviewPlanSafe(raw: unknown) {
  try {
    return parseStoredInterviewPlan(raw);
  } catch {
    return null;
  }
}

async function createPublicToken(
  tx: Pick<Prisma.TransactionClient, "interview">,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = `iv_${randomBytes(9).toString("base64url")}`;
    const existing = await tx.interview.findUnique({
      select: { id: true },
      where: { publicToken: token },
    });

    if (!existing) {
      return token;
    }
  }

  throw new Error("Could not generate a unique interview token.");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
