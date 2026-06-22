"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import i18n from "../libs/i18n";

// Mirrors the Fluenceur `language-store`. Prelude supports the same two locales
// as the compliance copy: English (default) and French.
export type Language = "en" | "fr";

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  initializeLanguage: (userLanguage?: Language) => void;
}

const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: "en",

      setLanguage: (lang: Language) => {
        // Update i18next language
        void i18n.changeLanguage(lang);

        // Update store
        set({ language: lang });
      },

      initializeLanguage: (userLanguage?: Language) => {
        const storedLanguage = get().language;
        // Priority: backend user preference > stored preference > default.
        const languageToUse = userLanguage || storedLanguage;

        if (languageToUse && languageToUse !== i18n.language) {
          get().setLanguage(languageToUse);
        }
      },
    }),
    {
      name: "language-store",
      partialize: (state) => ({
        language: state.language,
      }),
    },
  ),
);

export default useLanguageStore;
