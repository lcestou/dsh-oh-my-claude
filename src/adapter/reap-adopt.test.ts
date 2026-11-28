// The idle reaper runs without the cap evict() applies before a spawn and spares a process with a
// background task; adoption leaves another dsh's keeper alone, keeps its boot nudge for it, and
// tags an untagged keeper it takes (#241).
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markBusy, takeInterrupted } from "../state.js";
import type { LiveTask } from "../translator.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { WAKE_TEXT } from "./turn.js";
import { registryKey } from "./types.js";
import { fakeClaudeProcess, fakePluginContext } from "../test-context.js";

const ctx = fakePluginContext({ on() {} });
const WEB = "/home/u/.dsh/profiles/web";

{
  // The constructor reads `get("profileContext")` and nothing else of it.
  const withProfile = fakePluginContext({ on() {}, services: { profileContext: { dir: WEB } } });
  const adapter = new ClaudeCodeAdapter(withProfile, Config({}));
  assert.equal(adapter.keeperOwner, WEB, "every instance takes the tag at construction");
}

{
  const adapter = new ClaudeCodeAdapter(ctx, Config({ maxProcesses: 2, processIdleMs: 10_000 }));

  /** A live process last used at `lastUsed`; `killed()` counts the kills it took. */
  const fake = (lastUsed: number, busy = false) => {
    let killed = 0;

    // reapIdle reads alive, busy, relays, parked and lastUsed, and calls kill.
    const proc = fakeClaudeProcess({
      busy,
      lastUsed,
      kill() {
        killed++;
      },
    });

    return { proc, killed: () => killed };
  };

  const stale = fake(Date.now() - 20_000);
  const busy = fake(Date.now() - 20_000, true);
  const tasked = fake(Date.now() - 20_000);
  const fresh = [fake(Date.now()), fake(Date.now()), fake(Date.now())];

  const put = (id: string, p: ReturnType<typeof fake>) =>
    adapter.processes.set(registryKey("claude-code", id), p.proc);

  put("stale", stale);
  put("busy", busy);
  put("tasked", tasked);
  fresh.forEach((p, i) => put(`fresh${i}`, p));

  // reapIdle reads endedAt only.
  const running: LiveTask = {
    id: "t1",
    description: "",
    backgrounded: true,
    status: "running",
    at: 1,
  };

  adapter.sessionTasks.set("tasked", new Map([["t1", running]]));
  adapter.reapIdle();
  assert.equal(stale.killed(), 1, "idle past processIdleMs: reaped");
  assert.equal(adapter.processes.has(registryKey("claude-code", "stale")), false);
  assert.equal(busy.killed(), 0, "mid-turn: kept however old");
  assert.equal(tasked.killed(), 0, "a background task still running: kept");
  assert.deepEqual(
    fresh.map((p) => p.killed()),
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
  // s-running had a turn going when the last dsh went down; its keeper only turns up for a later pass.
  await markBusy("s-running", true, join(adapter.stateDir, "busy.json"));
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

  // The boot resume takes the busy file at 10 s; adoption only read it.
  assert.deepEqual(
    await takeInterrupted(join(adapter.stateDir, "busy.json")),
    ["s-running"],
    "the boot resume still finds its mark: adoption only reads it",
  );

  // Reattach wakes only a turn that was running at shutdown: the session whose turn ended (a
  // Stop, an abort) has no busy mark and stays idle, however long its keeper kept running. These
  // keepers are found by a readopt pass after the boot resume emptied the file, so the mark comes
  // from what the first adoption read.
  const running = keeper("1111111111111111-c", "s-running");
  const stopped = keeper("2222222222222222-d", "s-stopped");
  const drained: Array<[string, string | undefined, boolean | undefined]> = [];
  adapter.drainAdopted = async (_proc, id, _every, _tries, text, ready) => {
    drained.push([id, text, ready?.()]);

    return false;
  };

  await adapter.adoptKeepers();
  assert.ok(adapter.processes.has(registryKey("claude-code", "s-stopped")), "still attached");
  assert.deepEqual(
    drained
      .map(([id, text]) => [id, text])
      .toSorted((x, y) => String(x[0]).localeCompare(String(y[0]))),
    [
      ["s-running", undefined],
      ["s-stopped", WAKE_TEXT],
    ],
    "the running turn gets the reconnect drain; the stopped one waits only for a reply of its own",
  );
  assert.equal(
    drained.find(([id]) => id === "s-stopped")?.[2],
    false,
    "and an empty queue holds no such reply",
  );
  assert.ok(existsSync(running) && existsSync(stopped));

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
  const written: Array<string> = [];

  // control() sets controlListener and calls write.
  const fake = fakeClaudeProcess({
    controlListener: stale,
    write: (line: string) => {
      written.push(line);

      return true;
    },
  });

  // The reply never comes; only the listener swap and the write are checked.
  void adapter.control(fake, { subtype: "get_settings" }, 10);
  assert.notEqual(
    fake.controlListener,
    stale,
    "the newest instance answers this process's replies",
  );
  assert.equal(written.length, 1);
}

console.log("reap-adopt ok");

process.exit(0);
