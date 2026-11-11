// A steer waiting on a tool result parks the step only once every call of the message has answered:
// not at the first result of a batch, and not at a result that belongs to a nested agent.
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";

const stateDir = mkdtempSync(join(tmpdir(), "omc-steer-park-"));

/** A process fed from `queue`: the frames a real CLI would write, in order, then end of stream. */
function fakeProc(queue: unknown[]) {
  return {
    alive: true,
    busy: false,
    parked: undefined as string | undefined,
    steerPending: true,
    forwarded: 1,
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
    nextEvent: async (ms?: number) =>
      queue.length > 0 ? queue.shift() : ms === undefined ? null : { type: "timeout" },
    kill() {},
  };
}

/** Run one step over `queue` and answer how many frames it left unread and whether it parked. */
async function step(queue: unknown[]) {
  const session = {
    header: { version: 0 },
    snapshotEvents: () => [
      { type: "turn/start", data: { turn: 1 } },
      { type: "step/start", data: { step: 1 } },
    ],
    append: () => ({ seq: 1 }),
  };
  const proc = fakeProc(queue);
  // SAFETY: partial fakes; the step reads the session's log and nothing else of the context
  const ctx = {
    on() {},
    sessions: { get: () => session },
  } as unknown as PluginContext;
  const a = new ClaudeCodeAdapter(
    ctx,
    Config({
      resume: true,
      toolActivity: true,
      toolsInline: false,
      dshTools: true,
    }),
  );
  a.stateDir = stateDir;
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
  const options = {
    sessionId: "s",
    model: "m",
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    signal: new AbortController().signal,
  };
  // SAFETY: the options above are the fields a step reads
  for await (const _ of a.stream(options as unknown as Parameters<typeof a.stream>[0])) void _;
  return { left: queue.length, parked: proc.parked };
}

const call = (id: string, name: string) => ({
  type: "tool_use",
  id,
  name,
  input: {},
});
const result = (id: string, parent: string | null = null) => ({
  type: "user",
  parent_tool_use_id: parent,
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content: `out ${id}` }],
  },
});

/** One partial frame of a streamed message, as `--include-partial-messages` sends them. */
const partial = (event: object) => ({ type: "stream_event", event });
/** The start and stop frames of a tool_use block at `index`. */
const block = (index: number, id: string) => [
  partial({
    type: "content_block_start",
    index,
    content_block: call(id, "Bash"),
  }),
  partial({ type: "content_block_stop", index }),
];

{
  // Two calls in one message, sent whole: one frame per block under one id, as the CLI does
  // without partial messages. The quick second call answers first; the first is still out.
  const batch = await step([
    { type: "assistant", message: { id: "m1", content: [call("b1", "Bash")] } },
    { type: "assistant", message: { id: "m1", content: [call("b2", "Bash")] } },
    result("b2"),
    result("b1"),
  ]);
  assert.deepEqual(batch, { left: 0, parked: "steer" }, "parks at the last result of the batch");
}
{
  // Streamed: the CLI runs a call as soon as its block closes, so the first result can land
  // before the second block has begun. The message is still open, so that is not the boundary.
  const streamed = await step([
    partial({ type: "message_start", message: { id: "m1" } }),
    ...block(0, "b1"),
    result("b1"),
    ...block(1, "b2"),
    partial({ type: "message_stop" }),
    result("b2"),
  ]);
  assert.deepEqual(streamed, { left: 0, parked: "steer" }, "a result inside an open message waits");
}
{
  // An agent's inner tool result is the agent's, not the message's: the Agent call is still out.
  const nested = await step([
    {
      type: "assistant",
      message: { id: "m1", content: [call("t1", "Agent")] },
    },
    {
      type: "assistant",
      parent_tool_use_id: "t1",
      message: { id: "m2", content: [call("n1", "Read")] },
    },
    result("n1", "t1"),
    result("t1"),
  ]);
  assert.deepEqual(nested, { left: 0, parked: "steer" }, "parks at the Agent's own result");
}
rmSync(stateDir, { recursive: true, force: true });
console.log("steer park ok");
