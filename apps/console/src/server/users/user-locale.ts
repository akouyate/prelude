import "server-only";

import { headers } from "next/headers";
import { prisma } from "@prelude/db";

import { coerceConsoleLocale, type ConsoleLocale } from "../../libs/i18n-server";
import { getConsoleAuthSession } from "../auth/console-auth-provider";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

/**
 * Resolve the authenticated user's UI locale from their persisted
 * `User.preferredLanguage`. Used by server actions/components that emit
 * localized recruiter-facing copy (compliance messages). Falls back to "en" if
 * the user row or column is missing so existing English behavior is preserved.
 */
export async function getAuthenticatedUserLocale(
  authenticatedUserId?: string,
): Promise<ConsoleLocale> {
  try {
    const userId =
      authenticatedUserId ?? (await getCompletedOrganizationScope()).userId;
    const user = await prisma.user.findUnique({
      select: { preferredLanguage: true },
      where: { id: userId },
    });

    return coerceConsoleLocale(user?.preferredLanguage);
  } catch {
    return "en";
  }
}

/**
 * Locale for the screens that run BEFORE onboarding completes.
 *
 * `getAuthenticatedUserLocale` resolves through `getCompletedOrganizationScope`,
 * which throws until onboarding is done — so during onboarding it always
 * returned "en", and a French recruiter met an English wizard on their very
 * first screen. This resolves without that requirement, and falls back to the
 * browser's own `Accept-Language` because a brand-new user has no stored
 * preference yet: their first language signal is the one their browser sends.
 */
export async function getOnboardingLocale(): Promise<ConsoleLocale> {
  try {
    const authSession = await getConsoleAuthSession();

    if (authSession.ok) {
      const user = await prisma.user.findUnique({
        select: { preferredLanguage: true },
        where: { clerkUserId: authSession.value.userId },
      });

      if (user?.preferredLanguage) {
        return coerceConsoleLocale(user.preferredLanguage);
      }
    }
  } catch {
    // Fall through to the header: an auth or database hiccup should downgrade
    // the language, not break the page.
  }

  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

/**
 * Each comma-separated entry may carry its own `;q=` quality value (RFC 9110
 * §12.5.4) — including the first one, with no comma before it — so the tag has
 * to be cut on both separators before it is readable. Only the primary
 * subtag matters here: "fr-CA" and "fr-BE" are both French to this console.
 */
function localeFromAcceptLanguage(header: string | null): ConsoleLocale {
  const primary = header?.split(",")[0]?.split(";")[0]?.trim().split("-")[0];

  return coerceConsoleLocale(primary?.toLowerCase());
}
