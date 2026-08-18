"use server";

import { prisma } from "@prelude/db";
import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { coerceConsoleLocale, getServerT, type ConsoleLocale } from "../../libs/i18n-server";
import { getConsoleAuthSession } from "../auth/console-auth-provider";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { getAuthenticatedUserLocale } from "./user-locale";

export type UpdatePreferredLanguageResult =
  | { ok: true; preferredLanguage: ConsoleLocale }
  | { ok: false; error: string };

/**
 * Persist the authenticated user's UI language to `User.preferredLanguage`.
 * Org/user-scoped via the same scope helper used elsewhere. Unknown locales
 * coerce to "en". The client mirrors this into i18n via the language store so
 * the UI switches immediately; this action makes the choice durable.
 */
export async function updatePreferredLanguage(
  locale: string,
): Promise<UpdatePreferredLanguageResult> {
  const preferredLanguage = coerceConsoleLocale(locale);

  try {
    const scope = await getCompletedOrganizationScope();

    await prisma.user.update({
      data: { preferredLanguage },
      where: { id: scope.userId },
    });
  } catch {
    const t = getServerT(await getAuthenticatedUserLocale());
    return { error: t("settings.profile.languageSaveFailed"), ok: false };
  }

  // The locale changes recruiter-facing server copy; refresh the shell.
  revalidatePath("/");

  return { ok: true, preferredLanguage };
}

const MAX_PROFILE_NAME_LENGTH = 160;

// Same `{ error, ok }` shape as `WorkspaceSettingsActionState` (a separate
// type, deliberately not imported from workspace-settings-actions.ts — this
// module has no other reason to depend on that one, and the shape is the
// contract that matters, not a shared identity).
export type UpdateProfileNameActionState = {
  error: string | null;
  ok: boolean;
};

/**
 * Save the recruiter's display name (plan 2026-08-18, Part 1). Clerk stays
 * the source of truth for identity; `User.name` is only ever a mirror of it.
 * The honest-failure rule this exists to satisfy: if the Clerk write fails,
 * the mirror must NOT be written — the two must never silently diverge. Under
 * the mock auth provider there is no Clerk account to write to, so the
 * mirror IS the record, written directly rather than pretending a Clerk call
 * happened.
 */
export async function updateProfileNameAction(
  _state: UpdateProfileNameActionState,
  formData: FormData,
): Promise<UpdateProfileNameActionState> {
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_PROFILE_NAME_LENGTH);

  if (!name) {
    // The field is `required` in the UI, so a blank submission here can only
    // come from a stale/tampered/non-browser request — mirrors
    // updateWorkspaceSettingsAction's same blank-required-field handling.
    return { error: null, ok: false };
  }

  const scope = await getCompletedOrganizationScope();
  const authSession = await getConsoleAuthSession();
  const isClerkManaged = authSession.ok && authSession.value.source === "clerk";

  if (isClerkManaged) {
    const user = await prisma.user.findUniqueOrThrow({
      select: { clerkUserId: true },
      where: { id: scope.userId },
    });

    try {
      const client = await clerkClient();
      const { firstName, lastName } = splitDisplayName(name);
      await client.users.updateUser(user.clerkUserId, { firstName, lastName });
    } catch {
      const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
      return { error: t("settings.profile.nameSaveFailed"), ok: false };
    }
  }

  // Same honest-failure rule applies to this leg too: if Clerk's write just
  // succeeded but the mirror write then fails, the two are left diverged
  // with nothing to reconcile them (there is no `user.updated` webhook
  // handler — clerk-webhook-sync.ts only handles membership/invitation
  // events). Catching this and answering with the same shape at least
  // surfaces the failure as a toast instead of an unhandled server-action
  // error, and lets the recruiter retry the save.
  try {
    await prisma.user.update({
      data: { name },
      where: { id: scope.userId },
    });
  } catch {
    const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
    return { error: t("settings.profile.nameSaveFailed"), ok: false };
  }

  revalidatePath("/");
  revalidatePath("/settings");

  return { error: null, ok: true };
}

// Clerk splits a person's name into firstName/lastName; our own `User.name`
// is a single field. The first word is the first name, everything else is
// the last name. A single-word name (common for mock/demo data) sends an
// EXPLICIT empty string for lastName, not `undefined` — `undefined` is
// dropped at JSON serialization, so Clerk's PATCH would never mention
// last_name at all and would keep whatever it already had there. That broke
// the honest-mirror invariant on any name SHORTENING ("Ada Lovelace" -> "Ada"
// left Clerk still showing "Lovelace" while the mirror said "Ada", with
// nothing to reconcile the two — same missing-webhook problem as above).
// Clerk accepts an empty string to clear the field, so this sends one.
//
// Both halves verified against the real Backend API on 2026-08-18 (test
// instance, throwaway user, deleted after): PATCH `{last_name: ""}` on a user
// whose surname was "Lovelace" read back as `null`, and the control — the
// pre-fix payload, omitting `last_name` — read back as "Lovelace" still.
// Recorded because the unit tests mock Clerk: they prove what we SEND, never
// what Clerk DOES with it, so a reader has no other way to know this is
// measured rather than assumed.
function splitDisplayName(name: string): {
  firstName: string;
  lastName: string;
} {
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  return {
    firstName: firstName ?? name,
    lastName: rest.length > 0 ? rest.join(" ") : "",
  };
}
