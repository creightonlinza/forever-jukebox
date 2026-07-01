import { createAppI18n, defaultNS } from "@forever-jukebox/i18n";
import en from "./locales/en.json";

export const supportedLanguageOptions = [
  { code: "en", label: "English" },
] as const;

export const resources = {
  en: {
    translation: en,
  },
} as const;

const app = createAppI18n({
  resources,
  supportedLanguageOptions,
});

export const resolveSupportedLanguage = app.resolveSupportedLanguage;
export { defaultNS };

export default app.i18n;
