import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readHints, updateHints } from "./sessions.js";
import { tempDir } from "./test-tmp.js";

const dir = tempDir("omc-hints-");
const path = join(dir, "hints.json");

// Every patch lands, whatever order the requests arrive in. Fired together, these used to read the
// same empty file and the last write back kept one key: the bug that emptied a real store on
// 2026-09-17.
await Promise.all([
  updateHints(path, { starterOff: true }),
  updateHints(path, { costOff: true }),
  updateHints(path, { spendWarnUsd: 25 }),
  updateHints(path, { themeRowOff: true }),
]);
const all = await readHints(path);
assert.deepEqual(all, { starterOff: true, costOff: true, spendWarnUsd: 25, themeRowOff: true });

// `false` and `null` clear a key and leave its neighbours alone.
await updateHints(path, { starterOff: false, costOff: null });
assert.deepEqual(await readHints(path), { spendWarnUsd: 25, themeRowOff: true });

// A model id is anything without whitespace, so a hide key carries a slash, an at sign or the CLI's
// `[1m]` mark. The store dropped those keys in silence and the switch flipped back on.
await updateHints(path, {
  "hideModel:claude-code:qwen/qwen3-coder": true,
  "hideModel:claude-code:opus[1m]": true,
  "hideModel:claude-code:team@gateway": true,
});
{
  const kept = await readHints(path);
  assert.equal(kept["hideModel:claude-code:qwen/qwen3-coder"], true);
  assert.equal(kept["hideModel:claude-code:opus[1m]"], true);
  assert.equal(kept["hideModel:claude-code:team@gateway"], true);
  await updateHints(path, {
    "hideModel:claude-code:qwen/qwen3-coder": false,
    "hideModel:claude-code:opus[1m]": false,
    "hideModel:claude-code:team@gateway": false,
  });
}

// Values the store does not keep, and key names it does not accept, change nothing.
await updateHints(path, {
  nope: "yes",
  "bad key": true,
  "-lead": true,
  __proto__: true,
  negative: -1,
});
assert.equal(
  (await updateHints(path, { "hideModel:claude-code-lilly:claude-opus-5": true }))[
    "hideModel:claude-code-lilly:claude-opus-5"
  ],
  true,
  "a scoped key with a model id is kept",
);
await updateHints(path, { "hideModel:claude-code-lilly:claude-opus-5": false });
assert.deepEqual(await readHints(path), { spendWarnUsd: 25, themeRowOff: true });

// The file on disk is valid JSON after all of it, not a half-written map.
JSON.parse(await readFile(path, "utf8"));

console.log("hints.test: ok");
