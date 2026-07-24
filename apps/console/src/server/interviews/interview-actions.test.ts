import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  unconfiguredBilling,
  workspacePlanCatalog,
  type WorkspaceBilling,
} from "@prelude/billing";

const state = vi.hoisted(() => ({
  role: "recruiter" as "admin" | "owner" | "recruiter" | "viewer",
}));
const tx = vi.hoisted(() => ({
  interview: {
    count: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  job: { count: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
    callback(tx),
  ),
}));
const getWorkspaceBilling = vi.hoisted(() => vi.fn());

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/billing/server", () => ({ getWorkspaceBilling }));
vi.mock("../organizations/organization-scope", () => ({
  getCompletedOrganizationScope: vi.fn(async () => ({
    organizationId: "org_1",
    role: state.role,
    userId: "user_1",
  })),
}));
vi.mock("../users/user-locale", () => ({
  getAuthenticatedUserLocale: vi.fn(async () => "en"),
}));
vi.mock("../../libs/i18n-server", () => ({
  getServerT: () => (key: string) => key,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateInterviewPublicationStatusAction } from "./interview-actions";

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "recruiter";
  tx.interview.findFirst.mockResolvedValue({
    id: "interview_1",
    jobId: "job_1",
  });
  tx.interview.count.mockResolvedValue(0);
  tx.interview.update.mockResolvedValue({ id: "interview_1" });
  tx.job.count.mockResolvedValue(0);
  getWorkspaceBilling.mockResolvedValue(unconfiguredBilling(new Date()));
});

describe("updateInterviewPublicationStatusAction", () => {
  it("rejects viewers before billing or persistence", async () => {
    state.role = "viewer";

    await expect(
      updateInterviewPublicationStatusAction(
        publicationForm("interview_1", "published"),
      ),
    ).rejects.toThrow("roleManagement.forbidden");

    expect(getWorkspaceBilling).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the active-role quota when resuming a paused interview", async () => {
    getWorkspaceBilling.mockResolvedValue(paidBilling());
    tx.job.count.mockResolvedValue(
      workspacePlanCatalog.v1_workspace.activeRoleLimit,
    );

    await expect(
      updateInterviewPublicationStatusAction(
        publicationForm("interview_1", "published"),
      ),
    ).rejects.toThrow("roleManagement.publishedRoleLimitReached");

    expect(tx.interview.update).not.toHaveBeenCalled();
  });

  it("allows a pause without consulting billing", async () => {
    await updateInterviewPublicationStatusAction(
      publicationForm("interview_1", "paused"),
    );

    expect(getWorkspaceBilling).not.toHaveBeenCalled();
    expect(tx.interview.update).toHaveBeenCalledWith({
      data: { status: "paused" },
      where: { id: "interview_1" },
    });
  });

  it("resumes without another slot when the same role is already published", async () => {
    getWorkspaceBilling.mockResolvedValue(paidBilling());
    tx.interview.count.mockResolvedValue(1);

    await updateInterviewPublicationStatusAction(
      publicationForm("interview_1", "published"),
    );

    expect(tx.job.count).not.toHaveBeenCalled();
    expect(tx.interview.update).toHaveBeenCalledOnce();
  });
});

function publicationForm(interviewId: string, nextStatus: string) {
  const form = new FormData();
  form.set("interviewId", interviewId);
  form.set("nextStatus", nextStatus);
  return form;
}

function paidBilling(): WorkspaceBilling {
  return {
    accessAllowed: true,
    entitlements: workspacePlanCatalog.v1_workspace,
    isFreeTrial: false,
    periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    planId: "plan_1",
    planKey: "v1_workspace",
    planName: "V1 Workspace",
    planSlug: "v1-workspace",
    sourceUpdatedAt: new Date(),
    state: "active",
    subscriptionId: "sub_1",
    subscriptionItemId: "item_1",
    subscriptionItemStatus: "active",
    subscriptionStatus: "active",
  };
}
