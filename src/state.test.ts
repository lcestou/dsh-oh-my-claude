// Offline self-check: bun src/state.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPermissionModes, savePermissionMode, PERMISSION_MODES_FILE } from "./state.js";

const dir = await mkdtemp(join(tmpdir(), "omc-state-"));

// Nothing saved yet: empty map, no throw.
assert.deepEqual(await loadPermissionModes(dir), new Map());

// Set, overwrite, clear; concurrent saves serialize instead of losing one.
await Promise.all([
  savePermissionMode(dir, "s1", "plan"),
  savePermissionMode(dir, "s2", "acceptEdits"),
]);
assert.deepEqual(
  await loadPermissionModes(dir),
  new Map([
    ["s1", "plan"],
    ["s2", "acceptEdits"],
  ]),
);
await savePermissionMode(dir, "s1", "bypassPermissions");
await savePermissionMode(dir, "s2", null);
assert.deepEqual(await loadPermissionModes(dir), new Map([["s1", "bypassPermissions"]]));
assert.equal(await readFile(PERMISSION_MODES_FILE(dir), "utf8"), '{"s1":"bypassPermissions"}');

console.log("state.test: ok");
