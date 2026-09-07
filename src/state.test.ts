// Offline self-check: bun src/state.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPermissionModes,
  savePermissionMode,
  modesUpTo,
  PERMISSION_MODES_FILE,
  loadTurnRecords,
  saveTurnRecords,
  TURNS_FILE,
  loadLimitWaits,
  saveLimitWait,
} from "./state.js";

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

// Turn records: write two sessions, read back, assert deep equality.
// Under the repo's own .cache so the records land on the same filesystem the plugin uses;
// a fresh checkout has no .cache yet, so make it rather than fail on the first run.
const cacheDir = join(process.cwd(), ".cache");
await mkdir(cacheDir, { recursive: true });
const turnsDir = await mkdtemp(join(cacheDir, "omc-turns-"));
await saveTurnRecords(turnsDir, "ts1", [
  {
    at: 1000,
    costUsd: 0.01,
    durationMs: 500,
    input: 100,
    output: 50,
    cacheRead: 20,
    cacheWrite: 10,
    apiMs: 300,
    turns: 1,
  },
  {
    at: 2000,
    costUsd: 0.02,
    durationMs: 600,
    input: 150,
    output: 80,
    cacheRead: 30,
    cacheWrite: 15,
    apiMs: 400,
    turns: 2,
  },
]);
await saveTurnRecords(turnsDir, "ts2", [
  {
    at: 3000,
    costUsd: 0.03,
    durationMs: 700,
    input: 200,
    output: 100,
    cacheRead: 40,
    cacheWrite: 20,
    apiMs: 500,
    turns: 3,
  },
]);
const loadedTurns = await loadTurnRecords(turnsDir);
assert.deepEqual(loadedTurns.get("ts1"), [
  {
    at: 1000,
    costUsd: 0.01,
    durationMs: 500,
    input: 100,
    output: 50,
    cacheRead: 20,
    cacheWrite: 10,
    apiMs: 300,
    turns: 1,
  },
  {
    at: 2000,
    costUsd: 0.02,
    durationMs: 600,
    input: 150,
    output: 80,
    cacheRead: 30,
    cacheWrite: 15,
    apiMs: 400,
    turns: 2,
  },
]);
assert.deepEqual(loadedTurns.get("ts2"), [
  {
    at: 3000,
    costUsd: 0.03,
    durationMs: 700,
    input: 200,
    output: 100,
    cacheRead: 40,
    cacheWrite: 20,
    apiMs: 500,
    turns: 3,
  },
]);

// Malformed entry: write a bad record into ts1's array and assert the loader drops it but keeps ts2.
const raw = JSON.parse(await readFile(TURNS_FILE(turnsDir), "utf8"));
raw.ts1.push({
  at: "not-a-number",
  costUsd: 0.01,
  durationMs: 500,
  input: 100,
  output: 50,
  cacheRead: 20,
  cacheWrite: 10,
});
await writeFile(TURNS_FILE(turnsDir), JSON.stringify(raw));
const dropped = await loadTurnRecords(turnsDir);
assert.equal(dropped.get("ts1")?.length, 2);
assert.deepEqual(dropped.get("ts2"), [
  {
    at: 3000,
    costUsd: 0.03,
    durationMs: 700,
    input: 200,
    output: 100,
    cacheRead: 40,
    cacheWrite: 20,
    apiMs: 500,
    turns: 3,
  },
]);

assert.deepEqual(modesUpTo("plan"), ["plan"]);
assert.deepEqual(modesUpTo("acceptEdits"), ["default", "acceptEdits", "plan"]);
assert.equal(modesUpTo("bypassPermissions").length, 6);

console.log("turns-state ok");

// Limit waits: set two, forget one, reload; concurrent saves serialize.
assert.deepEqual(await loadLimitWaits(dir), new Map());
await Promise.all([saveLimitWait(dir, "s1", 1_000), saveLimitWait(dir, "s2", 2_000)]);
await saveLimitWait(dir, "s1", undefined);
assert.deepEqual(await loadLimitWaits(dir), new Map([["s2", 2_000]]));
console.log("limit-waits ok");
console.log("state.test: ok");
