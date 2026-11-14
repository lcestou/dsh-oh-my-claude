// `verbatimPrompts`: a prompt line carries `client_composed`, so Claude Code sends it as written;
// without the switch, and for the plugin's own command lines, the line is what it always was.
import { strict as assert } from "node:assert";
import { buildInput } from "./cli.js";
import { Config } from "./config.js";

const plain = JSON.parse(buildInput("hi @notes.md", []));
assert.equal(plain.client_composed, undefined);
const composed = JSON.parse(buildInput("hi @notes.md", [], "u1", true));
assert.equal(composed.client_composed, true);
assert.equal(composed.uuid, "u1");
assert.deepEqual(composed.message, {
  role: "user",
  content: [{ type: "text", text: "hi @notes.md" }],
});
assert.equal(buildInput("/compact", []), buildInput("/compact", [], undefined, false));
assert.equal(new Config({}).verbatimPrompts, false);

console.log("verbatim: ok");
