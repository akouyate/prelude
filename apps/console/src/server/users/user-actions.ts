"use server";

import { prisma } from "@prelude/db";
import { revalidatePath } from "next/cache";

import { coerceConsoleLocale, type ConsoleLocale } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

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
    return { ok: false, error: "Could not save your language preference." };
  }

  // The locale changes recruiter-facing server copy; refresh the shell.
  revalidatePath("/");

  return { ok: true, preferredLanguage };
}
