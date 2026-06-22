import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVIEW_PLAN_SCHEMA_VERSION,
  parseStoredInterviewPlan,
  toLiveInterviewPlan,
} from "@prelude/contracts";

import type { ProtectedTopicClassifier } from "./protected-topic-classifier";

const draftRecord = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const tx = vi.hoisted(() => ({
  interview: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  interviewDraft: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  complianceOverrideEvent: {
    create: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  complianceOverrideEvent: {
    count: vi.fn(async () => 0),
  },
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../organizations/organization-scope", () => ({
  getCompletedOrganizationScope: vi.fn(async () => ({
    organizationId: "org_123",
    userId: "user_123",
    role: "owner",
  })),
}));

import { publishInterviewDraft } from "./interview-drafts";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

const publishableDraft = () => ({
  criteria: [
    {
      id: "c1",
      label: "Problem solving",
      description: "Looks for concrete, job-related evidence.",
    },
    {
      id: "c2",
      label: "Communication",
      description: "Explains decisions clearly.",
    },
    {
      id: "c3",
      label: "Ownership",
      description: "Drives tasks to completion.",
    },
  ],
  estimatedMinutes: 15,
  focus: ["role_skills"],
  guardrails: [
    "Ask every candidate the same questions in the same order.",
    "Analyze only candidate response content.",
    "Do not analyze face, accent, tone, emotion, or protected attributes.",
    "Do not make automatic hiring or rejection decisions.",
    "Keep final review and next-step decisions under human control.",
    "Ignore volunteered protected or sensitive information when forming recruiter-facing evidence.",
  ],
  id: "draft_1",
  interview: null,
  jobId: "job_1",
  questions: [
    {
      category: "experience",
      durationSeconds: 75,
      expectedSignal: "Problem solving",
      id: "q1",
      maxFollowups: 1,
      prompt: "Describe a production incident you debugged end to end.",
      required: true,
      source: "agent",
    },
    {
      category: "custom",
      durationSeconds: 75,
      expectedSignal: "Communication",
      id: "q2",
      maxFollowups: 1,
      prompt: "Tell me about a time you communicated a tricky tradeoff.",
      required: true,
      source: "agent",
    },
    {
      category: "experience",
      durationSeconds: 75,
      expectedSignal: "Ownership",
      id: "q3",
      maxFollowups: 1,
      prompt: "How do you keep a long project on track?",
      required: true,
      source: "agent",
    },
  ],
  rationale: "Prepared focused first-screen questions.",
  responseModes: ["audio", "text"],
  roleBrief:
    "We are hiring a backend engineer to own services, debug incidents, and communicate clearly with the team.",
  roleTitle: "Backend Engineer",
  seniority: "mid",
  status: "draft",
  schemaVersion: 1,
  generatorProvider: "openai_responses",
  generatorModel: "gpt-test",
});

function captureTelemetry() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    telemetry: {
      info: (payload: Record<string, unknown>) => events.push(payload),
      warn: (payload: Record<string, unknown>) => events.push(payload),
    },
  };
}

const passThroughClassifier = (): ProtectedTopicClassifier => ({
  classify: vi.fn(async (texts: string[]) =>
    texts.map(() => ({ flagged: false, category: "none" as const, reason: "" })),
  ),
  modelName: "test",
  provider: "test",
});

beforeEach(() => {
  vi.clearAllMocks();
  draftRecord.current = publishableDraft();
  tx.interviewDraft.findFirst.mockImplementation(async () => draftRecord.current);
  tx.interviewDraft.update.mockResolvedValue({});
  tx.interview.findUnique.mockResolvedValue(null);
  tx.interview.update.mockResolvedValue({});
  tx.interview.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "interview_1",
    publicToken: data.publicToken,
    status: "published",
  }));
  tx.complianceOverrideEvent.create.mockResolvedValue({});
  prismaMock.complianceOverrideEvent.count.mockResolvedValue(0);
});

describe("publishInterviewDraft N6 classifier wiring", () => {
  it("publishes when the classifier returns no flags", async () => {
    const result = await publishInterviewDraft("draft_1", passThroughClassifier());

    expect(result.ok).toBe(true);
    expect(tx.interview.create).toHaveBeenCalledTimes(1);
  });

  it("persists a canonical Hybrid snapshot that forms a valid live plan", async () => {
    await publishInterviewDraft("draft_1", passThroughClassifier());

    const createCall = tx.interview.create.mock.calls[0]?.[0] as
      | { data: { questions: unknown; responseModes: unknown } }
      | undefined;
    const questions = (createCall?.data.questions ?? []) as Array<
      Record<string, unknown>
    >;

    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(question.expectedSignal).toBeTruthy();
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect(typeof question.category).toBe("string");
    }

    // The persisted snapshot must be able to form a valid live interview plan.
    const plan = parseStoredInterviewPlan(createCall?.data);
    expect(() =>
      toLiveInterviewPlan({ plan, planId: "plan_1", jobId: "job_1" }),
    ).not.toThrow();
  });

  it("runs the classifier OUTSIDE the prisma transaction", async () => {
    const order: string[] = [];

    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => {
        order.push("tx");
        return callback(tx);
      },
    );

    const classifier: ProtectedTopicClassifier = {
      classify: vi.fn(async (texts: string[]) => {
        order.push("classify");
        return texts.map(() => ({
          flagged: false,
          category: "none" as const,
          reason: "",
        }));
      }),
      modelName: "test",
      provider: "test",
    };

    await publishInterviewDraft("draft_1", classifier);

    // Read+validate tx runs, THEN classify, THEN the write tx.
    expect(order).toEqual(["tx", "classify", "tx"]);
  });

  it("hard-blocks publish with a precise message on the first flagged segment", async () => {
    const classifier: ProtectedTopicClassifier = {
      classify: vi.fn(async (texts: string[]) =>
        texts.map((_text, index) =>
          index === 1
            ? {
                flagged: true,
                category: "age" as const,
                reason: "asks indirectly about candidate age via graduation decade",
              }
            : { flagged: false, category: "none" as const, reason: "" },
        ),
      ),
      modelName: "test",
      provider: "test",
    };

    const result = await publishInterviewDraft("draft_1", classifier);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("age");
      expect(result.error).toContain(
        "asks indirectly about candidate age via graduation decade",
      );
      expect(result.error).toContain("Remove a protected or disallowed topic");
    }

    // The snapshot must NOT be written when the classifier flags content.
    expect(tx.interview.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.update).not.toHaveBeenCalled();
  });

  it("passes every question and criterion segment to the classifier", async () => {
    const classifier = passThroughClassifier();

    await publishInterviewDraft("draft_1", classifier);

    const classifyMock = classifier.classify as ReturnType<typeof vi.fn>;
    const segments = (classifyMock.mock.calls[0]?.[0] ?? []) as string[];

    // 3 questions + 3 criteria
    expect(segments).toHaveLength(6);
    expect(segments[0]).toContain("Describe a production incident");
    expect(segments[0]).toContain("Problem solving");
    expect(segments[3]).toContain("Problem solving");
  });

  it("still blocks on the keyword gate before reaching the classifier", async () => {
    draftRecord.current = {
      ...publishableDraft(),
      questions: [
        {
          category: "custom",
          durationSeconds: 75,
          expectedSignal: "Age",
          id: "q1",
          maxFollowups: 1,
          prompt: "How old are you?",
          required: true,
          source: "agent",
        },
      ],
    };

    const classifier = passThroughClassifier();
    const result = await publishInterviewDraft("draft_1", classifier);

    expect(result.ok).toBe(false);
    // Keyword layer is authoritative and runs first; classifier is not consulted.
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

// N10.C — the deferred N1 PUBLISH lock. publishInterviewDraft must be blocked by
// the authoritative keyword gate on a disallowed topic and write nothing, and the
// published snapshot must persist the validated/normalized canonical arrays (not
// the raw stored row) and stamp the schema version.
describe("N10 publishInterviewDraft compliance + snapshot canonicalization", () => {
  it("is blocked by the keyword gate on a disallowed topic and writes nothing", async () => {
    draftRecord.current = {
      ...publishableDraft(),
      criteria: [
        {
          id: "c1",
          label: "Pregnancy plans",
          description: "Whether the candidate is pregnant or planning a family.",
        },
        ...publishableDraft().criteria.slice(1),
      ],
    };

    const classifier = passThroughClassifier();
    const result = await publishInterviewDraft("draft_1", classifier);

    expect(result.ok).toBe(false);
    // No snapshot, no status flip; keyword gate runs before the classifier.
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(tx.interview.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.update).not.toHaveBeenCalled();
  });

  it("persists the normalized canonical arrays (legacy signal -> expectedSignal) and stamps schemaVersion", async () => {
    // A legacy-shaped stored row: questions use `signal`, lack category. The
    // publish path coerces it through the canonical contract, so the persisted
    // snapshot must carry the upgraded Hybrid fields, not the raw row.
    draftRecord.current = {
      ...publishableDraft(),
      schemaVersion: undefined,
      questions: [
        {
          id: "q1",
          prompt: "Describe a production incident you debugged end to end.",
          signal: "Problem solving",
          source: "job_description",
          durationSeconds: 75,
        },
        {
          id: "q2",
          prompt: "Tell me about a time you communicated a tricky tradeoff.",
          signal: "Communication",
          source: "agent",
          durationSeconds: 75,
        },
        {
          id: "q3",
          prompt: "How do you keep a long project on track?",
          signal: "Ownership",
          source: "job_description",
          durationSeconds: 75,
        },
      ],
    };

    const result = await publishInterviewDraft("draft_1", passThroughClassifier());
    expect(result.ok).toBe(true);

    const createCall = tx.interview.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    const questions = (createCall?.data.questions ?? []) as Array<
      Record<string, unknown>
    >;

    // Raw row had `signal`; the persisted snapshot must carry canonical
    // `expectedSignal` + the Hybrid defaults, proving it is normalized not raw.
    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(question).not.toHaveProperty("signal");
      expect(question.expectedSignal).toBeTruthy();
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect(typeof question.category).toBe("string");
    }
    expect(questions[0]?.expectedSignal).toBe("Problem solving");

    // schemaVersion is stamped even though the raw row omitted it.
    expect(createCall?.data.schemaVersion).toBe(INTERVIEW_PLAN_SCHEMA_VERSION);

    // The persisted snapshot must form a valid live interview plan.
    const plan = parseStoredInterviewPlan(createCall?.data);
    expect(() =>
      toLiveInterviewPlan({ plan, planId: "plan_1", jobId: "job_1" }),
    ).not.toThrow();
  });
});

describe("publishInterviewDraft N9 provenance + telemetry", () => {
  it("copies the draft provenance onto the published interview snapshot", async () => {
    await publishInterviewDraft("draft_1", passThroughClassifier());

    const createCall = tx.interview.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.schemaVersion).toBe(1);
    expect(createCall?.data.generatorProvider).toBe("openai_responses");
    expect(createCall?.data.generatorModel).toBe("gpt-test");
  });

  it("logs the N6 classifier outcome as clean when nothing is flagged", async () => {
    const { events, telemetry } = captureTelemetry();

    await publishInterviewDraft("draft_1", passThroughClassifier(), telemetry);

    const outcome = events.find(
      (event) => event.event === "protected_topic_classification",
    );
    expect(outcome).toMatchObject({
      event: "protected_topic_classification",
      outcome: "clean",
    });
  });

  it("logs the N6 classifier outcome as flagged when a segment is flagged", async () => {
    const { events, telemetry } = captureTelemetry();
    const classifier: ProtectedTopicClassifier = {
      classify: vi.fn(async (texts: string[]) =>
        texts.map((_text, index) =>
          index === 1
            ? {
                flagged: true,
                category: "age" as const,
                reason: "indirect age proxy",
              }
            : { flagged: false, category: "none" as const, reason: "" },
        ),
      ),
      modelName: "gpt-test",
      provider: "openai_responses",
    };

    await publishInterviewDraft("draft_1", classifier, telemetry);

    const outcome = events.find(
      (event) => event.event === "protected_topic_classification",
    );
    expect(outcome).toMatchObject({
      event: "protected_topic_classification",
      outcome: "flagged",
    });
  });

  it("logs the N6 classifier outcome as disabled when the classifier is off", async () => {
    const { events, telemetry } = captureTelemetry();
    const disabled: ProtectedTopicClassifier = {
      classify: vi.fn(async (texts: string[]) =>
        texts.map(() => ({ flagged: false, category: "none" as const, reason: "" })),
      ),
      modelName: "disabled",
      provider: "disabled",
    };

    const result = await publishInterviewDraft("draft_1", disabled, telemetry);

    expect(result.ok).toBe(true);
    const outcome = events.find(
      (event) => event.event === "protected_topic_classification",
    );
    expect(outcome).toMatchObject({ outcome: "disabled" });
  });

  it("fails CLOSED (blocks publish) and logs skipped_error when the classifier throws", async () => {
    const { events, telemetry } = captureTelemetry();
    const throwing: ProtectedTopicClassifier = {
      classify: vi.fn(async () => {
        throw new Error("classifier exploded");
      }),
      modelName: "gpt-test",
      provider: "openai_responses",
    };

    const result = await publishInterviewDraft("draft_1", throwing, telemetry);

    // N6e: fails CLOSED — a genuine classifier failure blocks the publish
    // (retryable) instead of silently shipping unchecked content. No snapshot.
    expect(result.ok).toBe(false);
    expect(tx.interview.create).not.toHaveBeenCalled();
    const outcome = events.find(
      (event) => event.event === "protected_topic_classification",
    );
    expect(outcome).toMatchObject({ outcome: "skipped_error" });
  });
});

// N6b — reviewable override for the second-layer (LLM) classifier. Only a
// genuine, materialized LLM flag on an OVERRIDABLE category can be consciously
// overridden, with a substantive justification, persisted as an immutable audit
// record. The deterministic keyword gate and the gravest categories are never
// overridable; a fail-open/disabled classifier never reaches the override path.
describe("publishInterviewDraft N6b reviewable override", () => {
  const flaggingClassifier = (
    category: string,
    atIndex = 0,
  ): ProtectedTopicClassifier => ({
    classify: vi.fn(async (texts: string[]) =>
      texts.map((_text, index) =>
        index === atIndex
          ? {
              flagged: true,
              category: category as never,
              reason: `flagged as ${category} proxy`,
              confidence: 0.77,
            }
          : { flagged: false, category: "none" as const, reason: "" },
      ),
    ),
    modelName: "gpt-test",
    provider: "openai_responses",
  });

  const validJustification =
    "Weekend availability is a bona-fide scheduling requirement for this role.";

  it("returns an override affordance (no snapshot) when an overridable category is flagged without an override", async () => {
    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.review).toBeDefined();
      expect(result.review?.category).toBe("age");
      expect(result.review?.categoryLabel).toBeTruthy();
      expect(result.review?.reason).toContain("age");
      // An owner can override directly — no escalation needed.
      expect(result.review?.requiresElevatedRole).toBe(false);
    }
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("publishes when a valid override is supplied for an overridable flag", async () => {
    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(true);
    expect(tx.interview.create).toHaveBeenCalledTimes(1);
  });

  it("persists an immutable audit record on the published snapshot", async () => {
    await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: validJustification },
    );

    const createCall = tx.interview.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    const override = createCall?.data.complianceOverride as
      | Record<string, unknown>
      | undefined;

    expect(override).toBeDefined();
    expect(override?.overriddenByUserId).toBe("user_123");
    expect(override?.organizationId).toBe("org_123");
    expect(override?.justification).toBe(validJustification);
    expect(override?.keywordGatePassed).toBe(true);
    expect(override?.classifierProvider).toBe("openai_responses");
    expect(override?.classifierModel).toBe("gpt-test");
    expect(override?.overriddenByRole).toBe("owner");
    expect(typeof override?.classifierPromptVersion).toBe("string");
    expect(typeof override?.classifierSchemaVersion).toBe("string");

    const flags = (override?.flags ?? []) as Array<Record<string, unknown>>;
    expect(flags).toHaveLength(1);
    expect(flags[0]?.category).toBe("age");
    expect(flags[0]?.confidence).toBe(0.77);
    expect(String(flags[0]?.segment)).toContain(
      "Describe a production incident",
    );
  });

  it("blocks an override from a non-elevated role and flags it for escalation", async () => {
    vi.mocked(getCompletedOrganizationScope).mockResolvedValueOnce({
      organizationId: "org_123",
      userId: "user_123",
      role: "recruiter",
    } as never);

    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A non-owner/admin recruiter cannot override — the affordance tells the
      // UI to show an escalation message instead of the override panel.
      expect(result.review?.requiresElevatedRole).toBe(true);
    }
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("rejects an override whose justification is too thin (server-side friction)", async () => {
    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: "ok" },
    );

    expect(result.ok).toBe(false);
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("never allows overriding the gravest categories (e.g. disability/health)", async () => {
    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("disability_or_health", 0),
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // No override affordance is offered for a non-overridable category.
      expect(result.review).toBeUndefined();
    }
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("logs a distinct `overridden` telemetry outcome", async () => {
    const { events, telemetry } = captureTelemetry();

    await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      telemetry,
      { justification: validJustification },
    );

    const outcome = events.find(
      (event) => event.event === "protected_topic_classification",
    );
    expect(outcome).toMatchObject({ outcome: "overridden" });
  });

  it("does not let an override bypass the authoritative keyword gate", async () => {
    draftRecord.current = {
      ...publishableDraft(),
      questions: [
        {
          category: "custom",
          durationSeconds: 75,
          expectedSignal: "Age",
          id: "q1",
          maxFollowups: 1,
          prompt: "How old are you?",
          required: true,
          source: "agent",
        },
      ],
    };

    const classifier = flaggingClassifier("age", 0);
    const result = await publishInterviewDraft(
      "draft_1",
      classifier,
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(false);
    // The keyword layer is authoritative and non-overridable: the classifier is
    // never even consulted, and no override is recorded.
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(tx.interview.create).not.toHaveBeenCalled();
  });

  it("records no override when an override is supplied but nothing is flagged", async () => {
    const result = await publishInterviewDraft(
      "draft_1",
      passThroughClassifier(),
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(true);
    const createCall = tx.interview.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(createCall?.data.complianceOverride ?? null).toBeNull();
  });

  it("records a queryable ComplianceOverrideEvent for an applied override", async () => {
    await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: validJustification },
    );

    expect(tx.complianceOverrideEvent.create).toHaveBeenCalledTimes(1);
    const eventData = (
      tx.complianceOverrideEvent.create.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined
    )?.data;
    expect(eventData?.organizationId).toBe("org_123");
    expect(eventData?.overriddenByUserId).toBe("user_123");
    expect(eventData?.overriddenByRole).toBe("owner");
    expect(eventData?.category).toBe("age");
    // The justification is denormalized onto the event so the audit/aggregation
    // log is self-sufficient even if the Interview row is later removed.
    expect(eventData?.justification).toBe(validJustification);
  });

  it("blocks an override once the per-recruiter rolling rate limit is exceeded", async () => {
    prismaMock.complianceOverrideEvent.count.mockResolvedValueOnce(50);

    const result = await publishInterviewDraft(
      "draft_1",
      flaggingClassifier("age", 0),
      undefined,
      { justification: validJustification },
    );

    expect(result.ok).toBe(false);
    // Over the cap: the override is denied, nothing is published, and no event
    // is recorded (the recruiter must escalate to an admin).
    expect(tx.interview.create).not.toHaveBeenCalled();
    expect(tx.complianceOverrideEvent.create).not.toHaveBeenCalled();
  });
});
