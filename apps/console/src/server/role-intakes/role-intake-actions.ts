"use server";

import type { ImportedRoleDraft } from "@prelude/contracts";
import { revalidatePath } from "next/cache";

import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  consumeRoleIntake,
  createRoleIntakeUrl,
  createRoleIntakeUpload,
  finalizeRoleIntakeUpload,
  getRoleIntakeSummary,
  saveRoleIntakeReview,
} from "./role-intake-service";

export async function createRoleIntakeUploadAction(input: {
  byteSize: number;
  contentType: string;
  fileName: string;
}) {
  const scope = await getCompletedOrganizationScope();
  return createRoleIntakeUpload(scope, input);
}

export async function createRoleIntakeUrlAction(source: string) {
  const scope = await getCompletedOrganizationScope();
  return createRoleIntakeUrl(scope, source);
}

export async function finalizeRoleIntakeUploadAction(intakeId: string) {
  const scope = await getCompletedOrganizationScope();
  return finalizeRoleIntakeUpload(scope, intakeId);
}

export async function getRoleIntakeSummaryAction(intakeId: string) {
  const scope = await getCompletedOrganizationScope();
  return getRoleIntakeSummary(scope, intakeId);
}

export async function saveRoleIntakeReviewAction(input: {
  expectedReviewVersion: number;
  intakeId: string;
  reviewedDraft: ImportedRoleDraft;
}) {
  const scope = await getCompletedOrganizationScope();
  return saveRoleIntakeReview(scope, input);
}

export async function consumeRoleIntakeAction(intakeId: string) {
  const scope = await getCompletedOrganizationScope();
  const result = await consumeRoleIntake(scope, intakeId);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/roles");
    revalidatePath("/roles/new");
  }
  return result;
}
