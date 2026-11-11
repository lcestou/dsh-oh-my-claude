// Stop asks the CLI to interrupt and kills it only when it does not obey. A step dsh closes before
// the CLI's answer arrives never sees that answer itself, and must not count as disobeyed.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { INTERRUPT_GRACE_MS } from "./turn.js";

const delta = {
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: "hi" },
};
const queue: unknown[] = [
  {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  },
  { type: "stream_event", event: delta },
];
let killed = 0;
const proc = {
  alive: true,
  busy: false,
  parked: undefined,
  steerPending: false,
  forwarded: 0,
  interruptOwed: false,
  spec: { child: "node" }, // no keeper: the one spawn mode with a kill after the grace
  relays: new Map(),
  sent: new Set(),
  steers: new Map(),
  queue: { lines: [] },
  queuedIndexes: [],
  idleKilled: false,
  exitCode: 0,
  stderr: "",
  stray: "",
  staleResults: 0,
  countStaleResults: () => 0,
  write: () => true,
  // Two frames, then silence: the turn is still running when Stop arrives.
  nextEvent: async () => (queue.length > 0 ? queue.shift() : new Promise(() => {})),
  kill: () => {
    killed += 1;
  },
};
const session = {
  header: { version: 0 },
  snapshotEvents: () => [
    { type: "turn/start", data: { turn: 1 } },
    { type: "step/start", data: { step: 1 } },
  ],
  append: () => ({ seq: 1 }),
};
// SAFETY: partial fakes; the step reads the session's log and nothing else of the context
const ctx = {
  on() {},
  sessions: { get: () => session },
} as unknown as PluginContext;
const a = new ClaudeCodeAdapter(ctx, Config({ resume: true, toolsInline: false }));
a.stateDir = mkdtempSync(join(tmpdir(), "omc-stop-grace-"));
const prep = {
  input: "go",
  spec: { model: "m" },
  cwd: "/tmp",
  session: undefined,
  args: [],
};
// SAFETY: the fakes below stand in for a spawned process and its side channels
const loose = a as unknown as Record<string, unknown>;
loose.acquire = async () => ({ prep, proc });
loose.reconnectIfStale = async () => {};
loose.watchTranscript = async () => {};
loose.pumpMirror = async () => {};
const stop = new AbortController();
const options = {
  sessionId: "s",
  model: "m",
  messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  signal: stop.signal,
};
// SAFETY: the options above are the fields a step reads
const gen = a.stream(options as unknown as Parameters<typeof a.stream>[0]);
await gen.next();
stop.abort();
await gen.return(undefined);
assert.equal(proc.interruptOwed, true, "the interrupt went out and its answer is owed");
// The CLI's answer lands with no turn reading; `noteIdleResult` settles the debt.
proc.interruptOwed = false;
await new Promise((r) => setTimeout(r, INTERRUPT_GRACE_MS + 300));
assert.equal(killed, 0, "a process that answered the interrupt is kept");
rmSync(a.stateDir, { recursive: true, force: true });
console.log("stop grace ok");
process.exit(0); // the fake's never-settling read would hold the run open
