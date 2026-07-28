import i18n, {
  type i18n as I18nInstance,
  type Resource,
} from "i18next";
import { initReactI18next } from "react-i18next";

export const defaultNS = "translation";
const languageStorageKey = "fj-language";
const rtlLanguages: ReadonlySet<string> = new Set(["ar", "fa", "he", "ur"]);

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(languageStorageKey);
  } catch {
    return null;
  }
}

export interface SupportedLanguageOption {
  readonly code: string;
  readonly label: string;
}

export function isRtlLanguage(language: string | null | undefined): boolean {
  const baseLanguage = language?.toLowerCase().split("-")[0];
  return baseLanguage ? rtlLanguages.has(baseLanguage) : false;
}

export interface CreateAppI18nOptions<TResources> {
  resources: TResources;
  supportedLanguageOptions: readonly SupportedLanguageOption[];
}

export interface AppI18n<TResources> {
  i18n: I18nInstance;
  resources: TResources;
  supportedLanguageOptions: readonly SupportedLanguageOption[];
  resolveSupportedLanguage: (language: string | null | undefined) => string;
}

// Builds and synchronously initializes an app's i18next instance. Each app
// owns its own `resources`/`supportedLanguageOptions` (and the matching
// `i18next.d.ts` type augmentation); this factory only owns the machinery
// that was previously byte-identical across apps.
export function createAppI18n<TResources extends Resource>({
  resources,
  supportedLanguageOptions,
}: CreateAppI18nOptions<TResources>): AppI18n<TResources> {
  const supportedLanguages: readonly string[] = supportedLanguageOptions.map(
    ({ code }) => code,
  );

  function resolveSupportedLanguage(
    language: string | null | undefined,
  ): string {
    const baseLanguage = language?.toLowerCase().split("-")[0];
    return baseLanguage && supportedLanguages.includes(baseLanguage)
      ? baseLanguage
      : "en";
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

  return {
    i18n,
    resources,
    supportedLanguageOptions,
    resolveSupportedLanguage,
  };
}
