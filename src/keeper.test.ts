import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { attachKeeper, pidAlive, readKeeperInfo, spawnKeeper } from "./process.js";

// A stand-in for claude: echoes each stdin line at once and again 300 ms later, exits on "quit".
const fake = `
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line === "quit") process.exit(3);
    process.stdout.write("echo:" + line + "\\n");
    setTimeout(() => process.stdout.write("late:" + line + "\\n"), 300);
  }
});
`;
const dir = mkdtempSync(join(tmpdir(), "omc-keeper-"));
const lines = (r: NodeJS.ReadableStream) => {
  const out: string[] = [];
  createInterface({ input: r, crlfDelay: Infinity }).on("line", (l) => out.push(l));
  return out;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const h1 = await spawnKeeper(
  dir,
  {
    command: process.execPath,
    args: ["-e", fake],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    sessionId: "s-test",
  },
  (argv) => {
    const c = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
    c.unref();
  },
);
const out1 = lines(h1.stdout);
h1.stdin.write("a\n");
await wait(500);
assert.deepEqual(out1, ["echo:a", "late:a"], "attached client sees both lines");
const info = readKeeperInfo(dir);
assert.ok(info && pidAlive(info.pid), "keeper alive with info file");
assert.equal(info.sessionId, "s-test");

// A second attach replaces the first (what a restarted dsh does) and gets what came after.
h1.stdin.write("b\n");
await wait(50);
const h2 = await attachKeeper(dir, 2000);
const out2 = lines(h2.stdout);
await wait(500);
assert.ok(out2.includes("late:b"), `second client received the late line: ${JSON.stringify(out2)}`);
h2.stdin.write("quit\n");
const exit = await h2.done;
assert.equal(exit.exitCode, 3, "exit code reaches the attached client");
await wait(100);
assert.equal(readKeeperInfo(dir)?.exit?.code, 3, "exit recorded in keeper.json");
// keeper.log records startup, attach/detach, kill, and child exit for post-mortem evidence
const logDir = mkdtempSync(join(tmpdir(), "omc-keeper-log-"));
await spawnKeeper(
  logDir,
  {
    command: process.execPath,
    args: ["-e", fake],
    cwd: logDir,
    env: { PATH: process.env.PATH ?? "" },
    sessionId: "s-log",
  },
  (argv) => {
    const c = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
    c.unref();
  },
);
await wait(100);
// Attach with a raw socket so we can explicitly close it and trigger the detach log.
const net = await import("node:net");
const sock = new net.Socket();
await new Promise<void>((resolve) => {
  sock.connect(join(logDir, "keeper.sock"), () => resolve());
});
sock.write(`${JSON.stringify({ t: "hello" })}\n`);
await wait(50);
sock.end();
await wait(100);
const logContent = readFileSync(join(logDir, "keeper.log"), "utf8");
assert.ok(logContent.includes("start pid="), "keeper.log has start line");
assert.ok(logContent.includes("attach buffered="), "keeper.log has attach line");
assert.ok(logContent.includes("detach buffered="), "keeper.log has detach line");
// The raw socket above replaced hLog's client, and the keeper destroyed the one it displaced.
// `hLog.terminate()` would write its kill into that dead socket, so the keeper would never hear
// it and would outlive the run holding its child (it ignores SIGTERM by design). Kill it over a
// live socket instead. 2026-09-14: 925 of these had piled up, one per test run.
const hLogKill = await attachKeeper(logDir, 2000);
hLogKill.terminate();
await hLogKill.done;
// Send kill to set endedBy=client, then check keeper.json.
const logDir2 = mkdtempSync(join(tmpdir(), "omc-keeper-log2-"));
const h4 = await spawnKeeper(
  logDir2,
  {
    command: process.execPath,
    args: ["-e", fake],
    cwd: logDir2,
    env: { PATH: process.env.PATH ?? "" },
    sessionId: "s-log2",
  },
  (argv) => {
    const c = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
    c.unref();
  },
);
await wait(50);
h4.terminate();
await h4.done;
await wait(100);
const info4 = readKeeperInfo(logDir2);
assert.equal(info4?.endedBy, "client", "endedBy is client after kill message");
console.log("keeper-log ok");

// A respawn into the same directory must attach to the new keeper, not the old one still
// listening for its last 3 s (the model-switch race of 2026-09-06).
const raceDir = mkdtempSync(join(tmpdir(), "omc-keeper-race-"));
const spawnInto = (d: string) =>
  spawnKeeper(
    d,
    {
      command: process.execPath,
      args: ["-e", fake],
      cwd: d,
      env: { PATH: process.env.PATH ?? "" },
      sessionId: "s-race",
    },
    (argv) => {
      const c = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
      c.unref();
    },
  );
const old = await spawnInto(raceDir);
const oldPid = readKeeperInfo(raceDir)?.pid;
old.terminate(); // the old keeper keeps listening for ~3 s after its child exits
const fresh = await spawnInto(raceDir);
const freshOut = lines(fresh.stdout);
fresh.stdin.write("c\n");
await wait(500);
const freshPid = readKeeperInfo(raceDir)?.pid;
assert.ok(freshPid && freshPid !== oldPid, `new keeper has its own pid (${oldPid} → ${freshPid})`);
assert.ok(
  freshOut.includes("echo:c"),
  `new handle talks to the new keeper: ${JSON.stringify(freshOut)}`,
);
fresh.terminate();
await fresh.done;
console.log("keeper-respawn ok");

// Leave no keeper behind: every handle above is ended here.
for (const h of [h1, h2]) {
  try {
    h.terminate();
  } catch {}
}
await Promise.race([h1.done, wait(3000)]);

// And prove it. A keeper survives its child by 3 s so an attached client can read the exit, so
// poll rather than assert once. Without this the leak above was invisible: the suite passed
// green while every run left a keeper and a `claude` behind for the box to accumulate.
const pids = [oldPid, ...[dir, logDir, logDir2, raceDir].map((d) => readKeeperInfo(d)?.pid)].filter(
  (p): p is number => typeof p === "number",
);
const deadline = Date.now() + 8000;
let alive = pids.filter((p) => pidAlive(p));
while (alive.length > 0 && Date.now() < deadline) {
  await wait(200);
  alive = pids.filter((p) => pidAlive(p));
}
assert.deepEqual(alive, [], `keepers outlived the test: ${alive.join(", ")}`);
console.log("keeper-cleanup ok");
