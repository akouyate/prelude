"use client";

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

// Mirrors the Fluenceur frontend i18n setup (i18next + react-i18next), adapted
// for the Next.js App Router: this module is client-only ("use client") and is
// initialized once from the I18nProvider. Server-side strings go through
// `getServerT` in `i18n-server.ts` instead.

// Cache-busting version for the translation catalogs. Bump when copy changes.
const TRANSLATION_VERSION = "2";

// Guard against double-init across fast-refresh / multiple imports.
if (!i18n.isInitialized) {
  i18n
    // Load translation files from /public/locales
    .use(Backend)
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

      backend: {
        loadPath: `/locales/{{lng}}.json?v=${TRANSLATION_VERSION}`,
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
