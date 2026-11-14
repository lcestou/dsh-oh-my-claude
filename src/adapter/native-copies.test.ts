// dsh's copies of what Claude Code adds itself (a CLAUDE.md section in the instruction bundle, the
// body of a skill the CLI lists) are left out by default and kept when the CLI no longer adds them.
import { strict as assert } from "node:assert";
import { COMMAND_CATALOG } from "../dsh.js";
import { buildPrompt, contextSizes, promptTextOf, type LooseMessage } from "./prompt.js";
import { stepContextFor } from "./turn.js";

// SAFETY: the slot bridgeCommands writes, set here as the CLI's init frame would
(globalThis as { [COMMAND_CATALOG]?: string[] })[COMMAND_CATALOG] = ["review"];

const bundle: LooseMessage = {
  role: "user",
  source: { kind: "agent-instructions" },
  content: [
    {
      type: "text",
      text: "<system-reminder>\nInstructions from: /w/CLAUDE.md\nclaude rules\nInstructions from: /w/AGENTS.md\nagent rules\n</system-reminder>",
    },
  ],
};
const skill: LooseMessage = {
  role: "user",
  source: { kind: "skill-invocation", name: "review" },
  content: [{ type: "text", text: "<skill_content>review body</skill_content>" }],
};
const none = { claudeMd: false, skills: false };

assert.ok(!promptTextOf(bundle).includes("claude rules"), "default: the CLI loads CLAUDE.md");
assert.ok(promptTextOf(bundle).includes("agent rules"));
assert.ok(
  promptTextOf(bundle, new Set(), none).includes("claude rules"),
  "isolate: dsh's copy stays",
);
assert.equal(promptTextOf(skill), "", "default: the CLI expands its own /review");
assert.equal(promptTextOf(skill, new Set(), none), "<skill_content>review body</skill_content>");

const user: LooseMessage = {
  role: "user",
  source: { kind: "user" },
  content: [{ type: "text", text: "go" }],
};
assert.ok(buildPrompt([bundle, skill, user], new Set(), 2000, none).includes("review body"));
assert.equal(contextSizes([bundle], none).claudemd, 0, "nothing taken out when it is kept");
assert.ok((contextSizes([bundle]).claudemd ?? 0) > 0);
// A skill invoked while a dsh tool ran rides on the tool result.
const later: LooseMessage[] = [
  { role: "assistant", content: [{ type: "text", text: "working" }] },
  skill,
];
assert.ok(stepContextFor(later, new Set(), new Set(), none).includes("review body"));
assert.equal(stepContextFor(later), "");

console.log("native-copies: ok");
