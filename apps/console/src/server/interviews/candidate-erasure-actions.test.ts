import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action layer only authorizes and scopes; the write set itself is pinned in
 * `candidate-erasure.test.ts`. So the erasure core is mocked here on purpose —
 * what this file proves is the ROLE GATE and that the scope handed down is the
 * caller's own organization, never one supplied by the client.
 */
const erasureMock = vi.hoisted(() => ({
  eraseCandidateSessionData: vi.fn(),
  erasureReasonRequest: "erasure_request",
}));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const revalidateMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("./candidate-erasure", () => erasureMock);
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("next/cache", () => revalidateMock);

import { eraseCandidateDataAction } from "./candidate-erasure-actions";

function scope(role: string) {
  return { organizationId: "org_123", role, userId: "user_123" };
}

describe("eraseCandidateDataAction", () => {
  beforeEach(() => {
    erasureMock.eraseCandidateSessionData.mockReset();
    scopeMock.getCompletedOrganizationScope.mockReset();
    revalidateMock.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses a recruiter — only owners and admins may erase", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("recruiter"));

    await expect(
      eraseCandidateDataAction({ candidateSessionId: "cs_1" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(erasureMock.eraseCandidateSessionData).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("viewer"));

    await expect(
      eraseCandidateDataAction({ candidateSessionId: "cs_1" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(erasureMock.eraseCandidateSessionData).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("lets an %s erase, in their own organization", async (role) => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope(role));
    erasureMock.eraseCandidateSessionData.mockResolvedValueOnce({
      erased: true,
      realtimeSessionId: "is_real",
    });

    await eraseCandidateDataAction({ candidateSessionId: "cs_1" });

    expect(erasureMock.eraseCandidateSessionData).toHaveBeenCalledWith({
      candidateSessionId: "cs_1",
      organizationId: "org_123",
      reason: "erasure_request",
    });
  });

  it("revalidates both detail URLs and the candidates list", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("owner"));
    erasureMock.eraseCandidateSessionData.mockResolvedValueOnce({
      erased: true,
      realtimeSessionId: "is_real",
    });

    await eraseCandidateDataAction({ candidateSessionId: "cs_1" });

    expect(revalidateMock.revalidatePath).toHaveBeenCalledWith("/interviews/cs_1");
    expect(revalidateMock.revalidatePath).toHaveBeenCalledWith("/interviews/is_real");
    expect(revalidateMock.revalidatePath).toHaveBeenCalledWith("/candidates");
  });

  it("revalidates nothing when there was nothing to erase", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("admin"));
    erasureMock.eraseCandidateSessionData.mockResolvedValueOnce({
      erased: false,
      reason: "not_found",
    });

    await eraseCandidateDataAction({ candidateSessionId: "cs_missing" });

    expect(revalidateMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("propagates a failed erasure so the recruiter is told, not reassured", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValueOnce(scope("owner"));
    erasureMock.eraseCandidateSessionData.mockRejectedValueOnce(
      new Error("realtime unavailable"),
    );

    await expect(
      eraseCandidateDataAction({ candidateSessionId: "cs_1" }),
    ).rejects.toThrow();
    expect(revalidateMock.revalidatePath).not.toHaveBeenCalled();
  });
});
