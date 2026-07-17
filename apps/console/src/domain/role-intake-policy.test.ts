import { describe, expect, it } from "vitest";

import {
  ROLE_INTAKE_MAX_BYTES,
  canManageRoleIntake,
  canTransitionRoleIntake,
  validateRoleIntakeFile,
} from "./role-intake-policy";

describe("role intake policy", () => {
  it("allows the workspace roles that may create a role draft", () => {
    expect(canManageRoleIntake("owner")).toBe(true);
    expect(canManageRoleIntake("admin")).toBe(true);
    expect(canManageRoleIntake("recruiter")).toBe(true);
    expect(canManageRoleIntake("viewer")).toBe(false);
  });

  it("keeps lifecycle transitions explicit", () => {
    expect(canTransitionRoleIntake("uploading", "quarantined")).toBe(true);
    expect(canTransitionRoleIntake("ready_for_review", "consumed")).toBe(true);
    expect(canTransitionRoleIntake("consumed", "queued")).toBe(false);
  });

  it("rejects unsupported and oversized uploads before a URL is signed", () => {
    expect(
      validateRoleIntakeFile({
        byteSize: ROLE_INTAKE_MAX_BYTES + 1,
        contentType: "application/pdf",
        fileName: "brief.pdf",
      }).ok,
    ).toBe(false);
    expect(
      validateRoleIntakeFile({
        byteSize: 42,
        contentType: "text/plain",
        fileName: "brief.txt",
      }).ok,
    ).toBe(false);
  });
});
