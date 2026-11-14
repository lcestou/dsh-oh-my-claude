// `refusalAsFailure`, on hand-written frames shaped like Claude Code 2.1.323's refusal output (the
// Agent SDK's SDKModelRefusalNoFallbackMessage, the assistant error frame and the result that
// follow): no real refusal is ever provoked to test this. Off, a refusal ends the turn as before;
// on, it is a failure with code REFUSAL, and the refused Claude session is dropped.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
/** A result frame that stopped with `refusal`, as an error or not. */
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

// Frames shaped as Claude Code 2.1.325 sends them: the system frame with `content: ""` and the
// sentence in `api_refusal_explanation`, and an assistant error frame that carries the CLI's text.
// Under the option nothing but `finish` goes out, since any other chunk commits the attempt and
// dsh-fallback-models only retries an uncommitted one; off, the text is drawn as before.
{
  // SAFETY: hand-written fixtures in the CLI's stream-json shapes
  const real = [
    {
      type: "system",
      subtype: "model_refusal_no_fallback",
      original_model: "claude-test-1",
      api_refusal_category: "cyber",
      api_refusal_explanation: "Flagged by the cyber safeguard.",
      content: "",
    },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "m2",
        role: "assistant",
        content: [
          { type: "text", text: "API Error: Claude Code's safeguards flagged this message" },
        ],
        stop_reason: "refusal",
      },
    },
  ] as unknown as ClaudeEvent[];
  const on = new Translator({ refusalAsFailure: true });
  const out = [...real.flatMap((e) => on.translate(e)), ...on.translate(result(true))];
  assert.deepEqual(
    out.filter((c) => c.type !== "block-start").map((c) => c.type),
    ["finish"],
    "on: nothing commits the attempt before finish",
  );
  const last = out.at(-1);
  assert.ok(last?.type === "finish" && last.reason.kind === "error");
  assert.equal(
    last.reason.failure.message,
    "Claude declined to answer (cyber): Flagged by the cyber safeguard.",
    "the sentence comes from the explanation when content is empty",
  );
  const off = new Translator({ refusalAsFailure: false });
  const drawn = real.flatMap((e) => off.translate(e));
  assert.ok(
    drawn.some((c) => c.type === "text-delta" || c.type === "reasoning-delta"),
    "off: drawn",
  );
}

// A reply frame that stopped with `refusal`, followed by a result that ended the turn normally: the
// result decides, so the turn is a normal stop and nothing marks the transcript for dropping.
{
  const tr = new Translator({ refusalAsFailure: true });
  tr.translate(frames[1]!);
  // SAFETY: hand-written fixture
  const end = tr.translate({ type: "result", is_error: false, stop_reason: "end_turn" } as never);
  const last = end.at(-1);
  assert.ok(last?.type === "finish" && last.reason.kind === "stop", "the result overruled it");
  assert.equal(tr.refusalEnded, false, "so the transcript stays");
}
{
  const { tr } = finish(true, true);
  assert.equal(tr.refusalEnded, true, "a turn ended as REFUSAL marks its transcript for dropping");
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
  assert.equal(existsSync(join(dir, "s1.jsonl")), false, "the next turn does not resume it");
  assert.equal(existsSync(join(dir, "s1")), false);
  const kept = readdirSync(dir);
  assert.ok(
    kept.some((f) => /^s1\.jsonl\.refused-\d+$/.test(f)) &&
      kept.some((f) => /^s1\.refused-\d+$/.test(f)),
    "moved aside, never deleted: an imported transcript is the person's own",
  );
  assert.equal(existsSync(join(dir, "s2.jsonl")), true, "another session is untouched");
  assert.equal((await loadStarted()).has("s1"), false);
  rmSync(home, { recursive: true, force: true });
}

console.log("refusal: ok");
