"use server";

import { revalidatePath } from "next/cache";
import {
  organizationCountrySchema,
  workspaceLanguageSchema,
} from "@prelude/contracts";
import { prisma, type Prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { canManageTeam } from "../../domain/organization-permissions";
import { coerceConsoleLocale, getServerT } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { getAuthenticatedUserLocale } from "../users/user-locale";
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

// The settings actions' standard action-state shape for a native
// `<form action=...>` bound via `useActionState` (matches
// `CandidateInvitationActionState` in candidate-invitation-actions.ts and the
// schedule-call-dialog action): `ok` tells the form whether the last submit
// landed, `error` is the message (already localized) to announce, or `null`
// when there is nothing to show. Shared by all three settings actions below —
// each renders it as a toast (plan 2026-08-18, Part 2) rather than reaching
// for its own shape.
export type SettingsActionState = {
  error: string | null;
  ok: boolean;
};

export async function updateWorkspaceSettingsAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const scope = await getCompletedOrganizationScope();

  // A non-manager (viewer/recruiter) submitting this form must fail
  // gracefully, not crash the page: QA T8 finding B.6 caught this action
  // propagating assertCanEditSettings's throw as an unhandled exception. The
  // check itself stays shared with the sibling settings actions (interview
  // preferences, notifications) — only this call site is taught to catch it
  // and answer with the section's standard error shape instead of throwing.
  try {
    assertCanEditSettings(scope.role);
  } catch {
    const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
    return { error: t("settings.workspace.forbidden"), ok: false };
  }

  const name = cleanText(formData.get("name"), 80);
  const hiringFocus = cleanOptionalText(formData.get("hiringFocus"), 80);
  const companySize = cleanOptionalText(formData.get("companySize"), 20);
  const country = cleanDeclaredCountry(formData.get("country"));

  if (!name) {
    return { error: null, ok: false };
  }

  // Plan 2026-08-18, rule 2: the workspace generated-content language rides
  // along with the workspace profile — same form, same owner/admin gate, no
  // second action — and lands in the settings JSON rather than a column.
  const organization = await prisma.organization.findUniqueOrThrow({
    select: { settings: true },
    where: { id: scope.organizationId },
  });
  const current = parseOrganizationSettings(organization.settings);

  await prisma.organization.update({
    data: {
      companySize: allowedCompanySizes.has(companySize ?? "")
        ? companySize || null
        : null,
      // Organization.country is a declared jurisdiction hint. This form is its
      // only reader/writer this phase; any PR adding another reader must name
      // this wall and justify that the reader is not fiscal and not currency
      // (plan 2026-08-17, rule 1).
      //
      // "reject ≠ clear": `country` is only spread in when cleanDeclaredCountry
      // returned something other than `undefined`. A schema failure on a
      // non-blank value can only come from a stale/tampered/non-browser
      // caller, never a deliberate clear — so it must never silently overwrite
      // a previously declared country. Leaving the key off the update object
      // uses Prisma's undefined-drop footgun in the SAFE direction on purpose:
      // no key means "leave this column alone."
      ...(country !== undefined ? { country } : {}),
      hiringFocus,
      name,
      settings: mergeSettings(organization.settings, {
        // No "Not set" here, unlike `country`: the setting always has a value,
        // so an absent/unparseable field can only be a stale, tampered or
        // non-browser submission — it rewrites the persisted value instead of
        // silently flipping a French workspace back to the "en" default.
        workspaceLanguage:
          cleanWorkspaceLanguage(formData.get("workspaceLanguage")) ??
          current.workspaceLanguage,
      }),
    },
    where: { id: scope.organizationId },
  });

  revalidateSettings();

  return { error: null, ok: true };
}

export async function updateInterviewPreferencesAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const scope = await getCompletedOrganizationScope();

  // Same graceful-refusal shape as updateWorkspaceSettingsAction above: a
  // non-manager submitting this form must fail gracefully, not crash the
  // page (this action used to just propagate assertCanEditSettings's throw).
  try {
    assertCanEditSettings(scope.role);
  } catch {
    const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
    return { error: t("settings.interview.forbidden"), ok: false };
  }

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

  return { error: null, ok: true };
}

export async function updateNotificationPreferencesAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const scope = await getCompletedOrganizationScope();

  try {
    assertCanEditSettings(scope.role);
  } catch {
    const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
    return { error: t("settings.notifications.forbidden"), ok: false };
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    select: { settings: true },
    where: { id: scope.organizationId },
  });

  const nextSettings = mergeSettings(organization.settings, {
    notifications: {
      candidateCompletionConfirmation: readBooleanField(
        formData,
        "candidateCompletionConfirmation",
      ),
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

  return { error: null, ok: true };
}

function assertCanEditSettings(role: OrganizationRole) {
  if (!canManageTeam(role)) {
    throw new Error("Only owners and admins can update workspace settings.");
  }
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function cleanOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
) {
  const text = cleanText(value, maxLength);

  return text ? text : null;
}

// "Not set" (the select's blank option, or an absent field) is the only
// input that means "clear it," and resolves to an explicit `null` — never an
// omitted key (Prisma silently drops `undefined`, which would leave a stale
// value in place instead of clearing it).
//
// Any NON-blank value that fails organizationCountrySchema is a different
// case: it cannot come from a deliberate clear (that path is blank/null), so
// it resolves to `undefined` instead of `null`. The caller uses `undefined`
// to mean "omit this key," which leaves the previously declared value
// untouched rather than silently wiping it on a stale or tampered submission.
function cleanDeclaredCountry(value: FormDataEntryValue | null) {
  const text = cleanText(value, 20);

  if (!text) {
    return null;
  }

  const result = organizationCountrySchema.safeParse(text);

  return result.success ? result.data : undefined;
}

// `undefined` means "the submission said nothing usable" — the caller keeps the
// persisted value. Case is folded because the persisted/submitted pair has to
// survive legacy shapes ("FR"); anything outside the en/fr catalogue pair is
// rejected outright rather than guessed at.
function cleanWorkspaceLanguage(value: FormDataEntryValue | null) {
  const result = workspaceLanguageSchema.safeParse(
    cleanText(value, 8).toLowerCase(),
  );

  return result.success ? result.data : undefined;
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
