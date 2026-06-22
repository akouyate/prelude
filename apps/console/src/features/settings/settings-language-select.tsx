"use client";

import * as React from "react";
import { NavArrowDown } from "iconoir-react";
import { useTranslation } from "react-i18next";

import useLanguageStore, {
  type Language,
} from "../../stores/language-store";
import { updatePreferredLanguage } from "../../server/users/user-actions";

// Real, wired replacement for the Profile "Language" placeholder. On change it:
//  1. switches the UI immediately via the language store (i18n.changeLanguage),
//  2. persists the choice to User.preferredLanguage via a server action.
export function SettingsLanguageSelect({
  initialLanguage,
}: {
  initialLanguage: Language;
}) {
  const { t } = useTranslation();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const storeLanguage = useLanguageStore((state) => state.language);
  const [value, setValue] = React.useState<Language>(initialLanguage);
  const [isPending, startTransition] = React.useTransition();

  // Keep the control in sync if the language is changed elsewhere.
  React.useEffect(() => {
    setValue(storeLanguage);
  }, [storeLanguage]);

  const handleChange = (next: Language) => {
    setValue(next);
    // Switch the UI right away.
    setLanguage(next);
    // Persist durably.
    startTransition(async () => {
      await updatePreferredLanguage(next);
    });
  };

  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">
        {t("settings.profile.language")}
      </span>
      <div className="relative">
        <select
          aria-label={t("settings.profile.language")}
          className="h-11 w-full cursor-pointer appearance-none rounded-[13px] border border-[#e2ddd2] bg-white px-3.5 pr-10 text-left text-sm text-ink-950 transition hover:border-[#c8c1b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:opacity-60"
          disabled={isPending}
          onChange={(event) => handleChange(event.target.value as Language)}
          value={value}
        >
          <option value="en">{t("settings.language.english")}</option>
          <option value="fr">{t("settings.language.french")}</option>
        </select>
        <NavArrowDown
          aria-hidden={true}
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        />
      </div>
    </label>
  );
}
