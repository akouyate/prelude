import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLE_OPTIONS,
  canAssignRole,
  canChangeMemberRole,
  canInviteMember,
  canManageMember,
  canManageTeam,
  canRemoveMember,
} from "./organization-permissions";

describe("organization permissions (Standard matrix)", () => {
  it("lets only owner and admin manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("recruiter")).toBe(false);
    expect(canManageTeam("viewer")).toBe(false);
    expect(canInviteMember("admin")).toBe(true);
    expect(canInviteMember("recruiter")).toBe(false);
  });

  it("forbids an admin from acting on an owner; an owner can act on anyone", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(true);
    expect(canManageMember("admin", "recruiter")).toBe(true);
    expect(canManageMember("owner", "owner")).toBe(true);
    expect(canRemoveMember("admin", "owner")).toBe(false);
    expect(canRemoveMember("owner", "admin")).toBe(true);
    // a non-manager can never act on anyone
    expect(canManageMember("recruiter", "viewer")).toBe(false);
  });

  it("lets only an owner grant the owner role (ownership transfer)", () => {
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(true);
    expect(canAssignRole("admin", "recruiter")).toBe(true);
    expect(canAssignRole("recruiter", "recruiter")).toBe(false);
  });

  it("combines target + new-role checks for a role change", () => {
    expect(canChangeMemberRole("admin", "recruiter", "admin")).toBe(true);
    expect(canChangeMemberRole("admin", "recruiter", "owner")).toBe(false);
    expect(canChangeMemberRole("admin", "owner", "admin")).toBe(false);
    expect(canChangeMemberRole("owner", "admin", "owner")).toBe(true);
  });

  it("offers assignable role options without owner (transfer is explicit)", () => {
    expect(ASSIGNABLE_ROLE_OPTIONS).toEqual(["admin", "recruiter", "viewer"]);
  });
});
