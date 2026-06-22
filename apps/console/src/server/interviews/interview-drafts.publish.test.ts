import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
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
  })),
}));

import { publishInterviewDraft } from "./interview-drafts";

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
      durationSeconds: 75,
      id: "q1",
      prompt: "Describe a production incident you debugged end to end.",
      signal: "Problem solving",
      source: "agent",
    },
    {
      durationSeconds: 75,
      id: "q2",
      prompt: "Tell me about a time you communicated a tricky tradeoff.",
      signal: "Communication",
      source: "agent",
    },
    {
      durationSeconds: 75,
      id: "q3",
      prompt: "How do you keep a long project on track?",
      signal: "Ownership",
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
});

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
});

describe("publishInterviewDraft N6 classifier wiring", () => {
  it("publishes when the classifier returns no flags", async () => {
    const result = await publishInterviewDraft("draft_1", passThroughClassifier());

    expect(result.ok).toBe(true);
    expect(tx.interview.create).toHaveBeenCalledTimes(1);
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
          durationSeconds: 75,
          id: "q1",
          prompt: "How old are you?",
          signal: "Age",
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
