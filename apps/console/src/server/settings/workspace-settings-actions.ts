"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { canManageTeam } from "../../domain/organization-permissions";
import { coerceConsoleLocale } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { parseOrganizationSettings } from "./workspace-settings-data";

const allowedCompanySizes = new Set([
  "",
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
]);
const allowedVoices = new Set(["maya", "noah", "lea"]);

export async function updateWorkspaceSettingsAction(formData: FormData) {
  const scope = await getCompletedOrganizationScope();
  assertCanEditSettings(scope.role);

  const name = cleanText(formData.get("name"), 80);
  const hiringFocus = cleanOptionalText(formData.get("hiringFocus"), 80);
  const companySize = cleanOptionalText(formData.get("companySize"), 20);

  if (!name) {
    return;
  }

  await prisma.organization.update({
    data: {
      companySize: allowedCompanySizes.has(companySize ?? "")
        ? companySize || null
        : null,
      hiringFocus,
      name,
    },
    where: { id: scope.organizationId },
  });

  revalidateSettings();
}

export async function updateInterviewPreferencesAction(formData: FormData) {
  const scope = await getCompletedOrganizationScope();
  assertCanEditSettings(scope.role);

  const organization = await prisma.organization.findUniqueOrThrow({
    select: { settings: true },
    where: { id: scope.organizationId },
  });
  const current = parseOrganizationSettings(organization.settings);
  const requestedAllowAudio = readBooleanField(formData, "allowAudio");
  const requestedAllowForm = readBooleanField(formData, "allowForm");
  const allowAudio = requestedAllowAudio || !requestedAllowForm;
  const allowForm = requestedAllowForm;
  const interviewerVoice = cleanText(formData.get("interviewerVoice"), 24);

  const nextSettings = mergeSettings(organization.settings, {
    interview: {
      ...current.interview,
      allowAudio,
      allowForm,
      autoGenerateTranscript: readBooleanField(
        formData,
        "autoGenerateTranscript",
      ),
      defaultLanguage: coerceConsoleLocale(
        String(formData.get("defaultLanguage") ?? ""),
      ),
      interviewerVoice: allowedVoices.has(interviewerVoice)
        ? interviewerVoice
        : current.interview.interviewerVoice,
      requireRecordingConsent: readBooleanField(
        formData,
        "requireRecordingConsent",
      ),
      showReviewGuardrail: readBooleanField(formData, "showReviewGuardrail"),
    },
  });

  await prisma.organization.update({
    data: {
      defaultInterviewMode: allowAudio ? "Voice first" : "Form first",
      settings: nextSettings,
    },
    where: { id: scope.organizationId },
  });

  revalidateSettings();
}

export async function updateNotificationPreferencesAction(formData: FormData) {
  const scope = await getCompletedOrganizationScope();
  assertCanEditSettings(scope.role);

  const organization = await prisma.organization.findUniqueOrThrow({
    select: { settings: true },
    where: { id: scope.organizationId },
  });

  const nextSettings = mergeSettings(organization.settings, {
    notifications: {
      interviewCompleted: readBooleanField(formData, "interviewCompleted"),
      mentionsAndComments: readBooleanField(formData, "mentionsAndComments"),
      productUpdates: readBooleanField(formData, "productUpdates"),
      screensReadyForReview: readBooleanField(
        formData,
        "screensReadyForReview",
      ),
      weeklyDigest: readBooleanField(formData, "weeklyDigest"),
    },
  });

  await prisma.organization.update({
    data: { settings: nextSettings },
    where: { id: scope.organizationId },
  });

  revalidateSettings();
}

function assertCanEditSettings(role: OrganizationRole) {
  if (!canManageTeam(role)) {
    throw new Error("Only owners and admins can update workspace settings.");
  }
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
) {
  const text = cleanText(value, maxLength);

  return text ? text : null;
}

function readBooleanField(formData: FormData, name: string) {
  return formData.get(name) === "true";
}

function mergeSettings(
  current: Prisma.JsonValue,
  patch: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  const root =
    current && typeof current === "object" && !Array.isArray(current)
      ? ({ ...(current as Prisma.JsonObject) } as Prisma.InputJsonObject)
      : {};

  return {
    ...root,
    ...patch,
  };
}

function revalidateSettings() {
  revalidatePath("/");
  revalidatePath("/settings");
}
