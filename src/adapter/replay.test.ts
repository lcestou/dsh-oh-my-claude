// `replayToolTextLimit`: the history dsh sends Claude as text cuts tool input and output at the
// limit, 2,000 characters as before by default, and keeps them whole at 0.
import { strict as assert } from "node:assert";
import { Config } from "./config.js";
import { buildPrompt, type LooseMessage } from "./prompt.js";

const long = "x".repeat(2500);
const turns = [
  { role: "user", content: [{ type: "text", text: "go" }], source: { kind: "user" } },
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "c1", name: "bash", arguments: long }],
    source: { kind: "model", provider: "other" },
  },
  { role: "tool", toolCallId: "c1", content: [{ type: "text", text: long }] },
  { role: "user", content: [{ type: "text", text: "next" }], source: { kind: "user" } },
] as unknown as LooseMessage[];

const cut = buildPrompt(turns);
assert.ok(cut.includes("… (500 more characters)"));
assert.ok(!cut.includes(long));
const whole = buildPrompt(turns, new Set(), 0);
assert.equal(whole.split(long).length - 1, 2, "the call's input and its result, whole");
assert.ok(!whole.includes("more characters"));
assert.equal(new Config({}).replayToolTextLimit, 2000);

console.log("replay: ok");
