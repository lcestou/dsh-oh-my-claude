// A prompt written to a Claude Code process that is still inside a turn of its own (an adopted
// keeper that kept working while dsh restarted) is answered only after that turn's result. The
// step has to read past that result to the prompt's own reply. It used to end on it: the reply
// then ran in a Claude turn no dsh turn read, and in a subagent's session, where dsh holds no live
// agent once the turn ends, every dsh tool call in it failed with "no live agent".
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { PluginContext } from "../dsh.js";
import { ClaudeProcess } from "../process.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";

const stateDir = mkdtempSync(join(tmpdir(), "omc-prompt-behind-turn-"));
const tick = () => new Promise((r) => setTimeout(r, 10));

/** A real process over fake pipes; `onPrompt` runs when a prompt reaches its stdin. */
function liveProc(onPrompt: (out: PassThrough) => void) {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  stdin.on("data", () => onPrompt(stdout));
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
      stdin,
      stdout,
      stderr: new PassThrough(),
      done: new Promise(() => {}),
      terminate() {},
    }),
  });
  const print = async (frame: object) => {
    stdout.write(`${JSON.stringify(frame)}\n`);
    await tick();
  };
  return { proc, print };
}

const say = (id: string, text: string) => ({
  type: "assistant",
  message: { id, role: "assistant", content: [{ type: "text", text }] },
});
const done = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  stop_reason: "end_turn",
});

{
  // What the process knows about the CLI's turn, from the lines it prints.
  const { proc, print } = liveProc(() => {});
  assert.equal(proc.countStaleResults(), 0, "a fresh process owes nothing");
  await print({ type: "system", subtype: "init" });
  await print({ type: "control_request", request_id: "r1", request: { subtype: "x" } });
  assert.equal(proc.countStaleResults(), 0, "notices and host requests open no turn");
  proc.queue.lines.length = 0;
  await print(say("m1", "working"));
  assert.equal(proc.countStaleResults(), 1, "a turn still running owes its result");
  proc.queue.lines.length = 0;
  assert.equal(proc.countStaleResults(), 1, "even once its frames are read");
  await print(done("ok"));
  assert.equal(proc.countStaleResults(), 1, "its result queued: one, counted once");
  await print(say("m2", "a turn of its own after a background task"));
  assert.equal(proc.countStaleResults(), 2, "a queued result and another turn running");
  proc.queue.lines.length = 0;
  await print(done("ok"));
  proc.queue.lines.length = 0;
  assert.equal(proc.countStaleResults(), 0, "every turn ended and read");
}

{
  // The restart case end to end: the CLI is mid-turn when the turn's prompt goes out.
  const { proc, print } = liveProc((out) => {
    const lines = [
      done("I've been cut off"),
      say("m2", "picking up where I was"),
      done("picking up where I was"),
    ];
    for (const l of lines) out.write(`${JSON.stringify(l)}\n`);
  });
  await print(say("m1", "I've been cut off"));
  const session = {
    header: { version: 0 },
    snapshotEvents: () => [
      { type: "turn/start", data: { turn: 2 } },
      { type: "step/start", data: { step: 1 } },
    ],
    append: () => ({ seq: 1 }),
  };
  // SAFETY: partial fakes; the step reads the session's log and nothing else of the context
  const ctx = { on() {}, sessions: { get: () => session } } as unknown as PluginContext;
  const a = new ClaudeCodeAdapter(ctx, Config({ resume: true }));
  a.stateDir = stateDir;
  const prep = {
    input: "continue\n",
    spec: { model: "m" },
    cwd: "/tmp",
    session: undefined,
    args: [],
  };
  // SAFETY: the fakes below stand in for acquiring the process and its side channels
  const loose = a as unknown as Record<string, unknown>;
  loose.acquire = async () => ({ prep, proc });
  loose.reconnectIfStale = async () => {};
  loose.watchTranscript = async () => {};
  loose.pumpMirror = async () => {};
  const options = {
    sessionId: "child",
    model: "m",
    messages: [{ role: "user", content: [{ type: "text", text: "continue" }] }],
    signal: new AbortController().signal,
  };
  const drawn: string[] = [];
  // SAFETY: the options above are the fields a step reads
  for await (const chunk of a.stream(options as unknown as Parameters<typeof a.stream>[0]))
    drawn.push(JSON.stringify(chunk));
  const all = drawn.join("\n");
  assert.ok(all.includes("picking up where I was"), "the step draws the prompt's own reply");
  assert.equal(proc.queue.lines.length, 0, "nothing is left for a turn nobody reads");
  assert.equal(proc.countStaleResults(), 0, "and the CLI owes no result afterwards");
  proc.kill();
}

rmSync(stateDir, { recursive: true, force: true });
console.log("prompt behind a running turn ok");
