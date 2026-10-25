// Offline self-check: bun src/listing.test.ts. Reads repo files only.
// The plugin catalog (awesome-dsh-plugin, scripts/probe-screenshots.mjs) drops every declared
// screenshot when screenshots.json has more than 8 entries, an absolute path or a `..`; nine
// entries hid the store card from 2026-09-21 to 2026-10-23. dshmarket then shows only the first 6
// (its market-data.ts MAX_SCREENSHOTS), so the order in screenshots.json is the order people see.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const shots: unknown = JSON.parse(readFileSync(join(root, "screenshots.json"), "utf8"));
assert.ok(Array.isArray(shots), "screenshots.json is a plain array");
assert.ok(
  shots.length >= 1 && shots.length <= 8,
  `screenshots.json has ${shots.length} entries; the catalog takes 1 to 8`,
);
const tracked = new Set(
  execFileSync("git", ["ls-files", "docs/media"], { cwd: root, encoding: "utf8" }).split("\n"),
);
for (const shot of shots) {
  assert.equal(typeof shot, "string");
  assert.ok(
    !shot.startsWith("/") && !shot.split("/").includes(".."),
    `${shot}: the catalog refuses paths outside the repo`,
  );
  assert.match(shot, /\.(png|jpe?g|gif|webp)$/, `${shot}: storefronts show rasters only`);
  assert.ok(tracked.has(shot), `${shot}: not a tracked file, the storefront would 404`);
}
// pnpm refuses a git dependency that runs a script on install unless the installer allowlists it
// (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED), which broke `github:lcestou/dsh-oh-my-claude`. lib/ is
// committed, so an install has nothing to build.
const pkg: { scripts?: Record<string, string> } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepack"]) {
  assert.equal(
    pkg.scripts?.[hook],
    undefined,
    `package.json scripts.${hook} runs on a git install`,
  );
}
console.log("listing ok");
