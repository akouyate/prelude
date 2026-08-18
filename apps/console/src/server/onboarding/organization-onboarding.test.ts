import { beforeEach, describe, expect, it, vi } from "vitest";

// Item 1 of the Clerk hardening brief: in a real Clerk workspace, Clerk makes
// an org creator `org:admin` (never `owner`) — `mapClerkOrganizationRole`
// maps that to "admin". If onboarding derives the creator's membership role
// from that mapped Clerk role, NOBODY is ever `owner`: billing management and
// ownership transfer become permanently unreachable. These tests pin that the
// user completing onboarding for a brand-new organization becomes `owner`
// regardless of what Clerk's coarse orgRole says, and that a second
// onboarding pass never demotes an already-assigned owner.

const tx = vi.hoisted(() => ({
  user: {
    upsert: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  organizationMembership: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
  },
  jobSourceConnection: {
    upsert: vi.fn(),
  },
  job: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("server-only", () => ({}));

const authMock = vi.hoisted(() => ({ getConsoleAuthIdentity: vi.fn() }));
vi.mock("../auth/console-auth-provider", () => authMock);

const billingMock = vi.hoisted(() => ({
  initializeFreeWorkspaceBilling: vi.fn(async () => {}),
  syncClerkOrganizationBilling: vi.fn(async () => {}),
}));
vi.mock("@prelude/billing/server", () => billingMock);

import { completeOrganizationOnboarding } from "./organization-onboarding";

const baseInput = {
  companyName: "Acme Talent",
  companySize: "11-50",
  hiringFocus: "Customer-facing",
  interviewMode: "voice",
  jobSource: "manual" as const,
  manualJobTitle: "Customer Success Manager",
  onboardingRole: "Founder",
};

beforeEach(() => {
  vi.clearAllMocks();

  // A Clerk-shaped identity: the org creator, whose Clerk orgRole is the
  // coarse "org:admin" mapped down to "admin" — never "owner". This is the
  // exact shape console-auth-provider.ts produces for a real Clerk workspace.
  authMock.getConsoleAuthIdentity.mockResolvedValue({
    ok: true,
    value: {
      clerkOrganizationId: "org_clerk_1",
      role: "admin",
      source: "clerk",
      userId: "user_clerk_1",
      userEmail: "founder@example.com",
      userName: "Founder Name",
    },
  });

  tx.user.upsert.mockResolvedValue({ id: "user_db_1" });
  tx.job.findFirst.mockResolvedValue(null);
  tx.job.create.mockResolvedValue({ id: "job_db_1" });
  tx.jobSourceConnection.upsert.mockResolvedValue({});
});

describe("completeOrganizationOnboarding — ownership", () => {
  it("makes the creator of a brand-new organization the owner, even though Clerk reports org:admin", async () => {
    // No organization exists yet for this Clerk org — this call is the one
    // that creates it.
    tx.organization.findUnique.mockResolvedValue(null);
    tx.organization.create.mockResolvedValue({ id: "org_db_1" });
    tx.organization.upsert.mockResolvedValue({ id: "org_db_1" });
    // No membership exists yet either — this is the organization's first.
    tx.organizationMembership.findUnique.mockResolvedValue(null);
    tx.organizationMembership.count.mockResolvedValue(0);
    tx.organizationMembership.create.mockResolvedValue({});
    tx.organizationMembership.upsert.mockResolvedValue({});

    const result = await completeOrganizationOnboarding(baseInput);

    expect(result.ok).toBe(true);

    const membershipWrite =
      tx.organizationMembership.create.mock.calls[0]?.[0] ??
      tx.organizationMembership.upsert.mock.calls[0]?.[0];
    expect(membershipWrite).toBeDefined();

    const writtenRole =
      membershipWrite.data?.role ?? membershipWrite.create?.role;
    expect(writtenRole).toBe("owner");
  });

  it("does not demote an existing owner on a second onboarding completion pass", async () => {
    // The organization already exists (first pass already ran) ...
    tx.organization.findUnique.mockResolvedValue({
      id: "org_db_1",
      onboardingCompletedAt: new Date("2026-08-01T00:00:00.000Z"),
      onboardingState: {},
    });
    tx.organization.update.mockResolvedValue({ id: "org_db_1" });
    tx.organization.upsert.mockResolvedValue({ id: "org_db_1" });
    // ... and so does the creator's membership, already "owner".
    tx.organizationMembership.findUnique.mockResolvedValue({
      id: "membership_db_1",
      organizationId: "org_db_1",
      userId: "user_db_1",
      role: "owner",
      onboardingRole: "Founder",
      status: "active",
    });
    tx.organizationMembership.count.mockResolvedValue(1);
    tx.organizationMembership.update.mockResolvedValue({});
    tx.organizationMembership.upsert.mockResolvedValue({});

    const result = await completeOrganizationOnboarding(baseInput);

    expect(result.ok).toBe(true);

    const membershipWrite =
      tx.organizationMembership.update.mock.calls[0]?.[0] ??
      tx.organizationMembership.upsert.mock.calls[0]?.[0];
    expect(membershipWrite).toBeDefined();

    // Only the "update" clause matters here: the role must either be absent
    // (untouched) or explicitly "owner" — never overwritten with the
    // Clerk-derived "admin" the auth identity carries this call.
    const updateClause = membershipWrite.data ?? membershipWrite.update;
    if (updateClause && "role" in updateClause) {
      expect(updateClause.role).toBe("owner");
    }
  });

  it("does NOT hand ownership to an invited member just because they happen to be provisioned first", async () => {
    // Reachable through supported UI: someone creates the org via Clerk's
    // <CreateOrganization> and abandons before completing onboarding (org
    // exists in Clerk, no DB row yet) -> they invite a colleague -> the
    // invitee's membership webhook 409-retries against
    // organization_not_found until Svix's retry schedule exhausts -> the
    // invitee is bounced to onboarding, which creates the DB row. Count is 0
    // at that point too, but this person is NOT the creator — their Clerk
    // orgRole is org:member ("recruiter"), never org:admin. "First to be
    // provisioned" must not be conflated with "the creator": only Clerk's
    // own signal that this identity IS the creator (orgRole org:admin,
    // i.e. authContext.role === "admin") may grant owner.
    tx.organization.findUnique.mockResolvedValue(null);
    tx.organization.create.mockResolvedValue({ id: "org_db_1" });
    tx.organization.upsert.mockResolvedValue({ id: "org_db_1" });
    tx.organizationMembership.findUnique.mockResolvedValue(null);
    tx.organizationMembership.count.mockResolvedValue(0);
    tx.organizationMembership.create.mockResolvedValue({});
    tx.organizationMembership.upsert.mockResolvedValue({});

    authMock.getConsoleAuthIdentity.mockResolvedValue({
      ok: true,
      value: {
        clerkOrganizationId: "org_clerk_1",
        // An invited member: Clerk's org:member maps to "recruiter", never
        // "admin" — that mapping is how the fix tells creator from invitee.
        role: "recruiter",
        source: "clerk",
        userId: "user_clerk_invitee",
        userEmail: "invitee@example.com",
        userName: "Invitee Name",
      },
    });

    const result = await completeOrganizationOnboarding(baseInput);

    expect(result.ok).toBe(true);

    const membershipWrite =
      tx.organizationMembership.create.mock.calls[0]?.[0] ??
      tx.organizationMembership.upsert.mock.calls[0]?.[0];
    expect(membershipWrite).toBeDefined();

    const writtenRole =
      membershipWrite.data?.role ?? membershipWrite.create?.role;
    expect(writtenRole).not.toBe("owner");
    expect(writtenRole).toBe("recruiter");
  });
});
