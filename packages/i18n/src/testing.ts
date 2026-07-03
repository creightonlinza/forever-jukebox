// Deliberately hand-rolled rather than `typeof import("vitest")`: `web` and
// `pwa` pin different vitest majors, and their real `describe`/`it`/`expect`
// need to structurally satisfy this shape regardless of which major is
// installed. The caller passes its own already-running test API in; this
// package never imports (or depends on) a concrete `vitest` module.
export interface LocaleCompletenessTestApi {
  describe: (name: string, fn: () => void) => void;
  it: ((name: string, fn: () => void | Promise<void>) => void) & {
    each: <T>(
      cases: readonly T[],
    ) => (name: string, fn: (arg: T) => void | Promise<void>) => void;
  };
  expect: (actual: unknown) => {
    toBeDefined(): void;
    toBeGreaterThan(value: number): void;
    toEqual(expected: unknown): void;
  };
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, val]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return flattenKeys(val, path);
    },
  );
}

// Collapse i18next plural variants (e.g. `foo_one`/`foo_other`) to their base
// key so languages with different plural-category counts still compare equal.
function baseKeySet(mod: Record<string, unknown>): Set<string> {
  return new Set(flattenKeys(mod).map((key) => key.replace(PLURAL_SUFFIX, "")));
}

// Registers the tests that keep every passed-in locale's key set aligned with
// English. Pass in the result of an `import.meta.glob("./locales/*.json",
// { eager: true, import: "default" })` call from the app's own test file
// (`import.meta.glob` resolves relative to the calling module, so the glob
// can't live here) and the app's own vitest `describe`/`it`/`expect`.
export function assertLocaleCompleteness(
  localeModules: Record<string, Record<string, unknown>>,
  { describe, it, expect }: LocaleCompletenessTestApi,
): void {
  const locales = Object.entries(localeModules).map(([path, mod]) => ({
    code: path.split("/").pop()?.replace(/\.json$/, "") ?? path,
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
      ({ keys }: { keys: Set<string> }) => {
        const en = english!.keys;
        const missing = [...en]
          .filter((key) => !keys.has(key))
          .sort((a, b) => a.localeCompare(b));
        const extra = [...keys]
          .filter((key) => !en.has(key))
          .sort((a, b) => a.localeCompare(b));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      },
    );
  });
}
