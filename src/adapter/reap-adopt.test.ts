// The idle reaper runs without the cap evict() applies before a spawn and spares a process with a
// background task; adoption leaves another dsh's keeper alone, keeps its boot nudge for it, and
// tags an untagged keeper it takes (#241).
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import type { ClaudeProcess } from "../process.js";
import { markBusy, takeInterrupted } from "../state.js";
import type { LiveTask } from "../translator.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { registryKey } from "./types.js";

// SAFETY: partial fake; nothing here reaches past `on`
const ctx = { on() {} } as unknown as PluginContext;
const WEB = "/home/u/.dsh/profiles/web";

{
  // SAFETY: partial fake; the constructor reads `get("profileContext")` and nothing else of it
  const withProfile = { on() {}, get: () => ({ dir: WEB }) } as unknown as PluginContext;
  const adapter = new ClaudeCodeAdapter(withProfile, Config({}));
  assert.equal(adapter.keeperOwner, WEB, "every instance takes the tag at construction");
}

{
  const adapter = new ClaudeCodeAdapter(ctx, Config({ maxProcesses: 2, processIdleMs: 10_000 }));
  const fake = (lastUsed: number, busy = false) => {
    const p = {
      alive: true,
      busy,
      relays: new Map(),
      lastUsed,
      killed: 0,
      kill() {
        p.killed++;
      },
    };
    return p;
  };
  const stale = fake(Date.now() - 20_000);
  const busy = fake(Date.now() - 20_000, true);
  const tasked = fake(Date.now() - 20_000);
  const fresh = [fake(Date.now()), fake(Date.now()), fake(Date.now())];
  const put = (id: string, p: ReturnType<typeof fake>) =>
    // SAFETY: partial fake; reapIdle reads alive, busy, relays, parked and lastUsed, and calls kill
    adapter.processes.set(registryKey("claude-code", id), p as unknown as ClaudeProcess);
  put("stale", stale);
  put("busy", busy);
  put("tasked", tasked);
  fresh.forEach((p, i) => put(`fresh${i}`, p));
  // SAFETY: partial LiveTask; reapIdle reads endedAt only
  const running = { id: "t1", status: "running", at: 1 } as unknown as LiveTask;
  adapter.sessionTasks.set("tasked", new Map([["t1", running]]));
  adapter.reapIdle();
  assert.equal(stale.killed, 1, "idle past processIdleMs: reaped");
  assert.equal(adapter.processes.has(registryKey("claude-code", "stale")), false);
  assert.equal(busy.killed, 0, "mid-turn: kept however old");
  assert.equal(tasked.killed, 0, "a background task still running: kept");
  assert.deepEqual(
    fresh.map((p) => p.killed),
    [0, 0, 0],
    "no cap here: three live processes over maxProcesses 2 all stay",
  );
}

{
  const adapter = new ClaudeCodeAdapter(ctx, Config({}));
  adapter.keeperOwner = WEB;
  // A live keeper record (this test's own pid stands in for the keeper and for its Claude, so both
  // read as alive) in a directory of its own.
  const keeper = (name: string, sessionId: string, owner?: string) => {
    const dir = join(adapter.stateDir, "keepers", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "keeper.json"),
      JSON.stringify({
        pid: process.pid,
        claudePid: process.pid,
        sessionId,
        startedAt: Date.now(),
        exit: null,
        endedBy: null,
      }),
    );
    writeFileSync(
      join(dir, "spec.json"),
      JSON.stringify({
        command: "claude",
        args: [],
        cwd: "/tmp",
        env: {},
        sessionId,
        owner,
        procSpec: { cwd: "/tmp", effort: null, mode: "default", sessionId, temporary: false },
      }),
    );
    return dir;
  };
  const foreign = keeper("0123456789abcdef-a", "s-foreign", "/home/u/.dsh/profiles/desktop");
  const old = keeper("fedcba9876543210-b", "s-old");
  await adapter.adoptKeepers();
  assert.equal(
    adapter.processes.has(registryKey("claude-code", "s-foreign")),
    false,
    "another dsh's keeper is not adopted",
  );
  assert.ok(existsSync(foreign), "and its directory stays");
  assert.ok(adapter.processes.has(registryKey("claude-code", "s-old")), "an untagged one is");
  assert.equal(
    JSON.parse(readFileSync(join(old, "spec.json"), "utf8")).owner,
    WEB,
    "and takes this dsh's tag",
  );

  // The boot nudge: the foreign session's turn runs under the other dsh, so it is neither woken
  // here nor dropped from the list that dsh reads at its own boot.
  const busyPath = join(adapter.stateDir, "busy.json");
  await markBusy("s-foreign", true, busyPath);
  let woken = 0;
  adapter.wake = async () => {
    woken++;
    return true;
  };
  await adapter.resumeInterrupted(busyPath);
  assert.equal(woken, 0, "the other dsh's session is not nudged from here");
  assert.deepEqual(await takeInterrupted(busyPath), ["s-foreign"], "and stays listed for it");

  // A busy session with no live keeper and no session here (the other dsh's, its keeper gone, or
  // that dsh running with the switch off): the wake finds nothing, and the id stays listed for the
  // dsh that owns it instead of being dropped.
  await markBusy("s-elsewhere", true, busyPath);
  // A second boot within a minute is the crash-loop backoff, which leaves busy.json untouched.
  rmSync(join(adapter.stateDir, "boot.json"), { force: true });
  adapter.wake = async () => false;
  await adapter.resumeInterrupted(busyPath);
  assert.deepEqual(await takeInterrupted(busyPath), ["s-elsewhere"], "an unwakeable nudge is kept");
}

{
  // A process outlives a server hot reload; the new instance's control() must take its replies.
  const adapter = new ClaudeCodeAdapter(ctx, Config({}));
  const stale = () => false;
  const written: string[] = [];
  const fake = {
    controlListener: stale,
    write: (line: string) => {
      written.push(line);
      return true;
    },
  };
  // SAFETY: partial fake; control() sets controlListener and calls write
  void adapter.control(fake as unknown as ClaudeProcess, { subtype: "get_settings" }, 10);
  assert.notEqual(
    fake.controlListener,
    stale,
    "the newest instance answers this process's replies",
  );
  assert.equal(written.length, 1);
}
console.log("reap-adopt ok");
process.exit(0);
