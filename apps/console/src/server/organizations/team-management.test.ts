import { describe, expect, it, vi } from "vitest";

import {
  changeTeamMemberRole,
  inviteTeamMember,
  removeTeamMember,
  type OrganizationDirectory,
  type TeamActor,
} from "./team-management";

function actor(overrides: Partial<TeamActor> = {}): TeamActor {
  return {
    organizationId: "org_1",
    clerkOrganizationId: "org_clerk_1",
    role: "owner",
    userId: "user_owner",
    ...overrides,
  };
}

function directory(
  overrides: Partial<OrganizationDirectory> = {},
): OrganizationDirectory {
  return {
    inviteMember: vi.fn(async () => ({ id: "inv_1" })),
    listPendingInvitations: vi.fn(async () => []),
    revokeInvitation: vi.fn(async () => {}),
    getMemberRole: vi.fn(async () => "recruiter" as const),
    setMemberRole: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("inviteTeamMember", () => {
  it("invites when the actor may invite and assign the role, normalizing the email", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor(), {
      email: " Ada@Example.com ",
      role: "recruiter",
    });

    expect(result.ok).toBe(true);
    expect(dir.inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkOrganizationId: "org_clerk_1",
        email: "ada@example.com",
        role: "recruiter",
        inviterUserId: "user_owner",
      }),
    );
  });

  it("refuses a recruiter (no team management)", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor({ role: "recruiter" }), {
      email: "x@y.com",
      role: "viewer",
    });

    expect(result.ok).toBe(false);
    expect(dir.inviteMember).not.toHaveBeenCalled();
  });

  it("refuses an admin assigning the owner role", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor({ role: "admin" }), {
      email: "x@y.com",
      role: "owner",
    });

    expect(result.ok).toBe(false);
    expect(dir.inviteMember).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor(), {
      email: "not-an-email",
      role: "recruiter",
    });

    expect(result.ok).toBe(false);
    expect(dir.inviteMember).not.toHaveBeenCalled();
  });

  it("explains that local mock mode has no real workspace to invite into", async () => {
    const dir = directory();
    const result = await inviteTeamMember(
      dir,
      actor({ clerkOrganizationId: null }),
      { email: "x@y.com", role: "recruiter" },
    );

    expect(result.ok).toBe(false);
    expect(dir.inviteMember).not.toHaveBeenCalled();
  });
});

describe("changeTeamMemberRole", () => {
  it("lets an owner promote a recruiter to admin", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "recruiter" as const) });
    const result = await changeTeamMemberRole(dir, actor(), {
      userId: "user_target",
      newRole: "admin",
    });

    expect(result.ok).toBe(true);
    expect(dir.setMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_target", role: "admin" }),
    );
  });

  it("refuses an admin changing an owner's role", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "owner" as const) });
    const result = await changeTeamMemberRole(dir, actor({ role: "admin" }), {
      userId: "user_owner2",
      newRole: "admin",
    });

    expect(result.ok).toBe(false);
    expect(dir.setMemberRole).not.toHaveBeenCalled();
  });

  it("refuses changing your own role through team management", async () => {
    const dir = directory();
    const result = await changeTeamMemberRole(dir, actor({ userId: "user_self" }), {
      userId: "user_self",
      newRole: "viewer",
    });

    expect(result.ok).toBe(false);
    expect(dir.setMemberRole).not.toHaveBeenCalled();
  });
});

describe("removeTeamMember", () => {
  it("lets an owner remove an admin", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "admin" as const) });
    const result = await removeTeamMember(dir, actor(), { userId: "user_admin" });

    expect(result.ok).toBe(true);
    expect(dir.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_admin" }),
    );
  });

  it("refuses an admin removing an owner", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "owner" as const) });
    const result = await removeTeamMember(dir, actor({ role: "admin" }), {
      userId: "user_owner2",
    });

    expect(result.ok).toBe(false);
    expect(dir.removeMember).not.toHaveBeenCalled();
  });

  it("refuses removing yourself", async () => {
    const dir = directory();
    const result = await removeTeamMember(dir, actor({ userId: "user_self" }), {
      userId: "user_self",
    });

    expect(result.ok).toBe(false);
    expect(dir.removeMember).not.toHaveBeenCalled();
  });
});
