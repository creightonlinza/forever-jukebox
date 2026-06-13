// Regenerates test-fixtures/engine-parity/manifest.json after an intentional
// fixture change. The manifest is the cross-repo sync contract: this repo and
// forever-jukebox-android each verify their fixture copies against their copy
// of the manifest, so the two repos are in sync exactly when the manifests match.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-fixtures/engine-parity",
);
const manifestPath = path.join(fixtureDir, "manifest.json");

const previous = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : { contract_version: 0 };

const files = {};
for (const name of fs.readdirSync(fixtureDir).sort()) {
  if (!name.endsWith("-cases.json")) continue;
  const digest = createHash("sha256")
    .update(fs.readFileSync(path.join(fixtureDir, name)))
    .digest("hex");
  files[name] = digest;
}

const changed =
  JSON.stringify(files) !== JSON.stringify(previous.files ?? {});
const manifest = {
  contract_version: previous.contract_version + (changed ? 1 : 0),
  files,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${changed ? "updated" : "unchanged"} — contract_version ${manifest.contract_version}, ${Object.keys(files).length} files`,
);
if (changed) {
  console.log(
    "Sync the android repo: run scripts/sync-parity-fixtures.sh in forever-jukebox-android.",
  );
}
