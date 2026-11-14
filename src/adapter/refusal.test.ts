// `refusalAsFailure`, on hand-written frames shaped like Claude Code 2.1.323's refusal output (the
// Agent SDK's SDKModelRefusalNoFallbackMessage, the assistant error frame and the result that
// follow): no real refusal is ever provoked to test this. Off, a refusal ends the turn as before;
// on, it is a failure with code REFUSAL, and the refused Claude session is dropped.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import type { ClaudeEvent, ClaudeProcess } from "../process.js";
import { loadStarted, rememberStarted } from "../state.js";
import { REFUSAL_CODE, Translator } from "../translator.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { projectDirName } from "./transcript-watch.js";

// SAFETY: hand-written fixtures in the CLI's stream-json shapes; the union type is not exhaustive
const frames = [
  {
    type: "system",
    subtype: "model_refusal_no_fallback",
    original_model: "claude-test-1",
    request_id: "req_1",
    api_refusal_category: "test",
    api_refusal_explanation: null,
    content: "This request was declined.",
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", role: "assistant", content: [], stop_reason: "refusal" },
  },
] as unknown as ClaudeEvent[];
// SAFETY: hand-written result frame
const result = (isError: boolean) =>
  ({
    type: "result",
    is_error: isError,
    stop_reason: "refusal",
    usage: { input_tokens: 1, output_tokens: 0 },
  }) as unknown as ClaudeEvent;

/** The finish reason a translator ends the fixture turn with. */
const finish = (refusalAsFailure: boolean, isError: boolean, events = frames) => {
  const tr = new Translator({ refusalAsFailure });
  for (const e of events) tr.translate(e);
  const last = tr.translate(result(isError)).at(-1);
  assert.equal(last?.type, "finish");
  return { tr, reason: last?.type === "finish" ? last.reason : undefined };
};

{
  const { reason } = finish(false, false);
  assert.equal(reason?.kind, "stop", "off: a refusal ends the turn as it always did");
}
for (const isError of [false, true]) {
  const { tr, reason } = finish(true, isError);
  assert.equal(reason?.kind, "error");
  assert.ok(reason?.kind === "error");
  assert.equal(reason.failure.code, REFUSAL_CODE);
  assert.match(reason.failure.message, /declined to answer \(test\): This request was declined\./);
  assert.ok(tr.refusal);
}
{
  // An older CLI without the system frame: the error frame alone is enough.
  const { reason } = finish(true, true, frames.slice(1));
  assert.ok(reason?.kind === "error" && reason.failure.code === REFUSAL_CODE);
}
{
  // A subagent's refused reply is the subagent's: the parent turn ends normally.
  // SAFETY: hand-written fixture
  const child = [{ ...frames[1], parent_tool_use_id: "toolu_1" }] as unknown as ClaudeEvent[];
  const tr = new Translator({ refusalAsFailure: true });
  for (const e of child) tr.translate(e);
  // SAFETY: hand-written fixture
  const end = tr.translate({ type: "result", is_error: false, stop_reason: "end_turn" } as never);
  const last = end.at(-1);
  assert.ok(last?.type === "finish" && last.reason.kind === "stop");
}

// The refused session's transcript, its folder and its started mark go; nothing else does.
{
  const home = mkdtempSync(join(tmpdir(), "omc-refusal-"));
  // SAFETY: partial fake; the constructor reads nothing past `on`
  const adapter = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, Config({}));
  adapter.claudeHome = home;
  const dir = join(home, "projects", projectDirName("/w"));
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  writeFileSync(join(dir, "s1.jsonl"), "{}\n");
  writeFileSync(join(dir, "s2.jsonl"), "{}\n");
  await rememberStarted("s1", true);
  let killed = 0;
  // SAFETY: partial fake; dropRefused reads kill and child.done
  const proc = {
    kill: () => killed++,
    child: { done: Promise.resolve({ exitCode: 0, signal: null }) },
  } as unknown as ClaudeProcess;
  await adapter.dropRefused(proc, "/w", "s1");
  assert.equal(killed, 1);
  assert.equal(existsSync(join(dir, "s1.jsonl")), false);
  assert.equal(existsSync(join(dir, "s1")), false);
  assert.equal(existsSync(join(dir, "s2.jsonl")), true, "another session is untouched");
  assert.equal((await loadStarted()).has("s1"), false);
  rmSync(home, { recursive: true, force: true });
}

console.log("refusal: ok");
