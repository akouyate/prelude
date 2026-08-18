import type { ReactNode } from "react";

import { I18nProvider } from "../../src/providers/i18n-provider";
import { getOnboardingLocale } from "../../src/server/users/user-locale";

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Onboarding sits outside the workspace layout, so it had no i18n provider
  // at all: every string here rendered in whatever language it was written in.
  // The locale is resolved without requiring completed onboarding — which is
  // precisely what this group runs before.
  const preferredLanguage = await getOnboardingLocale();

  return (
    <I18nProvider preferredLanguage={preferredLanguage}>
      <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(115deg,#f6f3ec_0%,#fbfaf7_48%,#f1f3e6_100%)] text-ink-900">
        {children}
      </div>
    </I18nProvider>
  );
}
