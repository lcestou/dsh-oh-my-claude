// The bridge's plan-mode gate: plan mode refuses tools that can change something and keeps the
// read-only ones, other modes pass everything as before, and the mode is the one the CLI is in at
// call time, including a plan mode the CLI entered on its own after spawn.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { handleRpc } from "./mcp.js";
import { PLAN_REFUSAL, planRefuses } from "./plan-gate.js";
import { ClaudeProcess, statusMode } from "./process.js";

const agent = { id: "a1" };
const ran: string[] = [];
/** A dsh tool fake that records its own name when executed. */
const fake = (name: string) => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
  execute: () => {
    ran.push(name);
    return [{ type: "text", text: `ran ${name}` }];
  },
});
const registered = new Map(["bash", "subagent", "job_list"].map((n) => [n, fake(n)]));
// SAFETY: partial fake for tests
const tools = {
  schemas: () => [...registered.values()],
  get: (name: string) => registered.get(name),
};
let mode: string | undefined = "default";
// SAFETY: cast to HandleRpcParams shape for test double
const env = {
  tools,
  agent,
  signal: new AbortController().signal,
  version: "t",
  mode: () => mode,
  wait: () => Promise.resolve("waited"),
  prompt: () => Promise.resolve("prompted"),
} as unknown as Parameters<typeof handleRpc>[1];

type Reply = { result: { content: Array<{ text: string }>; isError?: boolean } };
let id = 1;
/** One tools/call through the bridge; returns its text and whether it was an error. */
const call = async (name: string) => {
  const r = (await handleRpc(
    { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: {} } },
    env,
  )) as Reply;
  return { text: r.result.content[0]?.text, isError: r.result.isError === true };
};

// Default mode: every tool runs as before.
for (const name of ["bash", "subagent", "job_list"]) {
  assert.deepEqual(await call(name), { text: `ran ${name}`, isError: false }, name);
}
assert.equal((await call("prompt_session")).text, "prompted");

// The session switches to plan after spawn: the next call reads the new mode.
mode = "plan";
ran.length = 0;
for (const name of [
  "bash",
  "subagent",
  "prompt_session",
  "mcp__svelte__playground-link",
  "new_tool",
])
  assert.deepEqual(await call(name), { text: PLAN_REFUSAL, isError: true }, `${name} refused`);
assert.deepEqual(ran, [], "nothing refused reached a tool");
assert.deepEqual(await call("job_list"), { text: "ran job_list", isError: false });
assert.equal((await call("wait_session")).text, "waited");

// Out of plan again: bash runs.
mode = "acceptEdits";
assert.equal((await call("bash")).text, "ran bash");
mode = undefined;
assert.equal((await call("bash")).text, "ran bash", "an unknown mode gates nothing");

assert.equal(planRefuses("run_code", "plan"), true, "code mode's program can call anything");
assert.equal(planRefuses("bash", "bypassPermissions"), false);

// statusMode reads the CLI's mode-change frame and the frame that opens each turn, nothing else.
const status = (permissionMode: string) =>
  JSON.stringify({ type: "system", subtype: "status", status: null, permissionMode });
assert.equal(statusMode(status("plan")), "plan");
assert.equal(statusMode('{"type":"system","subtype":"init","permissionMode":"plan"}'), "plan");
assert.equal(statusMode('{"type":"assistant","note":"init","permissionMode":"plan"}'), undefined);
assert.equal(statusMode('{"type":"system","subtype":"status","status":"compacting"}'), undefined);
assert.equal(statusMode('"permissionMode" "status" not json'), undefined);

// A live process follows a mode the CLI reports on its own (EnterPlanMode, an approved plan).
const stdout = new PassThrough();
const proc = new ClaudeProcess({
  args: [],
  cwd: "/tmp",
  command: "claude",
  spec: {
    cwd: "/tmp",
    model: undefined,
    effort: null,
    mode: "default",
    sessionId: null,
    temporary: false,
  },
  spawner: () => ({
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    done: new Promise(() => {}),
    terminate() {},
  }),
});
/** Writes one CLI stdout line and lets the readline handler see it. */
const feed = async (line: string) => {
  stdout.write(`${line}\n`);
  await new Promise((r) => setTimeout(r, 10));
};
assert.equal(proc.liveMode, "default");
await feed(status("plan"));
assert.equal(proc.liveMode, "plan", "EnterPlanMode's status frame moves liveMode");
await feed(status("default"));
assert.equal(proc.liveMode, "default", "an approved plan moves it back");
assert.equal(proc.spec.mode, "default", "the launch mode is left alone");
// A process adopted after a dsh restart starts from its launch mode; the next turn's init frame
// says what the CLI is really in, and the gate follows it.
await feed(JSON.stringify({ type: "system", subtype: "init", tools: [], permissionMode: "plan" }));
assert.equal(proc.liveMode, "plan", "the turn's init frame corrects a stale mode");
console.log("plan-gate ok");
process.exit(0);
