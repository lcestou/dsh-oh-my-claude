// The hook script end to end, as the CLI runs it: a background child that keeps the output pipe
// open does not hold a passing run, a failure blocks with the tagged reason, and a session that
// asks before commands runs nothing.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "omc-gate-hook-"));
const gatePath = join(dir, "gate.json");
const runPath = join(dir, "run.json");
const hook = fileURLToPath(new URL("./test-gate-hook.ts", import.meta.url));
/** Run the hook once with `command` saved for `dir` and the given hook input; answer its stdout,
 *  the run file's state and how long it took. */
const stop = (command: string, input: object) => {
  writeFileSync(
    gatePath,
    JSON.stringify({ [dir]: { enabled: true, command, tries: 2, timeoutSec: 20 } }),
  );
  const t0 = Date.now();
  const out = spawnSync(process.execPath, [hook, gatePath, runPath, dir, "60"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 15_000,
  });
  // SAFETY: the hook writes the run file as JSON with a string `state`
  const run = JSON.parse(readFileSync(runPath, "utf8")) as { state: string };
  return { stdout: out.stdout, state: run.state, ms: Date.now() - t0 };
};
const full = { permission_mode: "bypassPermissions", stop_hook_active: false };

const bg = stop("sleep 30 & exit 0", full);
assert.equal(bg.state, "passed");
assert.ok(bg.ms < 5000, `a background child held the run for ${bg.ms} ms`);
const failed = stop("echo broke; exit 1", full);
assert.equal(failed.state, "fixing");
assert.match(failed.stdout, /"decision":"block"/);
assert.match(failed.stdout, /\[test gate 1\/2\]/);
const held = stop("echo broke; exit 1", {
  permission_mode: "acceptEdits",
  stop_hook_active: false,
});
assert.deepEqual([held.state, held.stdout], ["held", ""], "acceptEdits runs nothing");
// A command that writes a lot and exits at once: the last line it wrote is what Claude most needs,
// and it must still be in the tail after the pipes drain.
const burst = stop("seq 1 200000; echo LAST-LINE-MARK; exit 1", full);
assert.match(burst.stdout, /LAST-LINE-MARK/, "the end of a fast failure's output is kept");
console.log("test-gate hook ok");
