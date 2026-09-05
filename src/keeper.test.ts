import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
console.log("keeper ok");
