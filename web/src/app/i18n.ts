import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

export const defaultNS = "translation";
export const resources = {
  en: {
    translation: en,
  },
} as const;
export const supportedLanguageOptions = [
  { code: "en", label: "English" },
] as const;
const supportedLanguages: readonly string[] = supportedLanguageOptions.map(
  ({ code }) => code,
);
const languageStorageKey = "fj-language";
const rtlLanguages: readonly string[] = ["ar", "fa", "he", "ur"];

export function resolveSupportedLanguage(language: string | null | undefined) {
  const baseLanguage = language?.toLowerCase().split("-")[0];
  return baseLanguage && supportedLanguages.includes(baseLanguage)
    ? baseLanguage
    : "en";
}

export function isRtlLanguage(language: string | null | undefined): boolean {
  const baseLanguage = language?.toLowerCase().split("-")[0];
  return baseLanguage ? rtlLanguages.includes(baseLanguage) : false;
}

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(languageStorageKey);
  } catch {
    return null;
  }
}

function preferredLanguage(): string {
  const stored = storedLanguage();
  if (stored && supportedLanguages.includes(stored)) {
    return stored;
  }
  if (typeof navigator === "undefined") {
    return "en";
  }
  const candidates =
    navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const baseLanguage = candidate.toLowerCase().split("-")[0];
    if (supportedLanguages.includes(baseLanguage)) {
      return baseLanguage;
    }
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources,
  defaultNS,
  lng: preferredLanguage(),
  fallbackLng: "en",
  supportedLngs: supportedLanguages,
  nonExplicitSupportedLngs: true,
  load: "languageOnly",
  initAsync: false,
  returnNull: false,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

function updateDocumentLanguage(language: string) {
  const resolvedLanguage = resolveSupportedLanguage(language);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = resolvedLanguage;
    document.documentElement.dir = isRtlLanguage(resolvedLanguage)
      ? "rtl"
      : "ltr";
  }
  try {
    localStorage.setItem(languageStorageKey, resolvedLanguage);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage(i18n.resolvedLanguage ?? "en");

export default i18n;
