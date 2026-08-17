import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLE_OPTIONS,
  canAssignRole,
  canChangeMemberRole,
  canInviteMember,
  canManageRoles,
  canManageMember,
  canManageTeam,
  canPurchaseCredits,
  canRemoveMember,
} from "./organization-permissions";

describe("credit purchase permission", () => {
  it("lets only owner and admin spend the organization's money", () => {
    expect(canPurchaseCredits("owner")).toBe(true);
    expect(canPurchaseCredits("admin")).toBe(true);
    // A recruiter runs interviews; committing the company to €2,790 is not part
    // of that job, and neither is a viewer's.
    expect(canPurchaseCredits("recruiter")).toBe(false);
    expect(canPurchaseCredits("viewer")).toBe(false);
  });

  it("uses the same manager set as the rest of the workspace, not a parallel one", () => {
    // A second, drifting definition of "manager" is how permission bugs are born.
    for (const role of ["owner", "admin", "recruiter", "viewer"] as const) {
      expect(canPurchaseCredits(role)).toBe(canManageTeam(role));
    }
  });
});

describe("organization permissions (Standard matrix)", () => {
  it("lets only owner and admin manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("recruiter")).toBe(false);
    expect(canManageTeam("viewer")).toBe(false);
    expect(canInviteMember("admin")).toBe(true);
    expect(canInviteMember("recruiter")).toBe(false);
  });

  it("lets recruiters manage roles while keeping viewers read-only", () => {
    expect(canManageRoles("owner")).toBe(true);
    expect(canManageRoles("admin")).toBe(true);
    expect(canManageRoles("recruiter")).toBe(true);
    expect(canManageRoles("viewer")).toBe(false);
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
