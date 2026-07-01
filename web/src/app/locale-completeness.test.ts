import { describe, expect, it } from "vitest";
import { assertLocaleCompleteness } from "@forever-jukebox/i18n/testing";

// Auto-discovers every locale file. When a new language is added (e.g.
// `locales/es.json`), this guard fails until its key set matches English —
// keeping translations complete with zero changes to this test.
const localeModules = import.meta.glob<Record<string, unknown>>(
  "./locales/*.json",
  { eager: true, import: "default" },
);

assertLocaleCompleteness(localeModules, { describe, it, expect });
