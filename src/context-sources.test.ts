// Offline self-check: bun src/context-sources.test.ts. Pure, no DOM, no network.
import assert from "node:assert/strict";
import {
  type ChatFlowNode,
  contextDrops,
  CONTEXT_SOURCES,
  maskedRows,
  TOGGLEABLE,
} from "./context-sources.js";

assert.deepEqual(contextDrops({}), new Set());
assert.deepEqual(contextDrops({ dshContextInstructionsOff: true }), new Set(["instructions"]));
assert.deepEqual(contextDrops({ dshContextSkillsOff: true }), new Set(["skills"]));
assert.deepEqual(
  contextDrops({ dshContextInstructionsOff: true, dshContextSkillsOff: true }),
  new Set(["instructions", "skills"]),
);
assert.deepEqual(contextDrops({ dshContextOff: true }), new Set(["instructions", "skills"]));
assert.deepEqual(
  contextDrops({ dshContextOff: true, dshContextInstructionsOff: false }),
  new Set(["instructions", "skills"]),
);
assert.deepEqual(
  contextDrops({ dshContextInstructionsOff: false, dshContextSkillsOff: false }),
  new Set(),
);
assert.equal(contextDrops({}).has("runtime"), false);
assert.equal(contextDrops({ dshContextInstructionsOff: true }).has("runtime"), false);
assert.equal(contextDrops({ dshContextSkillsOff: true }).has("runtime"), false);
assert.equal(
  contextDrops({ dshContextInstructionsOff: true, dshContextSkillsOff: true }).has("runtime"),
  false,
);
assert.equal(contextDrops({ dshContextOff: true }).has("runtime"), false);
assert.equal(
  contextDrops({ dshContextOff: true, dshContextInstructionsOff: false }).has("runtime"),
  false,
);
assert.equal(
  contextDrops({ dshContextInstructionsOff: false, dshContextSkillsOff: false }).has("runtime"),
  false,
);
assert.equal(
  contextDrops({ dshContextOff: true, dshContextRuntimeOff: true }).has("runtime"),
  false,
);
assert.equal(contextDrops({ dshContextRuntimeOff: true }).has("runtime"), false);
const HINT_KEYS = ["dshContextOff", "dshContextInstructionsOff", "dshContextSkillsOff"];
for (const k of HINT_KEYS) {
  assert.equal(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k), true);
}
assert.deepEqual(CONTEXT_SOURCES, ["instructions", "skills", "runtime"]);
assert.deepEqual(TOGGLEABLE, ["instructions", "skills"]);

// Row shapes copied from a real session's chat: the three injected blocks dsh draws, dsh's own
// system prompt, the wake notice that shares `kind: "plugin"` with the runtime snapshot, and an
// ordinary prompt. Only the first two of those may ever be folded away.
const rows: Record<string, ChatFlowNode> = {
  instructions: { kind: "context", data: { source: { kind: "agent-instructions" } } },
  catalog: { kind: "context", data: { source: { kind: "skill-catalog" } } },
  snapshot: {
    kind: "context",
    data: { source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt" } },
  },
  job: { kind: "context", data: { source: { kind: "plugin", plugin: "tool-jobs" } } },
  harness: { kind: "system-prompt" },
  typed: { kind: "user", data: { source: { kind: "user" } } },
};
const order = ["typed", "instructions", "catalog", "snapshot", "job", "harness"];
const node = (key: string) => rows[key];

// Switches all on: dsh's system prompt is still masked, because this plugin never passes it on.
assert.deepEqual(maskedRows(order, node, contextDrops({})), ["harness"]);
assert.deepEqual(maskedRows(order, node, contextDrops({ dshContextOff: true })), [
  "instructions",
  "catalog",
  "harness",
]);
assert.deepEqual(maskedRows(order, node, contextDrops({ dshContextSkillsOff: true })), [
  "catalog",
  "harness",
]);
// The runtime snapshot goes out whatever the switches say, and so does a job notice that happens
// to share its source kind. Masking either would hide a block Claude Code did receive.
assert.equal(
  maskedRows(order, node, contextDrops({ dshContextOff: true })).includes("snapshot"),
  false,
);
assert.equal(maskedRows(order, node, contextDrops({ dshContextOff: true })).includes("job"), false);
assert.equal(
  maskedRows(order, node, contextDrops({ dshContextOff: true })).includes("typed"),
  false,
);
// A key the store no longer holds is skipped rather than named in the sheet.
assert.deepEqual(maskedRows(["gone"], node, contextDrops({ dshContextOff: true })), []);

console.log("context-sources.test.ts: ok");
