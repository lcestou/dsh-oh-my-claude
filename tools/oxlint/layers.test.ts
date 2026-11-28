// The lint loads all three layers (tools/oxlint/README.md): the Cloudflare preset's type-aware
// rules, nkzw's anti-slop `quality/*` rules, and the local `anti-slop/*` plugin. A clean lint run
// cannot tell a loaded plugin from a missing one, so this lints deliberate slop and expects a
// finding from each.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("probe/slop.ts", import.meta.url));

const result = spawnSync("bun", ["x", "oxlint", probe], {
  encoding: "utf8",
  env: { ...process.env, LINT_PROBE: "1" },
});

const output = `${result.stdout}\n${result.stderr}`;

assert.notEqual(result.status, 0, output);

for (const rule of [
  "anti-slop(no-runtime-typeof)",
  "anti-slop(require-safety-comment-for-type-assertion)",
  "quality(no-chained-type-assertions)",
  "quality(no-array-filter-map)",
  "typescript(no-floating-promises)",
  "typescript(no-unsafe-type-assertion)",
]) {
  assert.ok(output.includes(rule), `expected ${rule} in:\n${output}`);
}
