import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateSession: {
    findFirst: vi.fn(),
  },
}));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const revalidateMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("next/cache", () => revalidateMock);

import { deleteRecordingAction } from "./recording-actions";

function scope(role: string) {
  return { organizationId: "org_123", role, userId: "user_123" };
}

describe("deleteRecordingAction", () => {
  beforeEach(() => {
    vi.stubEnv("PRELUDE_REALTIME_API_URL", "http://realtime.test");
    vi.stubGlobal("fetch", vi.fn());
    prismaMock.candidateSession.findFirst.mockReset();
    scopeMock.getCompletedOrganizationScope.mockReset();
    revalidateMock.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses a recruiter (only owners and admins may erase)", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("recruiter"));

    await expect(
      deleteRecordingAction({ candidateSessionId: "cs_1" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.findFirst).not.toHaveBeenCalled();
  });

  it("calls the Go realtime erasure endpoint for a session in the caller's org", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("owner"));
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await deleteRecordingAction({ candidateSessionId: "cs_1" });

    // Org-scoped lookup.
    expect(prismaMock.candidateSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs_1", organizationId: "org_123" },
      }),
    );
    // The console delegates deletion to the Go service (which owns R2 deletion) —
    // it never tombstones locally, which would orphan the audio object.
    expect(fetch).toHaveBeenCalledWith(
      "http://realtime.test/v1/interview-sessions/is_real/recordings",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(revalidateMock.revalidatePath).toHaveBeenCalled();
  });

  it("does nothing when the session has no recording or is not in the org", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("admin"));
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);

    await deleteRecordingAction({ candidateSessionId: "cs_missing" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when the realtime service fails, so the caller can retry", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("owner"));
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      deleteRecordingAction({ candidateSessionId: "cs_1" }),
    ).rejects.toThrow();
    expect(revalidateMock.revalidatePath).not.toHaveBeenCalled();
  });
});
