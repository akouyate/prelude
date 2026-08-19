"use client";

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// Mirrors the Fluenceur frontend i18n setup (i18next + react-i18next), adapted
// for the Next.js App Router: this module is client-only ("use client") and is
// initialized once from the I18nProvider. Server-side strings go through
// `getServerT` in `i18n-server.ts` instead.
//
// There is deliberately no http-backend here, and no catalogue version to bump.
// `I18nProvider` imports both catalogues as modules and seeds them with
// i18next's overwrite flag, so they are already in memory before the first
// render. A backend fetching /locales on top of that could only ever ADD keys —
// i18next's backend connector merges with overwrite disabled — so it silently
// lost every EDIT to an existing string while appearing to work, because new
// keys did show up. The bundled import is the single source of truth and it is
// rebuilt by `next build`, which is what makes edited copy ship.

// Guard against double-init across fast-refresh / multiple imports.
if (!i18n.isInitialized) {
  i18n
    // Detect user language (localStorage first, then navigator)
    .use(LanguageDetector)
    // Pass the i18n instance to react-i18next
    .use(initReactI18next)
    // Initialize i18next
    .init({
      fallbackLng: "en",
      supportedLngs: ["en", "fr"],
      // Next-safe DEV check (no import.meta).
      debug: process.env.NODE_ENV === "development",

      interpolation: {
        escapeValue: false, // React already escapes values
      },

      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "i18nextLng",
      },

      react: {
        // SSR-friendly: avoid suspending during hydration. The provider seeds
        // the resources for the server-chosen language before render.
        useSuspense: false,
      },
    });
}

export default i18n;
