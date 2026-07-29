import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "recruiter" as "owner" | "admin" | "recruiter" | "viewer",
}));
const generateDraftWithProvenance = vi.hoisted(() => vi.fn());
const createGenerator = vi.hoisted(() =>
  vi.fn(() => ({
    generateDraftWithProvenance,
  })),
);

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
vi.mock("./interview-draft-generation", () => ({
  createInterviewDraftGeneratorFromEnv: createGenerator,
}));

import { generateInterviewDraftAction } from "./interview-draft-generation-actions";

const input = {
  companyName: "HireCall",
  focus: ["role_skills" as const],
  responseModes: ["audio" as const],
  roleBrief:
    "Own a production service, collaborate across teams, and explain technical trade-offs clearly.",
  roleTitle: "Backend Engineer",
  seniority: "mid" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "recruiter";
  generateDraftWithProvenance.mockResolvedValue({
    draft: { questions: [] },
    modelName: "test-model",
    provider: "test",
  });
});

describe("interview draft generation authorization", () => {
  it("rejects viewers before allocating an AI generator", async () => {
    state.role = "viewer";

    await expect(generateInterviewDraftAction(input)).resolves.toEqual({
      error: "roleManagement.forbidden",
      ok: false,
    });
    expect(createGenerator).not.toHaveBeenCalled();
    expect(generateDraftWithProvenance).not.toHaveBeenCalled();
  });

  it("lets a recruiter generate a role draft", async () => {
    await expect(generateInterviewDraftAction(input)).resolves.toMatchObject({
      ok: true,
      provider: "test",
    });
    expect(generateDraftWithProvenance).toHaveBeenCalledOnce();
  });
});
