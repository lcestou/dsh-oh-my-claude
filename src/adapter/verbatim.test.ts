// `verbatimPrompts`: a prompt line carries `client_composed`, so Claude Code sends it as written;
// without the switch, and for the plugin's own command lines, the line is what it always was.
import { strict as assert } from "node:assert";
import { buildInput } from "./cli.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { isCliCommandLine } from "./prompt.js";
import type { PluginContext } from "../dsh.js";

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

// A bridged command (`/cost`, a CLI skill) still goes as a command under the switch: a line marked as
// written is never dispatched. Known names come from the CLI's init frame; before one arrives any
// `/name` in dsh's command grammar counts, and a path never does.
assert.equal(isCliCommandLine("/cost", ["cost", "compact"]), true);
assert.equal(isCliCommandLine("  /compact keep the plan", ["cost", "compact"]), true);
assert.equal(isCliCommandLine("/unknown x", ["cost"]), false, "not one of the CLI's");
assert.equal(isCliCommandLine("/cost", undefined), true, "no list yet: the grammar decides");
assert.equal(isCliCommandLine("/home/x/notes.md explain", undefined), false, "a path");
assert.equal(isCliCommandLine("please run /cost", ["cost"]), false, "not at the start");
{
  // SAFETY: partial fake; composedFor reads only the config and the command map
  const on = new ClaudeCodeAdapter(
    { on() {} } as unknown as PluginContext,
    new Config({ verbatimPrompts: true }),
  );
  on.sessionCommands.set("s1", ["cost"]);
  assert.equal(on.composedFor("s1", "/cost"), false, "a CLI command dispatches");
  assert.equal(on.composedFor("s1", "hi @notes.md"), true, "a prompt goes as written");
  // SAFETY: partial fake, as above
  const off = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, new Config({}));
  assert.equal(off.composedFor("s1", "hi @notes.md"), false, "off: never marked");
}

console.log("verbatim: ok");
