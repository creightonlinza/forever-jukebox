import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The engine-parity fixtures are a behavior contract shared with the
// forever-jukebox-android repo; both repos verify their copies against
// manifest.json. If this test fails you edited a fixture without running
// `npm run fixtures:manifest` (and re-syncing the android repo).
const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../test-fixtures/engine-parity",
);

type Manifest = { contract_version: number; files: Record<string, string> };

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("engine-parity fixture manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8"),
  ) as Manifest;

  it("lists every fixture case file", () => {
    const byName = (a: string, b: string) => a.localeCompare(b);
    const onDisk = fs
      .readdirSync(fixtureDir)
      .filter((name) => name.endsWith("-cases.json"))
      .sort(byName);
    expect(onDisk).toEqual(Object.keys(manifest.files).sort(byName));
  });

  it("matches the content hash of every fixture", () => {
    const mismatched = Object.entries(manifest.files)
      .filter(
        ([name, digest]) => sha256(path.join(fixtureDir, name)) !== digest,
      )
      .map(([name]) => name);
    expect(mismatched).toEqual([]);
  });
});
