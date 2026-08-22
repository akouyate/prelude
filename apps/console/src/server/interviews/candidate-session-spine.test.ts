import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateSession: { findMany: vi.fn() },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("server-only", () => ({}));

import { listCandidateSessionSpinesForOrganization } from "./candidate-session-spine";

describe("listCandidateSessionSpinesForOrganization", () => {
  beforeEach(() => {
    prismaMock.candidateSession.findMany.mockReset();
    prismaMock.candidateSession.findMany.mockResolvedValue([]);
  });

  it("uses a cursor and a bounded take instead of rematerialising prior rows", async () => {
    await listCandidateSessionSpinesForOrganization({
      cursor: "cs_page_boundary",
      organizationId: "org_123",
      take: 26,
    });

    expect(prismaMock.candidateSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "cs_page_boundary" },
        skip: 1,
        take: 26,
        where: { organizationId: "org_123" },
      }),
    );
  });
});
