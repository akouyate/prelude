"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@prelude/db";

import { getCompletedOrganizationScope } from "../organizations/organization-scope";

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
  await prisma.interview.updateMany({
    data: { status: nextStatus },
    where: {
      id: interviewId,
      organizationId: scope.organizationId,
    },
  });

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${interviewId}`);
  revalidatePath(`/interviews/${interviewId}`);
  redirect(`/roles/${interviewId}`);
}
