// Offline self-check: bun src/state.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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
  loadAsides,
  saveAsides,
  loadStarters,
  saveStarter,
  loadStarted,
  rememberStarted,
  ASIDES_FILE,
  STATE_DIR,
  loadTerminalSync,
  saveTerminalSync,
  TERMINAL_SYNC_FILE,
  loadWorkspaceModels,
  saveWorkspaceModel,
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

// Asides: save a ring, reload; pending and malformed entries drop on load; concurrent saves serialize.
const asidesDir = await mkdtemp(join(tmpdir(), "omc-asides-"));
assert.deepEqual(await loadAsides(asidesDir), new Map());
await Promise.all([
  saveAsides(asidesDir, "a1", [
    { id: "q1", question: "why?", answer: "because", pending: false, at: 100 },
    { id: "q2", question: "how?", error: "no live process", pending: false, at: 200 },
  ]),
  saveAsides(asidesDir, "a2", [
    { id: "q3", question: "when?", pending: true, at: 300 }, // still spinning; must not restore
  ]),
  saveAsides(asidesDir, "a4", [
    // A closed card: dismissed, not deleted, so the Asides tab can still show the answer.
    { id: "q4", question: "where?", answer: "here", pending: false, at: 400, dismissed: true },
  ]),
]);
const asides = await loadAsides(asidesDir);
assert.equal(asides.get("a1")?.length, 2);
assert.equal(asides.get("a1")?.[0]?.answer, "because");
assert.equal(asides.get("a1")?.[1]?.error, "no live process");
assert.equal(asides.get("a2"), undefined); // the lone pending entry dropped, so no key survives
assert.equal(asides.get("a4")?.[0]?.dismissed, true); // the dismissed flag survives a reload

// A file with junk entries keeps only the well-formed, resolved ones.
await writeFile(
  ASIDES_FILE(asidesDir),
  JSON.stringify({
    a3: [
      { id: "ok", question: "q", pending: false, at: 1 },
      { question: "no id", pending: false, at: 2 },
      { id: "no-at", question: "q", pending: false },
      "not-an-object",
    ],
  }),
);
const cleaned = await loadAsides(asidesDir);
assert.deepEqual(cleaned.get("a3"), [{ id: "ok", question: "q", pending: false, at: 1 }]);
console.log("asides ok");
// Starters: save per-session and default openers, reload, and clear one with a blank text.
const startersDir = await mkdtemp(join(tmpdir(), "omc-starters-"));
assert.deepEqual(await loadStarters(startersDir), new Map());
await saveStarter(startersDir, "s1", "review the diff");
await saveStarter(startersDir, "default", "what changed?");
await saveStarter(startersDir, "s2", "   "); // blank never becomes an opener
let starters = await loadStarters(startersDir);
assert.equal(starters.get("s1"), "review the diff");
assert.equal(starters.get("default"), "what changed?");
assert.equal(starters.get("s2"), undefined);
await saveStarter(startersDir, "s1", ""); // clearing drops the key
starters = await loadStarters(startersDir);
assert.equal(starters.get("s1"), undefined);
assert.equal(starters.get("default"), "what changed?");
console.log("starters ok");
// Workspace models: remember which Claude model a workspace last ran; cleared when blank or absent.
const wsDir = await mkdtemp(join(tmpdir(), "omc-ws-"));
let wsModels = await loadWorkspaceModels(wsDir);
assert.equal(wsModels.size, 0, "empty dir loads empty map");
await saveWorkspaceModel(wsDir, "/w/a", "claude-opus-5", 10);
await saveWorkspaceModel(wsDir, "/w/b", "haiku", 20);
wsModels = await loadWorkspaceModels(wsDir);
assert.deepEqual(wsModels.get("/w/a"), { model: "claude-opus-5", at: 10 });
assert.deepEqual(wsModels.get("/w/b"), { model: "haiku", at: 20 });
await saveWorkspaceModel(wsDir, "/w/b", undefined);
wsModels = await loadWorkspaceModels(wsDir);
assert.equal(wsModels.size, 1, "undefined model forgets it");
await saveWorkspaceModel(wsDir, "/w/a", "");
wsModels = await loadWorkspaceModels(wsDir);
assert.equal(wsModels.size, 0, "blank model forgets it");
console.log("workspace models ok");
// Started ids: what another writer put in the file between two of ours survives, which it did not
// while the set was read once and cached for the life of the process.
const startedFile = join(await mkdtemp(join(tmpdir(), "omc-started-")), "sessions.json");
await rememberStarted("a", true, startedFile);
await writeFile(startedFile, JSON.stringify(["a", "other-process"]));
await rememberStarted("b", true, startedFile);
assert.deepEqual([...(await loadStarted(startedFile))], ["a", "other-process", "b"]);
await rememberStarted("a", false, startedFile);
assert.deepEqual([...(await loadStarted(startedFile))], ["other-process", "b"]);
console.log("started ids ok");
// Every store lands through a temp file and a rename, so a crash mid-write cannot leave a half
// file the next read would treat as empty and the next save would write back from. Nothing of that
// is left behind afterwards.
for (const d of [dir, startersDir, asidesDir])
  assert.deepEqual(
    (await readdir(d)).filter((n) => n.includes(".tmp-")),
    [],
    "no temp file survives a save",
  );
console.log("atomic writes ok");

// The suite runs under DSH_OMC_STATE_DIR (package.json sets it): every store must be under it, or
// a test rewrites the running plugin's files.
if (process.env.DSH_OMC_STATE_DIR !== undefined)
  assert.equal(STATE_DIR, process.env.DSH_OMC_STATE_DIR, "STATE_DIR follows the env for tests");
// Holds: a respawn writes the new record before the old hold's exit arrives, and that exit drops
// only its own name.
{
  const { loadHolds, saveHold, dropHold } = await import("./state.js");
  const dir = await mkdtemp(join(tmpdir(), "omc-holds-"));
  await saveHold(dir, "s", { name: "old", offset: 1 });
  await saveHold(dir, "s", { name: "new", offset: 0 });
  await dropHold(dir, "s", "old");
  assert.deepEqual(await loadHolds(dir), { s: { name: "new", offset: 0 } }, "old exit keeps new");
  await dropHold(dir, "s", "new");
  assert.deepEqual(await loadHolds(dir), {}, "the named hold drops");
  await dropHold(dir, "missing", "x");
}
console.log("state.test: ok");

// The terminal mirror: only a stored choice answers here. No file, or an unreadable one, answers
// undefined so the caller keeps its own default rather than having one asserted over it — the read
// is asynchronous, and answering a value used to overwrite one set while it was in flight.
{
  const dir = await mkdtemp(join(tmpdir(), "omc-sync-"));
  assert.equal(await loadTerminalSync(dir), undefined, "no file: no stored choice");
  await saveTerminalSync(dir, false);
  assert.equal(await loadTerminalSync(dir), false, "off once stored false");
  await saveTerminalSync(dir, true);
  assert.equal(await loadTerminalSync(dir), true, "on once stored true");
  await writeFile(TERMINAL_SYNC_FILE(dir), "not json");
  assert.equal(await loadTerminalSync(dir), undefined, "a corrupt file is no choice either");
  console.log("terminal sync state ok");
}
