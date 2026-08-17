/**
 * Recipient locale for a notification delivery. Mirrors `ConsoleLocale` /
 * `coerceConsoleLocale` in apps/console/src/libs/i18n-server.ts. Duplicated
 * here (not imported) because packages/notifications must not depend on an
 * app — see CLAUDE.md's package-boundary rule — and the coercion is a
 * one-line rule, not enough logic to justify a new shared package. Keep the
 * two in sync if the console ever supports a locale beyond en/fr.
 */
export type NotificationLocale = "en" | "fr";

export function coerceNotificationLocale(
  value: string | null | undefined,
): NotificationLocale {
  return value === "fr" ? "fr" : "en";
}
