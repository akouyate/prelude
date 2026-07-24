"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getWorkspaceBilling } from "@prelude/billing/server";
import { prisma } from "@prelude/db";

import { canManageRoles } from "../../domain/organization-permissions";
import { getServerT } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { getAuthenticatedUserLocale } from "../users/user-locale";
import {
  evaluateRolePublicationAdmission,
  runSerializableTransaction,
} from "./role-publication-admission";

const allowedPublicationStatuses = new Set(["paused", "published"]);

export async function updateInterviewPublicationStatusAction(
  formData: FormData,
) {
  const interviewId = String(formData.get("interviewId") ?? "").trim();
  const nextStatus = String(formData.get("nextStatus") ?? "").trim();

  if (!interviewId || !allowedPublicationStatuses.has(nextStatus)) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
  if (!canManageRoles(scope.role)) {
    throw new Error(t("roleManagement.forbidden"));
  }

  const billing =
    nextStatus === "published"
      ? await getWorkspaceBilling({
          organizationId: scope.organizationId,
        }).catch(() => null)
      : null;
  if (nextStatus === "published" && !billing) {
    throw new Error(t("roleManagement.billingUnavailable"));
  }

  const result = await runSerializableTransaction(() =>
    prisma.$transaction(
      async (tx) => {
        const interview = await tx.interview.findFirst({
          select: { id: true, jobId: true },
          where: {
            id: interviewId,
            organizationId: scope.organizationId,
          },
        });
        if (!interview) {
          return { kind: "not_found" as const };
        }

        if (nextStatus === "published" && billing) {
          const admission = await evaluateRolePublicationAdmission(tx, {
            billing,
            jobId: interview.jobId,
            organizationId: scope.organizationId,
          });
          if (!admission.allowed) {
            return { ...admission, kind: "billing_error" as const };
          }
        }

        await tx.interview.update({
          data: { status: nextStatus },
          where: { id: interview.id },
        });
        return { kind: "updated" as const };
      },
      { isolationLevel: "Serializable" },
    ),
  );

  if (result.kind === "not_found") {
    throw new Error("Interview not found.");
  }
  if (result.kind === "billing_error") {
    throw new Error(
      t(
        result.code === "published_role_limit_reached"
          ? "roleManagement.publishedRoleLimitReached"
          : "roleManagement.billingUnavailable",
      ),
    );
  }

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${interviewId}`);
  revalidatePath(`/interviews/${interviewId}`);
  redirect(`/roles/${interviewId}`);
}
