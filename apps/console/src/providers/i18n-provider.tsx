"use client";

import * as React from "react";
import { I18nextProvider } from "react-i18next";

import i18n from "../libs/i18n";
import useLanguageStore, { type Language } from "../stores/language-store";
import enCatalog from "../../public/locales/en.json";
import frCatalog from "../../public/locales/fr.json";

// Bundle the catalogs directly so `t()` is correct on the very first render
// (no key flash, no hydration mismatch). The http-backend in i18n.ts still
// serves /locales for cache-busting/runtime reloads, but having the resources
// in-memory means SSR and the initial client paint agree.
if (!i18n.hasResourceBundle("en", "translation")) {
  i18n.addResourceBundle("en", "translation", enCatalog.translation, true, true);
}
if (!i18n.hasResourceBundle("fr", "translation")) {
  i18n.addResourceBundle("fr", "translation", frCatalog.translation, true, true);
}

function coerceLanguage(value: string | undefined): Language {
  return value === "fr" ? "fr" : "en";
}

export function I18nProvider({
  children,
  preferredLanguage,
}: {
  children: React.ReactNode;
  preferredLanguage?: string;
}) {
  const initial = coerceLanguage(preferredLanguage);

  // Seed the language synchronously on first render so server and client agree.
  const [seeded] = React.useState(() => {
    if (i18n.language !== initial) {
      void i18n.changeLanguage(initial);
    }
    return initial;
  });

  React.useEffect(() => {
    // Priority: backend user preference > stored preference > default.
    useLanguageStore.getState().initializeLanguage(seeded);
  }, [seeded]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
