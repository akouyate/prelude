import "server-only";

import { prisma } from "@prelude/db";

import { coerceConsoleLocale, type ConsoleLocale } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

/**
 * Resolve the authenticated user's UI locale from their persisted
 * `User.preferredLanguage`. Used by server actions/components that emit
 * localized recruiter-facing copy (compliance messages). Falls back to "en" if
 * the user row or column is missing so existing English behavior is preserved.
 */
export async function getAuthenticatedUserLocale(): Promise<ConsoleLocale> {
  try {
    const scope = await getCompletedOrganizationScope();
    const user = await prisma.user.findUnique({
      select: { preferredLanguage: true },
      where: { id: scope.userId },
    });

    return coerceConsoleLocale(user?.preferredLanguage);
  } catch {
    return "en";
  }
}
