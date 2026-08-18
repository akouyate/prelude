"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { SelectField, useToast } from "@prelude/ui";

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
  const { i18n, t } = useTranslation();
  const { toast } = useToast();
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
    // Persist durably. This fires from the select's own onChange, not a
    // reactive effect, so no toastOnce/dedupe guard is needed — one change,
    // one announcement.
    startTransition(async () => {
      // `i18n.changeLanguage` above is async (fire-and-forget): by the time
      // this resolves, the component's own `t` closure may still be bound to
      // the language the user just switched AWAY from — this select's whole
      // point is that the switch already happened, so the announcement of
      // it must speak the new language, not the stale one. `i18n.t` with an
      // explicit `lng` sidesteps the race entirely.
      const announce = (key: string) => i18n.t(key, { lng: next });
      const result = await updatePreferredLanguage(next);
      if (result.ok) {
        toast({
          dismissLabel: announce("toast.dismiss"),
          message: announce("toast.languageUpdated"),
          tone: "success",
        });
      } else {
        // `result.error` is already localized, but server-side — from the
        // locale in `User.preferredLanguage` as it stood BEFORE this call,
        // since the write that would have changed it just failed. That's the
        // language the user switched away from, not the one they just
        // switched to. Discard it and announce the same known failure
        // client-side with `announce`, for the same reason as the success
        // branch above.
        toast({
          dismissLabel: announce("toast.dismiss"),
          duration: null,
          message: announce("settings.profile.languageSaveFailed"),
          tone: "danger",
        });
      }
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
