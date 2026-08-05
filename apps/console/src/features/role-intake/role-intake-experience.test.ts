import { describe, expect, it } from "vitest";

import {
  classifyRoleIntakeFailure,
  getRoleIntakeProgress,
  getRoleIntakeReviewIssues,
  resolveRoleIntakeContentType,
  validateRoleIntakeSelection,
} from "./role-intake-experience";

describe("role intake experience", () => {
  it("uses honest, determinate stages without inventing a percentage", () => {
    expect(getRoleIntakeProgress("uploading")).toEqual({
      activeStep: "source",
      completedSteps: [],
    });
    expect(getRoleIntakeProgress("queued")).toEqual({
      activeStep: "processing",
      completedSteps: ["source"],
    });
    expect(getRoleIntakeProgress("processing")).toEqual({
      activeStep: "processing",
      completedSteps: ["source"],
    });
    expect(getRoleIntakeProgress("ready_for_review")).toEqual({
      activeStep: "review",
      completedSteps: ["source", "processing"],
    });
  });

  it("routes no-text documents to manual entry and duplicates to resume", () => {
    expect(classifyRoleIntakeFailure("no_usable_text", null)).toBe("manual");
    expect(classifyRoleIntakeFailure("document_corrupt", null)).toBe("replace");
    expect(classifyRoleIntakeFailure("duplicate_import", "intake_existing")).toBe("resume");
    expect(classifyRoleIntakeFailure("scanner_unavailable", null)).toBe("retry");
    // A posting the public index cannot reach never becomes retryable.
    expect(classifyRoleIntakeFailure("indexed_search_not_found", null)).toBe(
      "unreachable",
    );
  });

  it("validates client file metadata before preparing a private upload", () => {
    expect(resolveRoleIntakeContentType("ROLE.PDF", "")).toBe(
      "application/pdf",
    );
    expect(resolveRoleIntakeContentType("role.docx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(resolveRoleIntakeContentType("role.txt", "")).toBeNull();
    expect(
      validateRoleIntakeSelection({
        byteSize: 0,
        contentType: "application/pdf",
        fileName: "role.pdf",
      }),
    ).toBe("empty");
    expect(
      validateRoleIntakeSelection({
        byteSize: 11 * 1024 * 1024,
        contentType: "application/pdf",
        fileName: "role.pdf",
      }),
    ).toBe("too_large");
    expect(
      validateRoleIntakeSelection({
        byteSize: 42,
        contentType: "text/plain",
        fileName: "role.txt",
      }),
    ).toBe("unsupported");
    expect(
      validateRoleIntakeSelection({
        byteSize: 42,
        contentType: "application/pdf",
        fileName: "role.pdf",
      }),
    ).toBeNull();
  });

  it("identifies missing required review fields without blocking an optional location", () => {
    expect(
      getRoleIntakeReviewIssues({
        description: "",
        location: "",
        title: "",
      }),
    ).toEqual(["title", "description"]);
    expect(
      getRoleIntakeReviewIssues({
        description: "Own customer onboarding and retention.",
        location: "",
        title: "Customer Success Manager",
      }),
    ).toEqual([]);
  });
});
