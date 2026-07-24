import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ROLE_INTAKE_MAX_BYTES,
  canManageRoleIntake,
  canTransitionRoleIntake,
  isRoleIntakeFeatureEnabled,
  parseRoleIntakePilotOrganizationIds,
  parseRoleIntakePilotStartedAt,
  validateRoleIntakeFile,
} from "./role-intake-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("uses the global flag during development and test, including without a pilot cohort", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ROLE_INTAKE_ENABLED", "1");
    vi.stubEnv("ROLE_INTAKE_PILOT_ORGANIZATION_IDS", "");

    expect(isRoleIntakeFeatureEnabled("org_a")).toBe(true);
  });

  it("fails closed in production unless the organization is in a valid pilot cohort", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROLE_INTAKE_ENABLED", "1");
    vi.stubEnv("ROLE_INTAKE_PILOT_ORGANIZATION_IDS", "org_a,org_b");

    expect(isRoleIntakeFeatureEnabled("org_a")).toBe(true);
    expect(isRoleIntakeFeatureEnabled("org_c")).toBe(false);
    expect(isRoleIntakeFeatureEnabled()).toBe(false);
  });

  it("rejects malformed, duplicate, and oversized production cohorts", () => {
    expect(parseRoleIntakePilotOrganizationIds("org_a,org_b")).toEqual([
      "org_a",
      "org_b",
    ]);
    expect(parseRoleIntakePilotOrganizationIds("org_a,org_a")).toEqual([]);
    expect(parseRoleIntakePilotOrganizationIds("org_a, ,org_b")).toEqual([]);
    expect(
      parseRoleIntakePilotOrganizationIds(
        "org_a,org_b,org_c,org_d,org_e,org_f",
      ),
    ).toEqual([]);
  });

  it("requires a valid ISO pilot start boundary", () => {
    expect(
      parseRoleIntakePilotStartedAt("2026-07-24T09:30:00.000Z"),
    ).toEqual(new Date("2026-07-24T09:30:00.000Z"));
    expect(parseRoleIntakePilotStartedAt("July 24")).toBeNull();
    expect(parseRoleIntakePilotStartedAt("")).toBeNull();
  });
});
