"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@prelude/ui";

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
    <SelectField
      disabled={isPending}
      label={t("settings.profile.language")}
      onValueChange={(nextValue) => {
        if (nextValue === "en" || nextValue === "fr") {
          handleChange(nextValue);
        }
      }}
      options={[
        { label: t("settings.language.english"), value: "en" },
        { label: t("settings.language.french"), value: "fr" },
      ]}
      value={value}
    />
  );
}
