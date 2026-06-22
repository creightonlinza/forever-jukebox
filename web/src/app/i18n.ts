import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

export const defaultNS = "translation";
export const resources = {
  en: {
    translation: en,
  },
} as const;
const supportedLanguages = Object.keys(resources);

function preferredLanguage(): string {
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
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = language;
  }
}

i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage(i18n.resolvedLanguage ?? "en");

export default i18n;
