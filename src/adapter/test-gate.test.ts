// The run watcher: a run the hook writes through its temp file and rename reaches `onRun` once,
// under the session id its file is named for; a temp name never does.
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestGateRun } from "../test-gate.js";
import { writeJsonAtomic } from "../test-gate-files.js";
import { watchRuns } from "./test-gate.js";

const dir = join(mkdtempSync(join(tmpdir(), "omc-gate-")), "runs");
const seen: [string, string][] = [];
const stop = watchRuns(dir, (session, run) => seen.push([session, run.state]));
const run: TestGateRun = {
  state: "fixing",
  attempt: 1,
  tries: 3,
  command: "x",
  startedAt: 1,
  tail: "",
};
// The hook's temp file holds the whole run before its rename; only the final name counts.
await writeFile(join(dir, "s1.json.123.tmp"), JSON.stringify(run));
await writeJsonAtomic(join(dir, "s1.json"), run);
// Poll the condition, not a fixed sleep: a loaded box delivers inotify late.
for (let i = 0; i < 400 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
await new Promise((r) => setTimeout(r, 120));
stop();
assert.deepEqual(seen, [["s1", "fixing"]]);
console.log("adapter test-gate ok");
