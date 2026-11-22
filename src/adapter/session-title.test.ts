// Session titles from the one-shot path reach dsh cleaned. dsh names the session after the first
// non-empty line of the answer, and Haiku now and then answers its JSON-framed input in JSON or
// inside a code fence: six sessions on one box were named `{"title":"…"}` or "```json".
import assert from "node:assert/strict";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { ClaudeCodeAdapter, Config } from "../adapter.js";
import { asSessionId, type PluginContext } from "../dsh.js";
import { cleanTitle } from "./cli.js";
import { tempDir } from "../test-tmp.js";

assert.equal(cleanTitle('{"title":"Mailchimp segment change"}'), "Mailchimp segment change");
assert.equal(cleanTitle('```json\n{"title": "Fix the bridge"}\n```'), "Fix the bridge");
assert.equal(cleanTitle("```text\nGreeting\n```"), "Greeting");
assert.equal(cleanTitle("```\nGreeting\n```"), "Greeting");
assert.equal(cleanTitle("  Plain title  "), "Plain title", "a plain title is only trimmed");
assert.equal(cleanTitle("{not json"), "{not json", "text that is not JSON is left alone");
assert.equal(cleanTitle('{"name":"x"}'), '{"name":"x"}', "JSON without a title is left alone");
assert.equal(cleanTitle("Use `bun` here"), "Use `bun` here", "inline code stays");
assert.equal(cleanTitle(""), "");

/** The adapter with its one-shot replaced by `chunks`, and the text and finish stream() answers. */
const titleFrom = async (chunks: StreamChunk[]) => {
  const a = new ClaudeCodeAdapter(
    { on() {}, logger: { info() {}, warn() {} } } as unknown as PluginContext,
    Config({}),
  );
  a.stateDir = tempDir("omc-session-title-");
  a.oneShot = async function* () {
    yield* chunks;
  };
  const out: StreamChunk[] = [];
  for await (const c of a.stream({
    provider: "claude-code",
    model: "m",
    messages: [],
    sessionId: asSessionId("s1"),
    purpose: "session-title",
  }))
    out.push(c);
  const text = out.map((c) => (c.type === "text-delta" ? c.text : "")).join("");
  return { text, out };
};
/** The chunks a one-shot sends for an answer of `parts`, after a reasoning block at index 0. */
const answer = (...parts: string[]): StreamChunk[] => [
  { type: "block-start", index: 0, blockType: "reasoning" },
  { type: "reasoning-delta", index: 0, text: "thinking" },
  { type: "block-end", index: 0, block: { type: "reasoning", text: "thinking" } },
  { type: "block-start", index: 1, blockType: "text" },
  ...parts.map((text): StreamChunk => ({ type: "text-delta", index: 1, text })),
  { type: "block-end", index: 1, block: { type: "text", text: parts.join("") } },
  { type: "finish", reason: { kind: "stop" } },
];

{
  const { text, out } = await titleFrom(answer('{"title":', '"Babysit issue"}'));
  assert.equal(text, "Babysit issue", "a JSON answer reaches dsh as its title");
  assert.deepEqual(out.at(-1), { type: "finish", reason: { kind: "stop" } });
  const indexes = out.flatMap((c) => ("index" in c ? [c.index] : []));
  assert.equal(new Set(indexes).size, 1, "one block goes out, so no index is reused");
  assert.equal(
    out.some((c) => c.type === "reasoning-delta"),
    false,
    "the call's own blocks are not passed on",
  );
}
assert.equal((await titleFrom(answer("```json\n", "Fence title\n```"))).text, "Fence title");
assert.equal((await titleFrom(answer("Plain title"))).text, "Plain title");
{
  const failed: StreamChunk = {
    type: "finish",
    reason: { kind: "error", failure: { message: "boom", code: "PROVIDER_ERROR" } },
  };
  const { text, out } = await titleFrom([failed]);
  assert.equal(text, "", "a failed call sends no text");
  assert.deepEqual(out, [failed], "and its own finish");
}
console.log("session-title ok");
