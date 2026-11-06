// dsh's compaction of a Claude session answered by Claude Code's own: the route, the `/compact`
// run on the session's CLI, the reuse of a summary the CLI already made, and the sync after it.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, Config, registryKey } from "../adapter.js";
import { asSessionId, type PluginContext } from "../dsh.js";
import type { ClaudeEvent, ClaudeProcess } from "../process.js";
import { cliMidTurn, compactionRoute, type CompactionFacts } from "./cli-compaction.js";

const facts = (o: Partial<CompactionFacts> = {}): CompactionFacts => ({
  enabled: true,
  pending: undefined,
  provider: "claude-code",
  ownProvider: "claude-code",
  mirrored: false,
  reachable: true,
  midTurn: false,
  justCompacted: false,
  switchPending: false,
  ...o,
});
const refusal = (o: Partial<CompactionFacts>) => {
  const route = compactionRoute(facts(o));
  return route.kind === "refuse" ? route : undefined;
};

assert.deepEqual(compactionRoute(facts()), { kind: "cli" });
assert.equal(compactionRoute(facts({ enabled: false, pending: "S" })).kind, "fallback");
assert.deepEqual(
  compactionRoute(
    facts({
      pending: "S",
      provider: "deepseek",
      mirrored: true,
      reachable: false,
      midTurn: true,
      justCompacted: true,
    }),
  ),
  { kind: "reuse", summary: "S" },
  "a pending summary serves any dsh compaction",
);
assert.equal(refusal({ midTurn: true })?.owe, true, "mid-turn: refused, compacted once idle");
assert.match(refusal({ midTurn: true })?.why ?? "", /mid-turn/);
assert.equal(refusal({ justCompacted: true })?.owe, false, "already compacted: nothing is owed");
assert.equal(refusal({ justCompacted: true, midTurn: true })?.owe, false);
assert.deepEqual(
  compactionRoute(facts({ midTurn: true, switchPending: true })),
  { kind: "fallback", why: "model switch pending" },
  "a failed compaction ahead of a switch fails the switch",
);
assert.equal(compactionRoute(facts({ justCompacted: true, switchPending: true })).kind, "fallback");
assert.deepEqual(
  compactionRoute(facts({ switchPending: true })),
  { kind: "cli" },
  "an idle CLI compacts ahead of a switch between Claude models",
);
assert.deepEqual(compactionRoute(facts({ provider: "deepseek", midTurn: true })), {
  kind: "fallback",
  why: "switching to deepseek",
});
assert.deepEqual(
  compactionRoute(facts({ provider: undefined })),
  { kind: "cli" },
  "an unreadable provider is not a switch",
);
assert.equal(compactionRoute(facts({ mirrored: true })).kind, "fallback");
assert.equal(compactionRoute(facts({ reachable: false })).kind, "fallback");

const idleCli = { busy: false, relays: { size: 0 }, parked: undefined };
assert.equal(cliMidTurn(idleCli), false);
assert.equal(cliMidTurn({ ...idleCli, busy: true }), true);
assert.equal(cliMidTurn({ ...idleCli, relays: { size: 1 } }), true);
assert.equal(cliMidTurn({ ...idleCli, parked: "steer" }), true);

const stateDir = await mkdtemp(join(tmpdir(), "omc-cli-compaction-"));
const resumeLog = () => readFile(join(stateDir, "resume.log"), "utf8").catch(() => "");
// SAFETY: partial fakes for tests; each carries what the code under test reads
const fakeCtx = (o: object): PluginContext => o as unknown as PluginContext;
const adapterWith = (ctx: object = {}, config: object = {}) => {
  const a = new ClaudeCodeAdapter(
    fakeCtx({ on() {}, logger: { info() {}, warn() {} }, ...ctx }),
    Config(config),
  );
  a.stateDir = stateDir;
  return a;
};
/** A session store answering one session: its header and its log's events. */
const sessionsWith = (
  header: object,
  events: object[] = [],
  ran: object = { provider: "claude-code", model: "claude-opus-5-5" },
) => ({
  get: () => ({
    header,
    snapshotEvents: () => events,
    requestHeader: () => ({ version: 1, config: ran }),
  }),
});

/** A live, idle CLI that answers `/compact` with `events`, then a result. */
const cliAnswering = (events: object[], o: object = {}) => {
  const written: string[] = [];
  let queue: object[] = [];
  const proc = {
    alive: true,
    busy: false,
    resuming: true,
    relays: new Map(),
    parked: undefined,
    steers: new Map(),
    queue: { lines: [] as string[] },
    spec: { cwd: "/work", sessionId: "claude-1" },
    lastUsed: 0,
    killed: false,
    kill() {
      this.killed = true;
    },
    write(line: string) {
      written.push(line);
      if (line.includes("/compact")) queue = [...events, { type: "result", subtype: "success" }];
      return true;
    },
    async nextEvent(): Promise<ClaudeEvent | null> {
      // SAFETY: the fixture's events are CLI frames written loosely
      return (queue.shift() as ClaudeEvent | undefined) ?? null;
    },
    ...o,
  };
  // SAFETY: partial fake; compactOnCli reads only the fields above
  return { proc: proc as unknown as ClaudeProcess & { killed: boolean }, written };
};
const boundary = {
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { pre_tokens: 1234 },
};

// A pending summary is handed over and taken; the CLI is not touched.
{
  const a = adapterWith();
  a.pendingCompactions.set("s1", "CLI summary");
  assert.equal(await a.compactionFromCli("s1"), "CLI summary");
  assert.equal(a.pendingCompactions.has("s1"), false, "taken once");
}

// Switched off: the one-shot summarizer answers, even with a summary pending.
{
  const a = adapterWith({}, { cliCompaction: false });
  a.pendingCompactions.set("s1", "CLI summary");
  assert.equal(await a.compactionFromCli("s1"), undefined);
}

// `/compact` on the live CLI: the boundary's preTokens pick the summary; the process ends idle.
{
  const a = adapterWith();
  const { proc, written } = cliAnswering([
    { type: "system", subtype: "status", status: "compacting" },
    { type: "control_request", request_id: "r1", request: { subtype: "hook_callback" } },
    boundary,
  ]);
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  const asked: unknown[] = [];
  a.compactSummary = async (...args) => {
    asked.push(args);
    return "fresh summary";
  };
  assert.equal(await a.compactionFromCli("s1"), "fresh summary");
  assert.match(written[0]!, /"\/compact"/, "the prompt is the CLI's own command");
  assert.match(written[1]!, /not supported while compacting/, "a control request is refused");
  assert.deepEqual(asked, [["/work", "claude-1", 1234]]);
  assert.equal(proc.busy, false);
  assert.equal(proc.killed, false, "the session's process stays for its next turn");

  // dsh still prices the prompt the last request reported, so it asks again in the same check:
  // refused until the next request reports the compacted one, and nothing is owed.
  await assert.rejects(a.compactionFromCli("s1"), /compacted this session already/);
  assert.equal(written.filter((l) => l.includes("/compact")).length, 1, "one /compact, not two");
  assert.equal(a.owedCompactions.has("s1"), false);
}

// A message dsh splices while its `/compact` runs stays in dsh's inbox: written to stdin, the CLI
// would run it as a turn of its own after the compaction, with nobody reading.
{
  const handlers: Record<string, (session: unknown, event: unknown) => void> = {};
  const a = adapterWith({
    on(name: string, fn: (session: unknown, event: unknown) => void) {
      handlers[name] = fn;
    },
  });
  const { proc, written } = cliAnswering([boundary], { sent: new Set<string>() });
  const next = proc.nextEvent.bind(proc);
  let compactingSeen = false;
  proc.nextEvent = async () => {
    compactingSeen ||= proc.compacting;
    handlers["session/event"]?.(
      { id: "s1" },
      {
        type: "agent/inbox/spliced",
        data: {
          target: "next-step",
          inserted: [
            {
              role: "user",
              source: { kind: "user", rpcId: "r1" },
              content: [{ type: "text", text: "and the docs" }],
            },
          ],
        },
      },
    );
    return next();
  };
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  a.compactSummary = async () => "fresh summary";
  assert.equal(await a.compactionFromCli("s1"), "fresh summary");
  assert.equal(compactingSeen, true);
  assert.equal(written.length, 1, "only /compact went to stdin");
  assert.equal(proc.compacting, false);
}

// A compaction the CLI reports failed, or one that never reached a boundary, is no summary.
for (const events of [
  [{ type: "system", subtype: "status", status: null, compact_result: "failed" }],
  [{ type: "assistant", message: { content: [] } }],
]) {
  const a = adapterWith();
  const { proc } = cliAnswering(events);
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  a.compactSummary = async () => "unused";
  assert.equal(await a.compactionFromCli("s1"), undefined);
  assert.equal(proc.busy, false);
}

// A CLI mid-turn is left alone: the request is refused and owed until the session is idle.
for (const state of [{ busy: true }, { relays: new Map([["t1", {}]]) }, { parked: "steer" }]) {
  const a = adapterWith();
  const { proc, written } = cliAnswering([boundary], state);
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  await assert.rejects(a.compactionFromCli("s1"), /mid-turn/);
  assert.deepEqual(written, []);
  assert.equal(a.owedCompactions.has("s1"), true);
}
assert.match(await resumeLog(), /compaction s1: refused, owed until idle: Claude Code is mid-turn/);

// The refusal reaches dsh as a failed stream, so its compaction fails at once and the step goes on.
{
  const a = adapterWith();
  const { proc } = cliAnswering([boundary], { busy: true });
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  const chunks: unknown[] = [];
  const run = async () => {
    for await (const c of a.stream({
      provider: "claude-code",
      model: "m",
      messages: [],
      sessionId: asSessionId("s1"),
      purpose: "compaction",
    }))
      chunks.push(c);
  };
  await assert.rejects(run(), /mid-turn/);
  assert.deepEqual(chunks, []);
}

// A model picked mid-turn: dsh may be compacting ahead of the switch, which a refusal would fail,
// so the one-shot summarizer answers. A pick that only changes the effort is no switch.
{
  const pick = (model: string) => [
    { type: "request/header", data: {} },
    { type: "model/selection", data: { provider: "claude-code", model } },
  ];
  const a = adapterWith({ sessions: sessionsWith({}, pick("claude-sonnet-5-5")) });
  const { proc, written } = cliAnswering([boundary], { busy: true });
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  assert.equal(await a.compactionFromCli("s1"), undefined);
  assert.deepEqual(written, []);
  assert.equal(a.owedCompactions.has("s1"), false);

  const same = adapterWith({ sessions: sessionsWith({}, pick("claude-opus-5-5")) });
  same.processes.set(registryKey(same.providerId, "s1"), proc);
  await assert.rejects(same.compactionFromCli("s1"), /mid-turn/);
}

// A subagent or team member is refused mid-turn too, but owes nothing: dsh settles it as soon as it
// is idle, so its next turn's start compacts instead.
{
  const a = adapterWith({ sessions: sessionsWith({ origin: "subagent" }) });
  const { proc } = cliAnswering([boundary], { busy: true });
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  await assert.rejects(a.compactionFromCli("s1"), /mid-turn/);
  assert.equal(a.owedCompactions.has("s1"), false);
}

// A Claude session that never finished a turn has nothing to compact and gets no prompt.
{
  const a = adapterWith();
  a.claudeHome = stateDir;
  const { proc, written } = cliAnswering([boundary], {
    resuming: false,
    spec: { cwd: "/work", sessionId: "never-started" },
  });
  a.processes.set(registryKey(a.providerId, "s1"), proc);
  assert.equal(await a.compactionFromCli("s1"), undefined);
  assert.deepEqual(written, []);
  assert.equal(proc.killed, false, "a process that was already running is not this call's to end");
}

// stream(): a compaction request answered from the pending summary, as plain text.
{
  const a = adapterWith();
  a.pendingCompactions.set("s1", "CLI summary");
  const chunks = [];
  for await (const c of a.stream({
    provider: "claude-code",
    model: "m",
    messages: [],
    sessionId: asSessionId("s1"),
    purpose: "compaction",
  })) {
    chunks.push(c);
  }
  assert.ok(JSON.stringify(chunks).includes("CLI summary"), "the summary is the answer");
  assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "stop" } });
}

// Each request clears the just-compacted mark, since its usage is what dsh prices next. A new
// Claude turn also drops a pending summary and an owed compaction; a relay or steer step, still
// inside the turn they belong to, keeps them.
for (const mode of ["relay", "steer", "prompt"] as const) {
  const a = adapterWith();
  for (const id of ["s1", "s2"]) {
    a.pendingCompactions.set(id, "CLI summary");
    a.owedCompactions.add(id);
    a.compactedSinceRequest.add(id);
  }
  const { proc } = cliAnswering([]);
  const options = {
    provider: "claude-code",
    model: "m",
    messages: [],
    sessionId: asSessionId("s1"),
  };
  // SAFETY: the fields turn() reads before it stops on the stand-in process
  a.continuationFor = () => ({ mode, proc, options, results: [] }) as never;
  a.acquire = async () => {
    throw new Error("stop here");
  };
  await assert.rejects(a.turn(options).next(), /stop here|no turn state/);
  const newTurn = mode === "prompt";
  assert.equal(a.compactedSinceRequest.has("s1"), false, mode);
  assert.equal(a.pendingCompactions.has("s1"), !newTurn, mode);
  assert.equal(a.owedCompactions.has("s1"), !newTurn, mode);
  assert.equal(a.pendingCompactions.get("s2"), "CLI summary", "another session's is kept");
  assert.equal(a.compactedSinceRequest.has("s2"), true);
}

// syncCompaction: once idle, dsh compacts its copy; nothing left to shadow drops the summary,
// `busy` waits for the next idle, any other failure drops it.
{
  type Compacted = { shadowedSeqs: number[]; shadowedTokenCount: number } | null;
  const calls: string[] = [];
  let answer: () => Promise<Compacted> = async () => ({ shadowedSeqs: [1], shadowedTokenCount: 9 });
  const agent = { whenIdle: async () => {} };
  const compaction = {
    compactNow: async () => {
      calls.push("compactNow");
      return answer();
    },
  };
  const a = adapterWith({
    agents: { get: () => agent },
    get: (name: string) => (name === "compaction" ? compaction : undefined),
  });
  const busy = Object.assign(new Error("busy"), { code: "busy" });

  await a.syncCompaction("s1");
  assert.deepEqual(calls, [], "nothing pending, nothing to sync");

  a.pendingCompactions.set("s1", "S");
  answer = async () => {
    a.pendingCompactions.delete("s1"); // compactionFromCli takes it during compactNow
    return { shadowedSeqs: [1], shadowedTokenCount: 9 };
  };
  await a.syncCompaction("s1");
  assert.deepEqual(calls, ["compactNow"]);

  a.pendingCompactions.set("s1", "S");
  answer = async () => null;
  await a.syncCompaction("s1");
  assert.equal(a.pendingCompactions.has("s1"), false, "dsh had nothing to compact");

  a.pendingCompactions.set("s1", "S");
  let first = true;
  answer = async () => {
    if (first) {
      first = false;
      throw busy;
    }
    a.pendingCompactions.delete("s1");
    return { shadowedSeqs: [1], shadowedTokenCount: 9 };
  };
  calls.length = 0;
  await a.syncCompaction("s1");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ["compactNow", "compactNow"], "busy retries after the next idle");

  // An agent that stays busy is retried once, not spun on; the summary waits for dsh's own trigger.
  a.pendingCompactions.set("s1", "S");
  answer = async () => {
    throw busy;
  };
  calls.length = 0;
  await a.syncCompaction("s1");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ["compactNow", "compactNow"]);
  assert.equal(a.pendingCompactions.get("s1"), "S");

  answer = async () => {
    throw new Error("summary rejected");
  };
  await a.syncCompaction("s1");
  assert.equal(a.pendingCompactions.has("s1"), false, "a failure drops the summary");

  // A compaction refused mid-turn is run once idle, then forgotten whatever its outcome.
  a.owedCompactions.add("s1");
  answer = async () => ({ shadowedSeqs: [1], shadowedTokenCount: 9 });
  calls.length = 0;
  await a.syncCompaction("s1");
  assert.deepEqual(calls, ["compactNow"]);
  assert.equal(a.owedCompactions.has("s1"), false);

  a.owedCompactions.add("s1");
  answer = async () => {
    throw new Error("summary rejected");
  };
  await a.syncCompaction("s1");
  assert.equal(a.owedCompactions.has("s1"), false, "a failure drops what was owed");
}

// Nothing runs on an idle subagent or team member: dsh is settling it, and its parent waits on that.
{
  const calls: string[] = [];
  const a = adapterWith({
    agents: { get: () => ({ whenIdle: async () => {} }) },
    sessions: sessionsWith({ origin: "subagent" }),
    get: (name: string) =>
      name === "compaction"
        ? {
            compactNow: async () => {
              calls.push("compactNow");
              return null;
            },
          }
        : undefined,
  });
  a.pendingCompactions.set("s1", "S");
  a.owedCompactions.add("s1");
  await a.syncCompaction("s1");
  assert.deepEqual(calls, []);
  assert.equal(a.pendingCompactions.get("s1"), "S", "kept for its next turn's start");
}

console.log("cli-compaction ok");
