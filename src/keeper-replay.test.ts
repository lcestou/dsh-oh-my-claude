// A reply a shutting-down dsh read but never used reaches the next dsh (automagik#62). The old
// dsh stays attached to the keeper until it exits, reading Claude's lines with no turn left to
// use them; the keeper used to forget a line once sent, so the restarted dsh's replay was empty
// and the reply was gone. Now a line stays until a turn acknowledges it.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { attachKeeper, pidAlive, readKeeperInfo, spawnKeeper } from "./process.js";

// A stand-in for claude: on "go", a turn's five lines, the last one its result.
const fake = `
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  if (!String(d).includes("go")) return;
  ["system", "assistant-1", "tool", "assistant-2", "result"].forEach((name, i) =>
    setTimeout(() => process.stdout.write(JSON.stringify({ type: name }) + "\\n"), 40 * i));
});
`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines = (r: NodeJS.ReadableStream) => {
  const out: string[] = [];
  createInterface({ input: r, crlfDelay: Infinity }).on("line", (l) =>
    out.push(JSON.parse(l).type),
  );
  return out;
};

const dir = mkdtempSync(join(tmpdir(), "omc-replay-"));
const a = await spawnKeeper(
  dir,
  {
    command: process.execPath,
    args: ["-e", fake],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    sessionId: "s-replay",
  },
  (argv) => {
    const c = spawn(argv[0] ?? "", argv.slice(1), { detached: true, stdio: "ignore" });
    c.unref();
  },
);
// Client A: reads every line, but its turn uses only the first two, then dsh shuts down.
const seenByA = lines(a.stdout);
a.stdin.write("go\n");
await wait(600);
assert.deepEqual(
  seenByA,
  ["system", "assistant-1", "tool", "assistant-2", "result"],
  "A read the whole turn",
);
a.ack?.(0);
a.ack?.(1);
await wait(100);

// Client B, the restarted dsh, replaces A and is replayed what no turn used.
const b = await attachKeeper(dir, 2000);
const seenByB = lines(b.stdout);
await wait(400);
assert.deepEqual(
  seenByB,
  ["tool", "assistant-2", "result"],
  "B gets the lines A read but never used, and only those",
);

// Used by B, they are gone: the next attach gets nothing again.
b.ack?.(0);
b.ack?.(1);
b.ack?.(2);
await wait(100);
const c = await attachKeeper(dir, 2000);
const seenByC = lines(c.stdout);
await wait(300);
assert.deepEqual(seenByC, [], "a line a turn used is not replayed");
console.log("keeper-replay ok");

c.terminate();
await Promise.race([c.done, wait(3000)]);
const pid = readKeeperInfo(dir)?.pid;
const deadline = Date.now() + 8000;
const keeperAlive = () => pid !== undefined && pidAlive(pid);
while (keeperAlive() && Date.now() < deadline) await wait(200);
assert.ok(!keeperAlive(), "the keeper is gone");
rmSync(dir, { recursive: true, force: true });
