import { describe, expect, it } from "vitest";
import { assertLocaleCompleteness } from "./testing";

// Registered at collection time, exactly like an app's real
// locale-completeness test — nested describe/it must not run inside an
// already-executing `it` block.
assertLocaleCompleteness(
  {
    "./locales/en.json": { greeting: "Hello", count_one: "1", count_other: "n" },
    "./locales/fr.json": { greeting: "Bonjour", count_one: "1", count_other: "n" },
  },
  { describe, it, expect },
);
