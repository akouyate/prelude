import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "recruiter" as "owner" | "admin" | "recruiter" | "viewer",
}));
const generateDraftWithProvenance = vi.hoisted(() => vi.fn());
const refineQuestion = vi.hoisted(() => vi.fn());
const addQuestion = vi.hoisted(() => vi.fn());
const createGenerator = vi.hoisted(() =>
  vi.fn(() => ({
    addQuestion,
    generateDraftWithProvenance,
    modelName: "test-model",
    provider: "test",
    refineQuestion,
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
// Only the generator FACTORY is stubbed: the rationale builder these actions
// call lives in the same module, and these tests are pinning its actual copy.
vi.mock("./interview-draft-generation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./interview-draft-generation")>()),
  createInterviewDraftGeneratorFromEnv: createGenerator,
}));

const contentLanguages = vi.hoisted(() => ({
  interviewDefault: "en" as "en" | "fr",
  workspace: "en" as "en" | "fr",
}));

vi.mock("../organizations/organization-content-languages", () => ({
  loadOrganizationContentLanguages: vi.fn(async () => contentLanguages),
}));

import {
  addInterviewQuestionAction,
  generateInterviewDraftAction,
  refineInterviewQuestionAction,
} from "./interview-draft-generation-actions";

const input = {
  companyName: "HireCall",
  focus: ["role_skills" as const],
  responseModes: ["audio" as const],
  roleBrief:
    "Own a production service, collaborate across teams, and explain technical trade-offs clearly.",
  roleTitle: "Backend Engineer",
  seniority: "mid" as const,
};

const question = (id: string) => ({
  category: "experience" as const,
  durationSeconds: 75,
  expectedSignal: "Relevant role evidence",
  id,
  maxFollowups: 1,
  prompt: "Tell us about a recent project you owned end to end.",
  required: true,
  source: "agent" as const,
});

const draft = () => ({
  criteria: [],
  estimatedMinutes: 6,
  guardrails: [],
  questions: [question("q1"), question("q2")],
  rationale: "",
});

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "recruiter";
  contentLanguages.interviewDefault = "en";
  contentLanguages.workspace = "en";
  refineQuestion.mockResolvedValue(question("q1"));
  addQuestion.mockResolvedValue(question("q3"));
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

// Plan 2026-08-18, rule 1: both languages are resolved SERVER-side. The
// recruiter's builder selector is only a hint for the interview language; the
// workspace language is never client-supplied at all, because it governs a
// shared artifact.
describe("interview draft generation language resolution", () => {
  it("falls back to the workspace defaults when the builder sends no selection", async () => {
    contentLanguages.interviewDefault = "fr";
    contentLanguages.workspace = "fr";

    await generateInterviewDraftAction(input);

    expect(generateDraftWithProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        interviewLanguage: "fr",
        workspaceLanguage: "fr",
      }),
    );
  });

  it("prefers the recruiter's builder selection for the interview language", async () => {
    contentLanguages.interviewDefault = "en";
    contentLanguages.workspace = "en";

    await generateInterviewDraftAction({ ...input, interviewLanguage: "fr" });

    expect(generateDraftWithProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        interviewLanguage: "fr",
        workspaceLanguage: "en",
      }),
    );
  });

  it("never lets the client choose the workspace language", async () => {
    contentLanguages.interviewDefault = "en";
    contentLanguages.workspace = "fr";

    await generateInterviewDraftAction({
      ...input,
      workspaceLanguage: "en",
    } as never);

    expect(generateDraftWithProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceLanguage: "fr" }),
    );
  });

  it("drops a builder selection outside the catalogue", async () => {
    contentLanguages.interviewDefault = "fr";

    await generateInterviewDraftAction({
      ...input,
      interviewLanguage: "de",
    } as never);

    expect(generateDraftWithProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ interviewLanguage: "fr" }),
    );
  });
});

// The rationale is recruiter-bound copy (plan 2026-08-18, rule 1), and these two
// actions used to hardcode English literals — user-visible, because the builder
// renders `draft.rationale` verbatim in the agent bubble and persists it on the
// next save. Both now follow the resolved WORKSPACE language.
describe("single-question edit rationale language", () => {
  const refineInput = () => ({
    ...input,
    action: "sharper" as const,
    draft: draft(),
    questionId: "q1",
  });
  const addInput = () => ({ ...input, draft: draft(), topic: "mobility" });

  it("writes the refine rationale in French for a French workspace", async () => {
    contentLanguages.workspace = "fr";

    const result = await refineInterviewQuestionAction(refineInput());

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.draft.rationale).toBe(
      "HireCall a affiné une question, tout en gardant cet entretien de préqualification centré sur 2 questions.",
    );
  });

  it("writes the refine rationale in English for an English workspace", async () => {
    const result = await refineInterviewQuestionAction(refineInput());

    expect(result.ok && result.draft.rationale).toBe(
      "HireCall refined one question while keeping this role screen focused on 2 first-screening questions.",
    );
  });

  it("writes the add-question rationale in French for a French workspace", async () => {
    contentLanguages.workspace = "fr";

    const result = await addInterviewQuestionAction(addInput());

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.draft.rationale).toBe(
      "HireCall a préparé 3 questions ciblées pour cet entretien de préqualification.",
    );
  });

  it("writes the add-question rationale in English for an English workspace", async () => {
    const result = await addInterviewQuestionAction(addInput());

    expect(result.ok && result.draft.rationale).toBe(
      "HireCall prepared 3 focused questions for this first-screening role screen.",
    );
  });

  it("follows the workspace language even when the interview language differs", async () => {
    // The rationale never rides on the interview language: a French workspace
    // running an English interview still reads its own builder copy in French.
    contentLanguages.interviewDefault = "en";
    contentLanguages.workspace = "fr";

    const result = await addInterviewQuestionAction(addInput());

    expect(result.ok && result.draft.rationale).toContain("HireCall a préparé");
    expect(addQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ interviewLanguage: "en", workspaceLanguage: "fr" }),
    );
  });
});
