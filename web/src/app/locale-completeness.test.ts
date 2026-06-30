import { describe, expect, it } from "vitest";

// Auto-discovers every locale file. When a new language is added (e.g.
// `locales/es.json`), this guard fails until its key set matches English —
// keeping translations complete with zero changes to this test.
const localeModules = import.meta.glob<Record<string, unknown>>(
  "./locales/*.json",
  { eager: true, import: "default" },
);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, val]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(val, path);
  });
}

// Collapse i18next plural variants (e.g. `foo_one`/`foo_other`) to their base
// key so languages with different plural-category counts still compare equal.
function baseKeySet(mod: Record<string, unknown>): Set<string> {
  return new Set(flattenKeys(mod).map((key) => key.replace(PLURAL_SUFFIX, "")));
}

const locales = Object.entries(localeModules).map(([path, mod]) => ({
  code: path.match(/([^/]+)\.json$/)?.[1] ?? path,
  keys: baseKeySet(mod),
}));

const english = locales.find((locale) => locale.code === "en");
const otherLocales = locales.filter((locale) => locale.code !== "en");

describe("locale completeness", () => {
  it("ships an English base locale with keys", () => {
    expect(english).toBeDefined();
    expect(english!.keys.size).toBeGreaterThan(0);
  });

  it.each(otherLocales)(
    "locale '$code' has exactly the English key set",
    ({ keys }) => {
      const en = english!.keys;
      const missing = [...en].filter((key) => !keys.has(key)).sort();
      const extra = [...keys].filter((key) => !en.has(key)).sort();
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );
});
