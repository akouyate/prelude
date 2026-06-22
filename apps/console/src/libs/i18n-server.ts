import "server-only";

import { createInstance, type i18n, type TFunction } from "i18next";

import enCatalog from "../../public/locales/en.json";
import frCatalog from "../../public/locales/fr.json";

// Server-side translation path for the Next.js App Router. Some recruiter-facing
// strings (the compliance publish/save block, the N6 classifier block) are
// emitted from server actions / server components, where the client
// react-i18next instance is not available. `getServerT` builds a standalone
// i18next instance seeded with the same /public/locales catalogs and returns a
// `t` bound to the requested locale.

export const consoleLocales = ["en", "fr"] as const;
export type ConsoleLocale = (typeof consoleLocales)[number];

const resources = {
  en: { translation: enCatalog.translation },
  fr: { translation: frCatalog.translation },
} as const;

// Cache one initialized instance per locale across requests.
const instanceByLocale = new Map<ConsoleLocale, i18n>();

export function coerceConsoleLocale(value: string | undefined | null): ConsoleLocale {
  return value === "fr" ? "fr" : "en";
}

function getInstance(locale: ConsoleLocale): i18n {
  const cached = instanceByLocale.get(locale);

  if (cached) {
    return cached;
  }

  const instance = createInstance();
  // initImmediate:false makes init synchronous (resources are in-memory).
  void instance.init({
    lng: locale,
    fallbackLng: "en",
    supportedLngs: ["en", "fr"],
    resources,
    interpolation: {
      escapeValue: false,
    },
    initImmediate: false,
  });

  instanceByLocale.set(locale, instance);

  return instance;
}

/**
 * Returns a `t` function bound to the given locale, backed by the same catalogs
 * the client uses. Defaults to "en". Anything other than "en"/"fr" coerces to
 * "en" so existing English behavior is preserved.
 */
export function getServerT(locale: string | undefined | null = "en"): TFunction {
  const coerced = coerceConsoleLocale(locale);

  return getInstance(coerced).getFixedT(coerced);
}
