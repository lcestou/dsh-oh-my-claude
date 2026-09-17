import { strict as assert } from "node:assert";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHints, updateHints } from "./sessions.js";

const dir = await mkdtemp(join(tmpdir(), "omc-hints-"));
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

// Values the store does not keep, and key names it does not accept, change nothing.
await updateHints(path, { nope: "yes", "bad-key": true, negative: -1 });
assert.deepEqual(await readHints(path), { spendWarnUsd: 25, themeRowOff: true });

// The file on disk is valid JSON after all of it, not a half-written map.
JSON.parse(await readFile(path, "utf8"));

console.log("hints.test: ok");
