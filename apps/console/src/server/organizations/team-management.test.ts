import { describe, expect, it, vi } from "vitest";

// `team-management` now pulls in `../../libs/i18n-server` to localize its
// TeamResult errors, which carries the `server-only` import guard — stub it
// like i18n-server.test.ts does so this suite can run under plain Node/vitest.
vi.mock("server-only", () => ({}));

import {
  changeTeamMemberRole,
  inviteTeamMember,
  removeTeamMember,
  revokeTeamInvitation,
  type OrganizationDirectory,
  type TeamActor,
} from "./team-management";

function actor(overrides: Partial<TeamActor> = {}): TeamActor {
  return {
    organizationId: "org_1",
    clerkOrganizationId: "org_clerk_1",
    role: "owner",
    userId: "user_owner",
    locale: "en",
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

// Every TeamResult error is recruiter-facing (toasted or rendered inline by
// InviteTeammatePanel / TeamMemberRow / PendingInvitationRow in
// workspace-settings.tsx) and now resolves through getServerT against the
// real /public/locales catalogs, keyed by actor.locale. These assert the
// actual French vs. English text — not just that a key was picked — for the
// mock-mode guard and a representative permission refusal on each action.
describe("localized errors", () => {
  it("mock mode: an English-locale actor gets the English explanation", async () => {
    const dir = directory();
    const result = await inviteTeamMember(
      dir,
      actor({ clerkOrganizationId: null, locale: "en" }),
      { email: "x@y.com", role: "recruiter" },
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Inviting and managing teammates needs a real workspace, which is not available in local mock mode.",
    });
  });

  it("mock mode: a French-locale actor gets the French explanation", async () => {
    const dir = directory();
    const result = await inviteTeamMember(
      dir,
      actor({ clerkOrganizationId: null, locale: "fr" }),
      { email: "x@y.com", role: "recruiter" },
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Inviter et gérer des collaborateurs nécessite un espace de travail réel, non disponible en mode simulation local.",
    });
  });

  it("invite permission refusal: English vs. French", async () => {
    const dir = directory();

    const en = await inviteTeamMember(dir, actor({ role: "recruiter", locale: "en" }), {
      email: "x@y.com",
      role: "viewer",
    });
    expect(en).toEqual({
      ok: false,
      error: "You do not have permission to invite teammates.",
    });

    const fr = await inviteTeamMember(dir, actor({ role: "recruiter", locale: "fr" }), {
      email: "x@y.com",
      role: "viewer",
    });
    expect(fr).toEqual({
      ok: false,
      error: "Vous n'avez pas la permission d'inviter des collaborateurs.",
    });
  });

  it("assign-role refusal is localized", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor({ role: "admin", locale: "fr" }), {
      email: "x@y.com",
      role: "owner",
    });

    expect(result).toEqual({
      ok: false,
      error: "Vous ne pouvez pas attribuer ce rôle.",
    });
  });

  it("invalid email is localized", async () => {
    const dir = directory();
    const result = await inviteTeamMember(dir, actor({ locale: "fr" }), {
      email: "not-an-email",
      role: "recruiter",
    });

    expect(result).toEqual({
      ok: false,
      error: "Saisissez une adresse e-mail valide.",
    });
  });

  it("revoke permission refusal is localized", async () => {
    const dir = directory();
    const result = await revokeTeamInvitation(
      dir,
      actor({ role: "recruiter", locale: "fr" }),
      { invitationId: "inv_1" },
    );

    expect(result).toEqual({
      ok: false,
      error: "Vous n'avez pas la permission de révoquer des invitations.",
    });
  });

  it("cannot-change-own-role refusal is localized", async () => {
    const dir = directory();
    const result = await changeTeamMemberRole(
      dir,
      actor({ userId: "user_self", locale: "fr" }),
      { userId: "user_self", newRole: "viewer" },
    );

    expect(result).toEqual({
      ok: false,
      error: "Vous ne pouvez pas modifier votre propre rôle.",
    });
  });

  it("member-not-found is localized", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => null) });
    const result = await changeTeamMemberRole(dir, actor({ locale: "fr" }), {
      userId: "user_ghost",
      newRole: "viewer",
    });

    expect(result).toEqual({
      ok: false,
      error: "Ce collaborateur ne fait plus partie de cet espace de travail.",
    });
  });

  it("change-role permission refusal is localized", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "owner" as const) });
    const result = await changeTeamMemberRole(
      dir,
      actor({ role: "admin", locale: "fr" }),
      { userId: "user_owner2", newRole: "admin" },
    );

    expect(result).toEqual({
      ok: false,
      error: "Vous n'avez pas la permission de modifier le rôle de ce collaborateur.",
    });
  });

  it("cannot-remove-self refusal is localized", async () => {
    const dir = directory();
    const result = await removeTeamMember(
      dir,
      actor({ userId: "user_self", locale: "fr" }),
      { userId: "user_self" },
    );

    expect(result).toEqual({
      ok: false,
      error: "Vous ne pouvez pas vous retirer vous-même de cet espace de travail ici.",
    });
  });

  it("remove permission refusal is localized", async () => {
    const dir = directory({ getMemberRole: vi.fn(async () => "owner" as const) });
    const result = await removeTeamMember(dir, actor({ role: "admin", locale: "fr" }), {
      userId: "user_owner2",
    });

    expect(result).toEqual({
      ok: false,
      error: "Vous n'avez pas la permission de retirer ce collaborateur.",
    });
  });
});
