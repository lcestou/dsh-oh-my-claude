// A keeper nobody attaches to ends its Claude once `orphanMs` passes with no output (#241), by
// closing Claude's stdin; one with a dsh attached does not. The stand-in for claude exits when its
// stdin closes, as `claude -p` does.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive, readKeeperInfo, spawnKeeper } from "./process.js";
import { tempDir } from "./test-tmp.js";

const fake = `process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const launch = (argv: string[]) => {
  const c = spawn(argv[0] ?? "", argv.slice(1), { detached: true, stdio: "ignore" });
  c.unref();
};
const specFor = (dir: string, orphanMs: number) => ({
  command: process.execPath,
  args: ["-e", fake],
  cwd: dir,
  env: { PATH: process.env.PATH ?? "" },
  sessionId: "s-orphan",
  orphanMs,
});
const info = (dir: string) => {
  try {
    return JSON.parse(readFileSync(join(dir, "keeper.json"), "utf8"));
  } catch {
    return undefined;
  }
};
const until = async (ok: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!ok() && Date.now() < deadline) await wait(100);
  return ok();
};

// Nobody ever attaches (the dsh that started it died first): Claude is ended.
const lone = tempDir("omc-orphan-");
writeFileSync(join(lone, "spec.json"), JSON.stringify(specFor(lone, 300)));
launch([process.execPath, fileURLToPath(new URL("./keeper.js", import.meta.url)), lone]);
assert.ok(await until(() => Boolean(info(lone)?.exit), 6000), "an orphaned keeper ends its claude");
assert.equal(readKeeperInfo(lone)?.endedBy, "orphan", "and the boot that finds it reads why");
assert.deepEqual(info(lone)?.exit, { code: 0, signal: null }, "by closing stdin, not a signal");

// A dsh attached the whole time: nothing ends.
const held = tempDir("omc-orphan-");
const h = await spawnKeeper(held, specFor(held, 1500), launch);
await wait(2500);
assert.equal(info(held)?.exit, null, "an attached keeper is not an orphan");
console.log("keeper-orphan ok");

h.terminate();
const pids = [info(lone)?.pid, info(held)?.pid];
assert.ok(
  await until(() => pids.every((p) => typeof p !== "number" || !pidAlive(p)), 8000),
  "both keepers gone",
);
rmSync(lone, { recursive: true, force: true });
rmSync(held, { recursive: true, force: true });
