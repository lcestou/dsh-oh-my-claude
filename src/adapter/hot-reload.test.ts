// A hot reload (profile edit, toggle, code update) mounts a fresh adapter in the same process while
// a step may still be streaming from the old one. The keeper that step reads must survive the new
// instance's adoption, the old instance must reach dsh through the new one's context, a step that
// still dies must be handed to the new instance, and an event builder that throws must not escape
// its timer (2026-11-12 23:43: the turn died, then dsh did).
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTER_CURRENT, type PluginContext } from "../dsh.js";
import { EventHub } from "../events.js";
import type { ClaudeProcess } from "../process.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { contextActive } from "./reload.js";
import { RELOAD_TEXT } from "./turn.js";
import { registryKey } from "./types.js";

// SAFETY: the registry symbol is the plugin's own key on globalThis, filled here as apply does
const g = globalThis as typeof globalThis & {
  [ADAPTER_CURRENT]?: Map<string, ClaudeCodeAdapter>;
};
const mounts = (g[ADAPTER_CURRENT] ??= new Map());

const session = {
  header: { version: 0 },
  snapshotEvents: () => [
    { type: "turn/start", data: { turn: 1 } },
    { type: "step/start", data: { step: 1 } },
  ],
  append: () => ({ seq: 1 }),
};
/** A fake plugin context with a cordis-like fiber, and a `sessions` that throws once the fiber is
 *  disposed, the way cordis answers an injected service on an inactive context. */
const scoped = (uid: number) => {
  const fiber = { uid: uid as number | null };
  const ctx = {
    on() {},
    fiber,
    get sessions() {
      if (fiber.uid === null)
        throw new Error('cannot get required service "sessions" in inactive context');
      return { get: () => session };
    },
  };
  // SAFETY: partial fake; the step reads the session's log through `sessions` and nothing else
  return { ctx: ctx as unknown as PluginContext, fiber };
};

{
  assert.equal(contextActive({}), true, "a context without a fiber (a test fake) is active");
  assert.equal(contextActive({ fiber: { uid: 4 } }), true, "a live fiber is active");
  assert.equal(contextActive({ fiber: { uid: null } }), false, "a disposed fiber is not");
}

// The old instance's context follows the instance mounted after it, and only once one is.
{
  const one = scoped(1);
  const a = new ClaudeCodeAdapter(one.ctx, Config({}));
  mounts.set(a.providerId, a);
  assert.equal(a.ctx, one.ctx, "a live scope answers with its own context");
  one.fiber.uid = null;
  assert.equal(a.scopeActive(), false);
  assert.equal(a.ctx, one.ctx, "disposed with no successor yet: still its own");
  const two = scoped(2);
  const b = new ClaudeCodeAdapter(two.ctx, Config({}));
  mounts.set(b.providerId, b);
  assert.equal(a.ctx, two.ctx, "disposed with a successor: the successor's");
  assert.doesNotThrow(() => a.ctx.sessions.get(asId("s")), "so its services answer again");
  assert.equal(b.ctx, two.ctx);
  mounts.delete(b.providerId);
}

/** dsh's session id brand, for the fakes' `get`. */
function asId(id: string): Parameters<PluginContext["sessions"]["get"]>[0] {
  // SAFETY: the fakes' `get` ignores its argument
  return id as unknown as Parameters<PluginContext["sessions"]["get"]>[0];
}

// A coalesced event whose builder throws is dropped; the hub keeps working.
{
  const hub = new EventHub();
  const written: string[] = [];
  // SAFETY: partial ServerResponse; attach writes headers and text, publish reads writableNeedDrain,
  // close ends it
  const res = {
    writeHead() {},
    write(t: string) {
      written.push(t);
      return true;
    },
    on() {},
    end() {},
    writableNeedDrain: false,
  } as unknown as Parameters<EventHub["attach"]>[0];
  hub.attach(res, "s", []);
  hub.coalesce(
    "idle:s",
    () => {
      throw new Error('cannot get required service "sessions" in inactive context');
    },
    1,
  );
  hub.coalesce("live-turn:s", () => ({ kind: "live-turn", session: "s", data: { n: 1 } }), 5);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(
    written.some((t) => t.startsWith("event: live-turn")),
    "the throw stayed in its timer and the next event went out",
  );
  assert.ok(!written.some((t) => t.startsWith("event: idle")), "the failed one sent nothing");
  hub.close();
}

/** A sleeping child standing in for a keeper's Claude, with a promise that settles on its exit. */
const fakeClaude = () => {
  const child: ChildProcess = spawn("sleep", ["60"], { stdio: "ignore" });
  const exited = new Promise<boolean>((r) => child.once("exit", () => r(true)));
  return { child, exited };
};
/** Settles true when `exited` does within `ms`, else false. */
const exitsWithin = (exited: Promise<boolean>, ms: number) =>
  Promise.race([exited, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

// Adoption after a hot reload leaves the keeper of a registered process alone, and still retires
// a genuinely older keeper behind one it adopts itself.
{
  const adapter = new ClaudeCodeAdapter(scoped(3).ctx, Config({}));
  adapter.stateDir = mkdtempSync(join(tmpdir(), "omc-hot-reload-"));
  const keeper = (name: string, sessionId: string, claudePid: number, startedAt: number) => {
    const dir = join(adapter.stateDir, "keepers", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "keeper.json"),
      // The test's own pid stands in for the keeper, so it reads as alive.
      JSON.stringify({ pid: process.pid, claudePid, sessionId, startedAt, exit: null }),
    );
    writeFileSync(
      join(dir, "spec.json"),
      JSON.stringify({
        command: "claude",
        args: [],
        cwd: "/tmp",
        env: {},
        sessionId,
        procSpec: { cwd: "/tmp", effort: null, mode: "default", sessionId, temporary: false },
      }),
    );
    return dir;
  };
  const live = fakeClaude();
  const fresh = fakeClaude();
  const stale = fakeClaude();
  // The previous instance's process for s-live, mid-turn, in the registry it shares with this one.
  const running = { alive: true, busy: true, relays: new Map(), lastUsed: Date.now(), kill() {} };
  // SAFETY: partial fake; adoption only asks the registry whether the key is there
  adapter.processes.set(registryKey("claude-code", "s-live"), running as unknown as ClaudeProcess);
  const liveDir = keeper("1111111111111111-a", "s-live", live.child.pid ?? -1, Date.now() - 5000);
  keeper("2222222222222222-b", "s-dup", fresh.child.pid ?? -1, Date.now());
  const staleDir = keeper("2222222222222222-a", "s-dup", stale.child.pid ?? -1, Date.now() - 9000);
  await adapter.adoptKeepers();
  assert.equal(
    await exitsWithin(live.exited, 300),
    false,
    "the keeper a running step reads keeps its Claude",
  );
  assert.ok(existsSync(liveDir), "and its directory");
  assert.equal(
    adapter.processes.get(registryKey("claude-code", "s-live")),
    running as unknown,
    "and the registered process stays the one in use",
  );
  assert.equal(await exitsWithin(stale.exited, 2000), true, "an older duplicate is still retired");
  assert.ok(!existsSync(staleDir));
  assert.equal(await exitsWithin(fresh.exited, 300), false, "behind the one this pass adopted");
  const log = readFileSync(join(adapter.stateDir, "resume.log"), "utf8");
  assert.match(log, /kept keeper 1111111111111111-a for s-live: its process outlived a hot reload/);
  for (const c of [live, fresh, stale]) c.child.kill("SIGKILL");
  adapter.processes.get(registryKey("claude-code", "s-dup"))?.kill();
  adapter.processes.delete(registryKey("claude-code", "s-live"));
  adapter.processes.delete(registryKey("claude-code", "s-dup"));
  rmSync(adapter.stateDir, { recursive: true, force: true });
}

/** A fake process that streams one text delta and then, on `die()`, reads as exited. */
const dyingProcess = () => {
  let finish: (v: null) => void = () => {};
  const frames: unknown[] = [
    {
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    },
    {
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    },
  ];
  const proc = {
    alive: true,
    busy: false,
    parked: undefined,
    steerPending: false,
    forwarded: 0,
    interruptOwed: false,
    spec: { child: "node" },
    relays: new Map(),
    sent: new Set(),
    steers: new Map(),
    queue: { lines: [] },
    queuedIndexes: [],
    idleKilled: false,
    exitCode: -1,
    stderr: "",
    stray: "",
    staleResults: 0,
    killed: 0,
    countStaleResults: () => 0,
    write: () => true,
    nextEvent: async () => {
      if (frames.length > 0) return frames.shift();
      if (!proc.alive) return null;
      return new Promise<null>((r) => (finish = r));
    },
    kill() {
      proc.killed++;
    },
  };
  const die = () => {
    proc.alive = false;
    finish(null);
  };
  return { proc, die };
};

/** Run one step on `a` with the fake process, let `between` happen once it is streaming, then end
 *  the process and drain the step. Returns the last chunk dsh would see. */
const runStep = async (a: ClaudeCodeAdapter, sessionId: string, between: () => void) => {
  const { proc, die } = dyingProcess();
  const prep = { input: "go", spec: { model: "m" }, cwd: "/tmp", session: undefined, args: [] };
  // SAFETY: the fakes below stand in for a spawned process and its side channels
  const loose = a as unknown as Record<string, unknown>;
  loose.acquire = async () => ({ prep, proc });
  loose.reconnectIfStale = async () => {};
  loose.watchTranscript = async () => {};
  loose.pumpMirror = async () => {};
  const options = {
    sessionId,
    model: "m",
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    signal: new AbortController().signal,
  };
  // SAFETY: the options above are the fields a step reads
  const gen = a.stream(options as unknown as Parameters<typeof a.stream>[0]);
  await gen.next();
  between();
  die();
  let last: unknown;
  for await (const chunk of gen) last = chunk;
  return { last, proc };
};
const busyIn = (dir: string): string[] => {
  try {
    return JSON.parse(readFileSync(join(dir, "busy.json"), "utf8"));
  } catch {
    return [];
  }
};

// A step that dies after a reload replaced its instance keeps its busy mark and is handed to the
// instance mounted now.
{
  const one = scoped(5);
  const a = new ClaudeCodeAdapter(one.ctx, Config({ resume: true, toolsInline: false }));
  a.stateDir = mkdtempSync(join(tmpdir(), "omc-hot-reload-"));
  mounts.set(a.providerId, a);
  const handed: string[] = [];
  let b: ClaudeCodeAdapter | undefined;
  // SAFETY: the resume's own timing, shortened for the suite
  (a as unknown as Record<string, unknown>).resumeAfterReload = (id: string) =>
    ClaudeCodeAdapter.prototype.resumeAfterReload.call(a, id, 10, 100);
  const { last } = await runStep(a, "s-orphan", () => {
    one.fiber.uid = null; // the reload disposes the old scope...
    b = new ClaudeCodeAdapter(scoped(6).ctx, Config({}));
    b.stateDir = a.stateDir;
    b.takeOverReloadedTurn = async (id: string) => {
      handed.push(id);
    };
    mounts.set(b.providerId, b); // ...and mounts the next instance
  });
  assert.match(JSON.stringify(last), /"kind":"error"/, "the step itself still fails");
  for (let i = 0; i < 50 && handed.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(handed, ["s-orphan"], "the new instance takes the session over");
  assert.deepEqual(busyIn(a.stateDir), ["s-orphan"], "the mark stays for it, or for the next boot");
  rmSync(a.stateDir, { recursive: true, force: true });
  if (b) mounts.delete(b.providerId);
}

// The same death on a live scope is an ordinary failure: the mark goes and nothing resumes.
{
  const c = new ClaudeCodeAdapter(scoped(7).ctx, Config({ resume: true, toolsInline: false }));
  c.stateDir = mkdtempSync(join(tmpdir(), "omc-hot-reload-"));
  mounts.set(c.providerId, c);
  let resumed = 0;
  c.resumeAfterReload = async () => {
    resumed++;
  };
  const { proc } = await runStep(c, "s-plain", () => {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(resumed, 0, "no reload, no resume");
  assert.deepEqual(busyIn(c.stateDir), [], "the busy mark is cleared");
  assert.equal(proc.killed, 1, "and the dead process is cleaned up as before");
  rmSync(c.stateDir, { recursive: true, force: true });
  mounts.delete(c.providerId);
}

// The takeover: a busy process needs nothing, a dead or missing one gets the reload notice, a live
// one with output waiting is drained with it.
{
  const b = new ClaudeCodeAdapter(scoped(8).ctx, Config({}));
  b.stateDir = mkdtempSync(join(tmpdir(), "omc-hot-reload-"));
  const woken: Array<[string, boolean, string | undefined]> = [];
  b.wake = async (id: string, proc: ClaudeProcess | undefined, text?: string) => {
    woken.push([id, proc !== undefined, text]);
    return true;
  };
  const put = (id: string, p: object) =>
    // SAFETY: partial fake; the takeover reads alive, busy and hasTurnOutput
    b.processes.set(registryKey("claude-code", id), p as unknown as ClaudeProcess);
  put("t-busy", { alive: true, busy: true, hasTurnOutput: () => true });
  put("t-live", { alive: true, busy: false, hasTurnOutput: () => true });
  await b.takeOverReloadedTurn("t-busy");
  await b.takeOverReloadedTurn("t-gone");
  await b.takeOverReloadedTurn("t-live");
  assert.deepEqual(woken, [
    ["t-gone", false, RELOAD_TEXT],
    ["t-live", true, RELOAD_TEXT],
  ]);
  b.processes.delete(registryKey("claude-code", "t-busy"));
  b.processes.delete(registryKey("claude-code", "t-live"));
  rmSync(b.stateDir, { recursive: true, force: true });
}

console.log("hot reload ok");
process.exit(0); // adopted keepers' attach retries and the fakes' reads would hold the run open
