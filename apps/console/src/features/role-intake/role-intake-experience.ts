import type {
  RoleIntakeStatus,
} from "@prelude/contracts";

import { ROLE_INTAKE_MAX_BYTES } from "../../domain/role-intake-policy";

export type RoleIntakeProgressStep = "source" | "processing" | "review";
export type RoleIntakeFailureAction = "manual" | "replace" | "resume" | "retry";
export type RoleIntakeFileIssue = "empty" | "too_large" | "unsupported";
export type RoleIntakeReviewField = "title" | "description";
export type RoleIntakeReviewDraft = {
  description: string;
  location: string;
  title: string;
};

const completedSourceStatuses = new Set<RoleIntakeStatus>([
  "quarantined",
  "queued",
  "processing",
  "ready_for_review",
  "consumed",
]);

export function getRoleIntakeProgress(
  status: RoleIntakeStatus,
): {
  activeStep: RoleIntakeProgressStep;
  completedSteps: RoleIntakeProgressStep[];
} {
  if (status === "ready_for_review" || status === "consumed") {
    return {
      activeStep: "review",
      completedSteps: ["source", "processing"],
    };
  }

  if (completedSourceStatuses.has(status)) {
    return {
      activeStep: "processing",
      completedSteps: ["source"],
    };
  }

  return { activeStep: "source", completedSteps: [] };
}

export function classifyRoleIntakeFailure(
  failureCode: string | null,
  duplicateOfIntakeId: string | null,
): RoleIntakeFailureAction {
  if (duplicateOfIntakeId) {
    return "resume";
  }
  if (failureCode === "no_usable_text") {
    return "manual";
  }
  if (
    failureCode === "document_corrupt" ||
    failureCode === "docx_unsupported_structure" ||
    failureCode === "unsupported_document" ||
    failureCode === "upload_metadata_invalid" ||
    failureCode === "malware_detected"
  ) {
    return "replace";
  }
  return "retry";
}

export function validateRoleIntakeSelection(input: {
  byteSize: number;
  contentType: string;
  fileName: string;
}): RoleIntakeFileIssue | null {
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return "empty";
  }
  if (input.byteSize > ROLE_INTAKE_MAX_BYTES) {
    return "too_large";
  }
  if (
    input.contentType !== "application/pdf" &&
    input.contentType !==
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "unsupported";
  }
  return null;
}

export function resolveRoleIntakeContentType(
  fileName: string,
  declaredType: string,
): string | null {
  const normalizedType = declaredType.trim().toLowerCase();
  if (
    normalizedType === "application/pdf" ||
    normalizedType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return normalizedType;
  }

  const normalizedName = fileName.trim().toLowerCase();
  if (normalizedName.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (normalizedName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export function getRoleIntakeReviewIssues(
  review: RoleIntakeReviewDraft,
): RoleIntakeReviewField[] {
  const issues: RoleIntakeReviewField[] = [];
  if (!review.title.trim()) {
    issues.push("title");
  }
  if (!review.description.trim()) {
    issues.push("description");
  }
  return issues;
}
