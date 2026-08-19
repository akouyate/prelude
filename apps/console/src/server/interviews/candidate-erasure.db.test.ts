import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The erasure core against a REAL Postgres, not a Prisma mock.
 *
 * The unit test next door proves which Prisma calls are made; only this one
 * proves what actually lands in the database — that the brief row is gone, that
 * the identity columns are null, and above all that the billing trace and the
 * timestamps SURVIVED. That last part is a legal commitment made to candidates
 * in the consent copy, and a mocked `update` can never demonstrate it, because
 * a mock cannot show what a real `UPDATE ... SET` left alone.
 *
 * ⚠ The sweep case calls the REAL sweep, which is deliberately cross-workspace.
 * Point TEST_DATABASE_URL at a database you are willing to sweep: any session in
 * it completed more than 12 months ago WILL be erased, fixtures or not. That is
 * the sweep behaving correctly, not the test overreaching.
 *
 * Skipped without TEST_DATABASE_URL, like the ledger's own db suite:
 *
 *   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5440/prelude?schema=public" \
 *     pnpm --dir apps/console exec vitest run src/server/interviews/candidate-erasure.db.test.ts
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

// The `@prelude/db` singleton reads DATABASE_URL at construction, so it has to be
// set before the module graph is imported — hence `vi.hoisted` + a dynamic import
// inside `beforeAll` rather than a top-level `import`.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
});

vi.mock("server-only", () => ({}));

// The detail loader resolves the caller's workspace through Clerk; the scope is
// the only thing stubbed, so everything below it runs against the real database.
const scopeMock = vi.hoisted(() => ({ getCompletedOrganizationScope: vi.fn() }));
vi.mock("../organizations/organization-scope", () => scopeMock);

describe.skipIf(!databaseUrl)("candidate erasure (Postgres)", () => {
  let prisma: typeof import("@prelude/db").prisma;
  let erasure: typeof import("./candidate-erasure");
  let loaders: typeof import("./interview-loaders");
  let briefs: typeof import("./candidate-brief-generation");

  const runId = `lft3b_${Date.now()}`;
  const organizationId = `${runId}_org`;
  const otherOrganizationId = `${runId}_org_other`;

  beforeAll(async () => {
    ({ prisma } = await import("@prelude/db"));
    erasure = await import("./candidate-erasure");
    loaders = await import("./interview-loaders");
    briefs = await import("./candidate-brief-generation");

    for (const id of [organizationId, otherOrganizationId]) {
      await prisma.organization.create({
        data: { id, name: id },
      });
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    // Job → interview → invitation → session → brief all cascade; `Job` itself
    // does NOT cascade from `Organization` (its relation is unqualified, so
    // Prisma restricts), so the jobs go first and the organizations after.
    const organizationIds = [organizationId, otherOrganizationId];
    await prisma.job.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  async function seedSession({
    completedAt,
    label,
    organization = organizationId,
  }: {
    completedAt: Date;
    label: string;
    organization?: string;
  }) {
    const job = await prisma.job.create({
      data: {
        description: "Seeded by the erasure db test.",
        organizationId: organization,
        title: `${label} job`,
      },
    });
    const interview = await prisma.interview.create({
      data: {
        jobId: job.id,
        organizationId: organization,
        publicToken: `${runId}_${label}_public`,
        roleBrief: "Seeded.",
        roleTitle: `${label} role`,
      },
    });
    const invitation = await prisma.candidateInvitation.create({
      data: {
        candidateEmail: "ada@example.test",
        candidateName: "Ada Lovelace",
        expiresAt: new Date(Date.now() + 86_400_000),
        interviewId: interview.id,
        jobId: job.id,
        organizationId: organization,
        token: `${runId}_${label}_invite`,
      },
    });
    const session = await prisma.candidateSession.create({
      data: {
        billedAnsweredCount: 4,
        billedOutcome: "captured",
        billedRequiredCount: 5,
        candidateEmail: "ada@example.test",
        candidateInvitationId: invitation.id,
        candidateName: "Ada Lovelace",
        completedAt,
        interviewId: interview.id,
        jobId: job.id,
        organizationId: organization,
        resumeToken: `${runId}_${label}_resume`,
        startedAt: new Date(completedAt.getTime() - 900_000),
        status: "completed",
      },
    });
    await prisma.candidateBrief.create({
      data: {
        candidateSessionId: session.id,
        organizationId: organization,
        recommendation: "Strong on migrations.",
        status: "completed",
        summaryJson: { headline: "Ada answered every question." },
      },
    });

    return { invitation, session };
  }

  it("deletes the brief and the identity, and leaves the tombstone standing", async () => {
    const { invitation, session } = await seedSession({
      completedAt: new Date("2026-08-01T10:00:00.000Z"),
      label: "onrequest",
    });
    const erasedAt = new Date("2026-08-19T09:00:00.000Z");

    const result = await erasure.eraseCandidateSessionData({
      candidateSessionId: session.id,
      now: erasedAt,
      organizationId,
      reason: erasure.erasureReasonRequest,
    });
    expect(result).toEqual({ erased: true, realtimeSessionId: null });

    const after = await prisma.candidateSession.findUniqueOrThrow({
      where: { id: session.id },
    });

    // Gone.
    expect(after.candidateName).toBeNull();
    expect(after.candidateEmail).toBeNull();
    expect(after.resumeToken).toBeNull();
    expect(
      await prisma.candidateBrief.findUnique({
        where: { candidateSessionId: session.id },
      }),
    ).toBeNull();

    // Stamped.
    expect(after.erasedAt).toEqual(erasedAt);
    expect(after.erasureReason).toBe(erasure.erasureReasonRequest);

    // Surviving — the Art. 17(3) tombstone, verified on the real row.
    expect(after.id).toBe(session.id);
    expect(after.status).toBe("completed");
    expect(after.startedAt).toEqual(session.startedAt);
    expect(after.completedAt).toEqual(session.completedAt);
    expect(after.createdAt).toEqual(session.createdAt);
    expect(after.billedAnsweredCount).toBe(4);
    expect(after.billedRequiredCount).toBe(5);
    expect(after.billedOutcome).toBe("captured");

    // The invitation loses the identity, keeps everything that is not identity.
    const invitationAfter = await prisma.candidateInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(invitationAfter.candidateName).toBeNull();
    expect(invitationAfter.candidateEmail).toBeNull();
    // The token survives as an opaque identifier, but it is now INERT: the link
    // in the candidate's inbox must not be able to start a fresh session that
    // re-collects the identity this erasure just deleted.
    expect(invitationAfter.token).toBe(invitation.token);
    expect(invitationAfter.status).toBe("expired");
    // Pinned to the erasure instant itself, so the link dies exactly when the
    // right was honoured. (Whether a reader then refuses it is the candidate
    // app's job, pinned in apps/candidate's public-interviews suite.)
    expect(invitationAfter.expiresAt).toEqual(erasedAt);
  });

  it("hands the detail page a readable tombstone rather than a broken row", async () => {
    const { session } = await seedSession({
      completedAt: new Date("2026-08-01T10:00:00.000Z"),
      label: "rendered",
    });
    const erasedAt = new Date("2026-08-19T09:00:00.000Z");
    await erasure.eraseCandidateSessionData({
      candidateSessionId: session.id,
      now: erasedAt,
      organizationId,
      reason: erasure.erasureReasonRequest,
    });

    scopeMock.getCompletedOrganizationScope.mockResolvedValue({
      organizationId,
      organizationName: organizationId,
      role: "owner",
      userId: `${runId}_user`,
    });
    const detail = await loaders.getInterviewDetail(session.id);

    expect(detail?.kind).toBe("candidate_session");
    if (detail?.kind !== "candidate_session") return;

    // The stamp the page branches on, and the two things whose absence would
    // otherwise read as a bug rather than as an erasure.
    expect(detail.candidateSession.erasedAt).toBe(erasedAt.toISOString());
    expect(detail.candidateSession.erasureReason).toBe(erasure.erasureReasonRequest);
    expect(detail.candidateSession.brief).toBeNull();
    expect(detail.candidateSession.candidateEmail).toBeNull();
    // No name and no email: the label falls back to an id-derived placeholder
    // instead of rendering empty (or throwing).
    expect(detail.candidateSession.candidateLabel).toMatch(/^Candidate /);
    // And the tombstone the recruiter can still answer a billing dispute with.
    expect(detail.candidateSession.billedAnsweredCount).toBe(4);
    expect(detail.candidateSession.billedOutcome).toBe("captured");
  });

  it("cannot have its brief regenerated back into existence", async () => {
    // The page hides the regenerate button post-erasure, but a stale tab still
    // holds a live server action. Against a real database: the guard holds and
    // no CandidateBrief row comes back.
    const { session } = await seedSession({
      completedAt: new Date("2026-08-01T10:00:00.000Z"),
      label: "regen",
    });
    await erasure.eraseCandidateSessionData({
      candidateSessionId: session.id,
      now: new Date("2026-08-19T09:00:00.000Z"),
      organizationId,
      reason: erasure.erasureReasonRequest,
    });
    expect(
      await prisma.candidateBrief.findUnique({
        where: { candidateSessionId: session.id },
      }),
    ).toBeNull();

    const result = await briefs.generateCandidateBriefForSession({
      candidateSessionId: session.id,
      organizationId,
      synthesizer: {
        modelName: "test",
        provider: "test",
        synthesize: async () => {
          throw new Error("the synthesizer must never run for an erased session");
        },
      },
    });

    expect(result).toEqual({
      reason: "candidate_session_erased",
      status: "skipped",
    });
    expect(
      await prisma.candidateBrief.findUnique({
        where: { candidateSessionId: session.id },
      }),
    ).toBeNull();
  });

  it("refuses to reach across organizations", async () => {
    const { session } = await seedSession({
      completedAt: new Date("2026-08-01T10:00:00.000Z"),
      label: "otherorg",
      organization: otherOrganizationId,
    });

    const result = await erasure.eraseCandidateSessionData({
      candidateSessionId: session.id,
      organizationId,
      reason: erasure.erasureReasonRequest,
    });

    expect(result).toEqual({ erased: false, reason: "not_found" });
    const after = await prisma.candidateSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.candidateName).toBe("Ada Lovelace");
  });

  it("sweeps only what is past the 12-month horizon, and erases it the same way", async () => {
    const now = new Date("2026-08-19T09:00:00.000Z");
    const { session: expired } = await seedSession({
      // 13 months back — past the horizon.
      completedAt: new Date("2025-07-19T09:00:00.000Z"),
      label: "expired",
    });
    const { session: fresh } = await seedSession({
      // 11 months back — inside it.
      completedAt: new Date("2025-09-19T09:00:00.000Z"),
      label: "fresh",
    });

    const report = await erasure.sweepExpiredCandidateData({ limit: 500, now });
    expect(report.failed).toBe(0);
    expect(report.erased).toBeGreaterThanOrEqual(1);

    const expiredAfter = await prisma.candidateSession.findUniqueOrThrow({
      where: { id: expired.id },
    });
    expect(expiredAfter.candidateName).toBeNull();
    expect(expiredAfter.erasureReason).toBe(erasure.erasureReasonRetention);
    expect(expiredAfter.billedOutcome).toBe("captured");

    const freshAfter = await prisma.candidateSession.findUniqueOrThrow({
      where: { id: fresh.id },
    });
    expect(freshAfter.candidateName).toBe("Ada Lovelace");
    expect(freshAfter.erasedAt).toBeNull();

    // Idempotent: the second pass no longer selects the row it already erased.
    const secondPass = await erasure.sweepExpiredCandidateData({ limit: 500, now });
    const stillErased = await prisma.candidateSession.findUniqueOrThrow({
      where: { id: expired.id },
    });
    expect(secondPass.scanned).toBeLessThan(report.scanned + 1);
    expect(stillErased.erasedAt).toEqual(expiredAfter.erasedAt);
  });
});
