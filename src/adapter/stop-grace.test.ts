// Stop asks the CLI to interrupt and kills it only when it does not obey. A step dsh closes before
// the CLI's answer arrives never sees that answer itself, and must not count as disobeyed.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeEvent, ClaudeStreamPartial } from "../process.js";
import {
  fakeClaudeProcess,
  fakePluginContext,
  fakePrep,
  stepSession,
  userTurn,
} from "../test-context.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { INTERRUPT_GRACE_MS } from "./turn.js";
import { setTimeout as sleep } from "node:timers/promises";

const delta: ClaudeStreamPartial = {
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: "hi" },
};

const queue: Array<ClaudeEvent> = [
  {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    },
  },
  { type: "stream_event", event: delta },
];

let killed = 0;

const proc = fakeClaudeProcess({
  busy: false,
  parked: undefined,
  steerPending: false,
  forwarded: 0,
  interruptOwed: false,
  spec: { child: "node" }, // no keeper: the one spawn mode with a kill after the grace
  idleKilled: false,
  // The old fakes carried both: alive, with an exit code already set.
  alive: true,
  exitCode: 0,
  staleResults: 0,
  countStaleResults: () => 0,
  write: () => true,
  // Two frames, then silence: the turn is still running when Stop arrives.
  nextEvent: async () => queue.shift() ?? new Promise<never>(() => {}),
  kill: () => {
    killed += 1;
  },
});

// The step reads the session's log and nothing else of the context.
const ctx = fakePluginContext({
  on() {},
  sessions: { get: () => stepSession() },
  agents: { get: () => undefined },
});

const a = new ClaudeCodeAdapter(ctx, Config({ resume: true, toolsInline: false }));

a.stateDir = mkdtempSync(join(tmpdir(), "omc-stop-grace-"));

const prep = fakePrep();

// The fakes below stand in for a spawned process and its side channels.
a.acquire = async () => ({ prep, proc });

a.reconnectIfStale = async () => {};

a.watchTranscript = async () => {};

a.pumpMirror = async () => {};

const stop = new AbortController();

const gen = a.stream(userTurn("s", "go", { signal: stop.signal }));

await gen.next();

stop.abort();

await gen.return(undefined);

assert.equal(proc.interruptOwed, true, "the interrupt went out and its answer is owed");

// The CLI's answer lands with no turn reading; `noteIdleResult` settles the debt.
proc.interruptOwed = false;

await sleep(INTERRUPT_GRACE_MS + 300);

assert.equal(killed, 0, "a process that answered the interrupt is kept");

rmSync(a.stateDir, { recursive: true, force: true });

console.log("stop grace ok");

process.exit(0); // the fake's never-settling read would hold the run open
